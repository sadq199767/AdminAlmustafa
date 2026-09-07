import { createClient } from "@supabase/supabase-js";
import { loadEnvFile } from "node:process";
import { randomUUID, randomBytes, randomInt } from "node:crypto";
import assert from "node:assert/strict";
loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const users = [],
  employees = [],
  tasks = [];
const marker = randomUUID().slice(0, 8);
async function account(role) {
  const password = randomBytes(30).toString("base64url");
  const email = `qa-${role}-${marker}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users.push(data.user.id);
  const { error: p } = await admin
    .from("profiles")
    .insert({ id: data.user.id, name: `اختبار ${role}`, role });
  if (p) throw p;
  const db = createClient(url, key, options);
  const { data: session, error: s } = await db.auth.signInWithPassword({
    email,
    password,
  });
  if (s) throw s;
  return { id: data.user.id, db, token: session.session.access_token };
}
async function api(actor, path, method = "GET", body) {
  const response = await fetch(`http://localhost:3000/api/${path}`, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
function ok(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body;
}
try {
  const [owner, manager, employee] = await Promise.all([
    account("owner"),
    account("manager"),
    account("employee"),
  ]);
  assert.equal((await api(null, "data")).status, 401);
  assert.equal((await api(employee, "data")).status, 403);
  console.log(
    "PASS: anonymous and employee accounts cannot access the admin API.",
  );
  const created = ok(
    await api(manager, "employees", "POST", {
      name: "موظف اختبار مؤقت",
      profession: "فحص النظام",
      daily_hours: 8,
      joined_on: "2026-09-01",
      phone: "",
      telegram_id: "",
    }),
    201,
  );
  employees.push(created.id);
  const other = ok(
    await api(owner, "employees", "POST", {
      name: "موظف آخر مؤقت",
      profession: "فحص النظام",
      daily_hours: 8,
      joined_on: "2026-09-01",
      phone: "",
      telegram_id: "",
    }),
    201,
  );
  employees.push(other.id);
  for (const [actor, length] of [
    [owner, 6],
    [manager, 12],
  ]) {
    const name = `حساب موظف مرتبط ${length} ${marker}`;
    const email = `qa-linked-${length}-${marker}@example.com`;
    const password = Array.from({ length }, () => randomInt(0, 10)).join("");
    const details = {
      name,
      profession: "فحص الربط",
      daily_hours: 8,
      joined_on: "2026-09-01",
    };
    for (const credentials of [
      { email },
      { password },
      { email: "invalid", password },
      { email, password: password.slice(0, 5) },
      { email, password: password.padEnd(13, "0") },
    ]) {
      assert.equal(
        (await api(actor, "employees", "POST", { ...details, ...credentials }))
          .status,
        400,
      );
    }
    const before = await admin.from("employees").select("id").eq("name", name);
    assert.equal(before.error, null);
    assert.equal(before.data.length, 0);
    const linkedEmployee = ok(
      await api(actor, "employees", "POST", {
        ...details,
        email,
        password,
        role: "owner",
      }),
      201,
    );
    employees.push(linkedEmployee.id);
    if (linkedEmployee.user_id) users.push(linkedEmployee.user_id);
    assert.ok(linkedEmployee.user_id);
    assert.equal("password" in linkedEmployee, false);
    assert.equal("email" in linkedEmployee, false);
    const profile = await admin
      .from("profiles")
      .select("role,name")
      .eq("id", linkedEmployee.user_id)
      .single();
    assert.equal(profile.error, null);
    assert.equal(profile.data.role, "employee");
    assert.equal(profile.data.name, name);
    assert.equal(
      (await api(actor, "employees", "POST", { ...details, email, password }))
        .status,
      409,
    );
    const after = await admin.from("employees").select("id").eq("name", name);
    assert.equal(after.error, null);
    assert.deepEqual(
      after.data.map((row) => row.id),
      [linkedEmployee.id],
    );
    const loginClient = createClient(url, key, options);
    const login = await loginClient.auth.signInWithPassword({
      email,
      password,
    });
    assert.equal(login.error, null);
    assert.equal(login.data.user.id, linkedEmployee.user_id);
    const own = await loginClient.from("employees").select("id");
    assert.equal(own.error, null);
    assert.deepEqual(
      own.data.map((row) => row.id),
      [linkedEmployee.id],
    );
    assert.equal(
      (await api({ token: login.data.session.access_token }, "data")).status,
      403,
    );
    await loginClient.auth.signOut();
  }
  console.log(
    "PASS: adding employees creates linked employee-only logins; duplicate email and invalid credentials leave no extra records.",
  );
  for (const length of [6, 12]) {
    const passwordEmployee = ok(
      await api(owner, "employees", "POST", {
        name: `اختبار كلمة مرور ${length}`,
        profession: "فحص الحساب",
        daily_hours: 8,
        joined_on: "2026-09-01",
      }),
      201,
    );
    employees.push(passwordEmployee.id);
    const numericPassword = Array.from({ length }, () => randomInt(0, 10)).join(
      "",
    );
    const email = `qa-password-${length}-${marker}@example.com`;
    for (const invalidPassword of [
      numericPassword.slice(0, 5),
      numericPassword.padEnd(13, "0"),
    ]) {
      assert.equal(
        (
          await api(owner, "team", "POST", {
            employee_id: passwordEmployee.id,
            email,
            password: invalidPassword,
            role: "employee",
          })
        ).status,
        400,
      );
    }
    ok(
      await api(owner, "team", "POST", {
        employee_id: passwordEmployee.id,
        email,
        password: numericPassword,
        role: "employee",
      }),
    );
    const linkedAccount = await admin
      .from("employees")
      .select("user_id")
      .eq("id", passwordEmployee.id)
      .single();
    assert.equal(linkedAccount.error, null);
    assert.ok(linkedAccount.data.user_id);
    users.push(linkedAccount.data.user_id);
    const passwordClient = createClient(url, key, options);
    const signedIn = await passwordClient.auth.signInWithPassword({
      email,
      password: numericPassword,
    });
    assert.equal(signedIn.error, null);
    assert.equal(signedIn.data.user.id, linkedAccount.data.user_id);
    await passwordClient.auth.signOut();
  }
  console.log(
    "PASS: 6- and 12-digit passwords create linked accounts and sign in; invalid lengths are rejected.",
  );
  const { error: linked } = await admin
    .from("employees")
    .update({ user_id: employee.id })
    .eq("id", created.id);
  assert.equal(linked, null);
  const ownList = await employee.db.from("employees").select("id");
  assert.equal(ownList.error, null);
  assert.deepEqual(
    ownList.data.map((e) => e.id),
    [created.id],
  );
  const secret = await employee.db.from("bot_secrets").select("*");
  assert.ok(secret.error);
  const promote = await employee.db
    .from("profiles")
    .update({ role: "owner" })
    .eq("id", employee.id)
    .select();
  assert.equal(promote.data?.length || 0, 0);
  assert.equal(
    (
      await api(manager, "employees/" + created.id, "PATCH", {
        name: "تغيير ممنوع",
        profession: "فحص النظام",
        daily_hours: 8,
        joined_on: "2026-09-01",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(manager, "settings", "PATCH", {
        organization_name: "تغيير ممنوع",
        work_days: [0],
        telegram_enabled: false,
      })
    ).status,
    403,
  );
  console.log(
    "PASS: row security isolates employees, protects secrets, and prevents role escalation.",
  );
  const task = ok(
    await api(manager, "tasks", "POST", {
      title: "مهمة اختبار مؤقتة",
      description: "سيتم حذف بيانات الاختبار المحددة بعد التحقق.",
      employee_id: created.id,
      priority: "high",
      due_date: null,
    }),
    201,
  );
  tasks.push(task.id);
  assert.equal(task.assigned_by, manager.id);
  const reassign = await employee.db
    .from("tasks")
    .update({ employee_id: other.id })
    .eq("id", task.id);
  assert.ok(reassign.error);
  ok(
    await api(employee, "tasks/" + task.id, "PATCH", { status: "in_progress" }),
  );
  const complete = ok(
    await api(employee, "tasks/" + task.id, "PATCH", { status: "done" }),
  );
  assert.ok(complete.completed_at);
  const { data: activities } = await admin
    .from("task_activities")
    .select("id")
    .eq("task_id", task.id);
  assert.equal(activities.length, 3);
  console.log(
    "PASS: assignment, status changes, completion timestamp, and audit history.",
  );
  const session = {
    id: randomUUID(),
    work_date: "2026-09-01",
    started_at: "2026-09-01T06:00:00Z",
    ended_at: "2026-09-01T14:00:00Z",
    attendance_seconds: 28800,
    active_seconds: 21600,
  };
  ok(await api(employee, "desktop/attendance", "POST", session));
  ok(await api(employee, "desktop/attendance", "POST", session));
  assert.equal(
    (
      await api(employee, "desktop/attendance", "POST", {
        ...session,
        active_seconds: 30000,
      })
    ).status,
    400,
  );
  ok(
    await api(employee, "desktop/reports", "POST", {
      day: "2026-09-01",
      summary: "أنجزت المهمة الاختبارية وتحققت من تسجيل الدوام.",
    }),
  );
  const report = await admin
    .from("daily_reports")
    .select("*")
    .eq("employee_id", created.id)
    .single();
  assert.equal(report.data.attendance_seconds, 28800);
  assert.equal(report.data.active_seconds, 21600);
  const dashboard = ok(await api(owner, "data"));
  assert.ok(dashboard.employees.some((e) => e.id === created.id));
  assert.ok(
    !JSON.stringify(dashboard).includes(process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
  ok(
    await api(employee, "reviews", "POST", {
      task_id: task.id,
      reviewer_id: other.id,
      note: "طلب اختبار",
    }),
  );
  const deletable = ok(
    await api(manager, "tasks", "POST", {
      title: "اختبار حذف مهمة مستقلة",
      employee_id: created.id,
    }),
    201,
  );
  tasks.push(deletable.id);
  ok(
    await api(employee, "reviews", "POST", {
      task_id: deletable.id,
      reviewer_id: other.id,
      note: "مراجعة اختبار الحذف",
    }),
  );
  const [deleteActivities, deleteReviews] = await Promise.all([
    admin.from("task_activities").select("id").eq("task_id", deletable.id),
    admin.from("review_requests").select("id").eq("task_id", deletable.id),
  ]);
  assert.equal(deleteActivities.error, null);
  assert.equal(deleteReviews.error, null);
  assert.ok(deleteActivities.data.length > 0);
  assert.ok(deleteReviews.data.length > 0);
  const notificationFeed = ok(await api(owner, "data"));
  assert.ok(
    notificationFeed.activities.some(
      (a) => a.task_id === deletable.id && a.action.includes("طلب مراجعة"),
    ),
    "Review requests must reach the notification feed",
  );
  const events = [...deleteActivities.data, ...deleteReviews.data];
  const deliveryFixtures = await admin.from("notification_deliveries").insert(
    events.map((event) => ({
      event_id: event.id,
      recipient_id: other.id,
      message: "سجل اختبار فقط",
      status: "skipped",
    })),
  );
  assert.equal(deliveryFixtures.error, null);
  assert.equal(
    (await api(null, "tasks/" + deletable.id, "DELETE")).status,
    401,
  );
  assert.equal(
    (await api(employee, "tasks/" + deletable.id, "DELETE")).status,
    403,
  );
  const deniedRpc = await employee.db.rpc("delete_task", {
    target_id: deletable.id,
  });
  assert.equal(deniedRpc.error?.code, "42501");
  const deniedDirectDelete = await manager.db
    .from("tasks")
    .delete()
    .eq("id", deletable.id);
  assert.ok(deniedDirectDelete.error);
  assert.equal((await api(manager, "tasks/not-a-uuid", "DELETE")).status, 400);
  ok(await api(manager, "tasks/" + deletable.id, "DELETE"));
  assert.equal(
    (await api(manager, "tasks/" + deletable.id, "DELETE")).status,
    404,
  );
  for (const table of ["tasks", "task_activities", "review_requests"]) {
    const result = await admin
      .from(table)
      .select("id")
      .eq(table === "tasks" ? "id" : "task_id", deletable.id);
    assert.equal(result.error, null);
    assert.equal(result.data.length, 0);
  }
  const deliveriesAfter = await admin
    .from("notification_deliveries")
    .select("id")
    .in(
      "event_id",
      events.map((event) => event.id),
    );
  assert.equal(deliveriesAfter.error, null);
  assert.equal(deliveriesAfter.data.length, 0);
  const afterTaskDelete = ok(await api(owner, "data"));
  assert.ok(afterTaskDelete.tasks.some((t) => t.id === task.id));
  assert.ok(!afterTaskDelete.tasks.some((t) => t.id === deletable.id));
  assert.ok(afterTaskDelete.attendance.some((a) => a.id === session.id));
  assert.ok(afterTaskDelete.reports.some((r) => r.id === report.data.id));
  const ownerDeletable = ok(
    await api(owner, "tasks", "POST", {
      title: "اختبار صلاحية حذف المالك",
      employee_id: other.id,
    }),
    201,
  );
  tasks.push(ownerDeletable.id);
  ok(await api(owner, "tasks/" + ownerDeletable.id, "DELETE"));
  console.log(
    "PASS: owner/manager task deletion, API/RPC authorization, cascade cleanup, and preserved attendance/reports.",
  );
  ok(await api(owner, "employees/" + created.id, "DELETE"));
  assert.ok(
    [401, 403].includes(
      (await api(employee, "desktop/attendance", "POST", session)).status,
    ),
  );
  for (const [table, column, id] of [
    ["employees", "id", created.id],
    ["tasks", "id", task.id],
    ["attendance", "employee_id", created.id],
    ["daily_reports", "employee_id", created.id],
  ]) {
    const result = await admin.from(table).select("id").eq(column, id);
    assert.equal(result.data.length, 0);
  }
  console.log(
    "PASS: attendance idempotency, report totals, review requests, permanent deletion and account revocation.",
  );
  console.log("INTEGRATION TESTS PASSED");
} finally {
  const cleanupErrors = [];
  async function clean(table, column, ids) {
    if (!ids.length) return;
    const { error } = await admin.from(table).delete().in(column, ids);
    if (error) cleanupErrors.push(`${table}: ${error.message}`);
  }
  await clean("notification_deliveries", "recipient_id", employees);
  await clean("review_requests", "task_id", tasks);
  await clean("task_activities", "task_id", tasks);
  await clean("tasks", "id", tasks);
  await clean("attendance", "employee_id", employees);
  await clean("daily_reports", "employee_id", employees);
  await clean("employees", "id", employees);
  for (const id of users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404)
      cleanupErrors.push(`user cleanup: ${error.message}`);
  }
  if (cleanupErrors.length)
    throw new Error(
      "Temporary test cleanup incomplete: " + cleanupErrors.join("; "),
    );
  console.log("Temporary test records and accounts removed.");
}
