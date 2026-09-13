import { NextRequest, NextResponse } from "next/server";
import { authorize, fail, serviceClient, serviceReady } from "@/lib/server";
export const dynamic = "force-dynamic";
async function readAll(
  db: Awaited<ReturnType<typeof authorize>>["db"],
  table: string,
  order: string,
  secondOrder = "id",
) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const query = db
      .from(table)
      .select("*")
      .order(order, { ascending: table === "employees" });
    if (secondOrder) query.order(secondOrder);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return { data: rows, error: null };
  }
  throw new Error("Dataset exceeds the supported interactive limit.");
}

async function userIdToEmail(): Promise<Map<string, string>> {
  if (!serviceReady()) return new Map();
  const { auth } = serviceClient();
  const map = new Map<string, string>();
  let page = 1;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error || !data?.users?.length) break;
    for (const u of data.users) map.set(u.id, u.email ?? "");
    if (data.users.length < 1000) break;
    page++;
  }
  return map;
}

export async function GET(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    const results = await Promise.all([
      readAll(db, "employees", "created_at"),
      readAll(db, "tasks", "created_at"),
      readAll(db, "attendance", "work_date"),
      readAll(db, "daily_reports", "report_date"),
      readAll(db, "task_assignees", "task_id", ""),
      db
        .from("task_activities")
        .select("id,task_id,actor_name,action,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("app_settings").select("*").eq("id", 1).single(),
    ]);
    if (results.some((r) => r.error)) throw new Error("Database read failed");
    let botConfigured = false;
    if (serviceReady()) {
      const { count } = await serviceClient()
        .from("bot_secrets")
        .select("id", { count: "exact", head: true });
      botConfigured = !!count;
    }
    const emailMap = await userIdToEmail();
    let employeeRows = results[0].data as Record<string, unknown>[];
    if (profile.can_follow_tasks) {
      const { data: directory, error: directoryError } = await db.rpc("task_directory");
      if (directoryError) throw directoryError;
      const existingIds = new Set(employeeRows.map((entry) => String(entry.id)));
      employeeRows = [
        ...employeeRows,
        ...((directory ?? []) as Record<string, unknown>[])
          .filter((entry) => !existingIds.has(String(entry.id)))
          .map((entry) => ({
            ...entry,
            phone: "",
            telegram_id: "",
            daily_hours: 0,
            work_days: [0, 1, 2, 3, 4],
            joined_on: "",
            archived_at: null,
            created_at: "",
          })),
      ];
    }
    const employees: Record<string, unknown>[] = (employeeRows as Record<
      string,
      unknown
    >[]).map((e) => ({
      ...e,
      email: e.user_id ? emailMap.get(String(e.user_id)) ?? null : null,
    }));
    const assigneeByTask = new Map<string, string[]>();
    const stateByTask = new Map<
      string,
      Record<string, { status: string | null; completed_at: string | null }>
    >();
    for (const a of results[4].data as {
      task_id: string;
      employee_id: string;
      status?: string | null;
      completed_at?: string | null;
    }[]) {
      const list = assigneeByTask.get(a.task_id) ?? [];
      list.push(a.employee_id);
      assigneeByTask.set(a.task_id, list);
      const states = stateByTask.get(a.task_id) ?? {};
      states[String(a.employee_id)] = {
        status: a.status ?? null,
        completed_at: a.completed_at ?? null,
      };
      stateByTask.set(a.task_id, states);
    }
    const tasks: Record<string, unknown>[] = (
      results[1].data as Record<string, unknown>[]
    ).map((t) => ({
      ...t,
      assignee_ids: assigneeByTask.get(String(t.id)) ?? (t.employee_id ? [String(t.employee_id)] : []),
      assignee_status: stateByTask.get(String(t.id)) ?? {},
    }));
    return NextResponse.json(
      {
        profile,
        employees,
        tasks,
        attendance: results[2].data,
        reports: results[3].data,
        activities: results[5].data,
        settings: {
          ...results[6].data,
          bot_configured: botConfigured,
          server_ready:
            serviceReady() && Boolean(process.env.BOT_ENCRYPTION_KEY),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
