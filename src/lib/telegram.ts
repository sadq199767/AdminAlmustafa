import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Task } from "./types";
import { ApiError, serviceClient, serviceReady } from "./server";
function key() {
  const value = Buffer.from(process.env.BOT_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw new ApiError(503, "لم يُضبط مفتاح تشفير البوت على الخادم.");
  return value;
}
export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((b) => b.toString("base64"))
    .join(".");
}
function decryptToken(value: string) {
  const [iv, tag, data] = value.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
function notificationEventId(value: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    return value;
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function sendNotification(
  eventId: string,
  recipientId: string,
  message: string,
) {
  if (!serviceReady()) return "unconfigured";
  const db = serviceClient();
  const [{ data: settings }, { data: employee }, { data: secret }] =
    await Promise.all([
      db
        .from("app_settings")
        .select("telegram_enabled")
        .eq("id", 1)
        .single(),
      db
        .from("employees")
        .select("telegram_id")
        .eq("id", recipientId)
        .is("archived_at", null)
        .single(),
      db.from("bot_secrets").select("encrypted_token").eq("id", 1).single(),
    ]);
  let suspended = false;
  try {
    const { data: state } = await db
      .from("app_settings")
      .select("system_suspended")
      .eq("id", 1)
      .maybeSingle();
    suspended = Boolean(state?.system_suspended);
  } catch {
    suspended = false;
  }
  if (suspended) return "suspended";
  if (!settings?.telegram_enabled) return "disabled";
  if (!employee?.telegram_id || !secret) return "unconfigured";
  const { data: delivery, error } = await db
    .from("notification_deliveries")
    .insert({
      event_id: notificationEventId(eventId),
      recipient_id: recipientId,
      message,
      status: "sending",
      attempts: 1,
    })
    .select("id")
    .single();
  if (error || !delivery)
    return error?.code === "23505" ? "duplicate" : "failed";
  try {
    const token = decryptToken(secret.encrypted_token);
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: employee.telegram_id, text: message }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error("Telegram failed");
    await db
      .from("notification_deliveries")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", delivery.id);
    return "sent";
  } catch {
    await db
      .from("notification_deliveries")
      .update({
        status: "failed",
        last_error: "تعذّر تسليم إشعار تلكرام؛ تحقق من التوكن ومعرّف المحادثة.",
      })
      .eq("id", delivery.id);
    return "failed";
  }
}
async function deliverScreenshot(
  eventId: string,
  recipientForLog: string,
  chatId: string | null,
  images: Array<{ bytes: ArrayBuffer; name: string }>,
) {
  if (!serviceReady() || !images.length) return "unconfigured";
  const db = serviceClient();
  const [{ data: settings }, { data: secret }] =
    await Promise.all([
      db.from("app_settings").select("telegram_enabled,system_suspended").eq("id", 1).single(),
      db.from("bot_secrets").select("encrypted_token").eq("id", 1).single(),
    ]);
  if (settings?.system_suspended) return "suspended";
  if (!settings?.telegram_enabled) return "disabled";
  if (!chatId || !secret) return "unconfigured";
  const { data: delivery, error } = await db.from("notification_deliveries").insert({
    event_id: notificationEventId(eventId),
    recipient_id: recipientForLog,
    message: "لقطة شاشة بطلب المسؤول المباشر",
    status: "sending",
    attempts: 1,
  }).select("id").single();
  if (error || !delivery) return error?.code === "23505" ? "duplicate" : "failed";
  try {
    const token = decryptToken(secret.encrypted_token);
    const form = new FormData();
    form.set("chat_id", chatId);
    let endpoint = "sendPhoto";
    if (images.length === 1) {
      form.set("photo", new Blob([images[0].bytes], { type: "image/jpeg" }), images[0].name);
    } else {
      endpoint = "sendMediaGroup";
      const media = images.map((image, index) => ({ type: "photo", media: `attach://screen${index}` }));
      form.set("media", JSON.stringify(media));
      images.forEach((image, index) => form.set(
        `screen${index}`,
        new Blob([image.bytes], { type: "image/jpeg" }),
        image.name,
      ));
    }
    const response = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || !result.ok) throw new Error(result.description ?? "Telegram failed");
    await db.from("notification_deliveries").update({
      status: "sent", sent_at: new Date().toISOString(), last_error: null,
    }).eq("id", delivery.id);
    return "sent";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "تعذّر تسليم لقطة الشاشة عبر تلكرام.";
    await db.from("notification_deliveries").update({
      status: "failed",
      last_error: reason.slice(0, 200),
    }).eq("id", delivery.id);
    return "failed";
  }
}
export async function sendScreenshotNotification(
  eventId: string,
  recipientId: string,
  images: Array<{ bytes: ArrayBuffer; name: string }>,
) {
  const db = serviceClient();
  const { data: employee } = await db
    .from("employees")
    .select("telegram_id")
    .eq("id", recipientId)
    .is("archived_at", null)
    .single();
  return deliverScreenshot(eventId, recipientId, employee?.telegram_id ?? null, images);
}
export async function sendScreenshotToChat(
  eventId: string,
  chatId: string,
  recipientForLog: string,
  images: Array<{ bytes: ArrayBuffer; name: string }>,
) {
  return deliverScreenshot(eventId, recipientForLog, chatId, images);
}
export async function supervisorAlert(
  excludeRecipientIds: Set<string>,
  text: string,
) {
  if (!serviceReady()) return "unconfigured";
  const db = serviceClient();
  const stamp = `supervisor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const { data: supers } = await db
      .from("profiles")
      .select("id")
      .eq("role", "supervisor");
    if (!supers?.length) return "unconfigured";
    const { data: supEmployees } = await db
      .from("employees")
      .select("id")
      .in("user_id", supers.map((s) => s.id))
      .is("archived_at", null);
    if (!supEmployees?.length) return "unconfigured";
    const results = await Promise.all(
      supEmployees
        .filter((e) => !excludeRecipientIds.has(e.id))
        .map((e, i) => sendNotification(`${stamp}-${i}`, e.id, text)),
    );
    return results.includes("failed")
      ? "failed"
      : results.includes("sent")
        ? "sent"
        : results[0];
  } catch {
    return "failed";
  }
}
export async function directSupervisorAlert(
  employeeId: string,
  eventId: string,
  text: string,
) {
  if (!serviceReady()) return "unconfigured";
  try {
    const { data: employee } = await serviceClient()
      .from("employees")
      .select("supervisor_id")
      .eq("id", employeeId)
      .is("archived_at", null)
      .maybeSingle();
    if (!employee?.supervisor_id) return "unconfigured";
    return await sendNotification(eventId, employee.supervisor_id, text);
  } catch {
    return "failed";
  }
}
export async function notifySupervisorActivity(
  employeeId: string,
  eventId: string,
  text: string,
) {
  if (!serviceReady()) return "unconfigured";
  try {
    const { data: employee } = await serviceClient()
      .from("employees")
      .select("name, supervisor_id")
      .eq("id", employeeId)
      .is("archived_at", null)
      .single();
    if (
      !employee?.supervisor_id ||
      employee.supervisor_id === employeeId
    )
      return "unconfigured";
    return await sendNotification(
      `${eventId}-sup`,
      employee.supervisor_id,
      `من موظفك ${employee.name}:\n${text}`,
    );
  } catch {
    return "failed";
  }
}
export async function notifyAttendance(
  employeeId: string,
  opts: { isEnd: boolean; duration: string; time: string },
) {
  try {
    if (!serviceReady()) return "unconfigured";
    const db = serviceClient();
    const { data: employee } = await db
      .from("employees")
      .select("id, name, supervisor_id")
      .eq("id", employeeId)
      .is("archived_at", null)
      .maybeSingle();
    if (!employee) return "unconfigured";
    const personal = opts.isEnd
      ? `🔴 أنهيت الدوام\n⏱ المدة: ${opts.duration}\n🕐 ${opts.time}`
      : `🟢 بدأت الدوام الآن\n🕐 ${opts.time}`;
    const toSupervisor = opts.isEnd
      ? `🔴 ${employee.name} أنهى الدوام\n⏱ المدة: ${opts.duration}\n🕐 ${opts.time}`
      : `🟢 ${employee.name} بدأ الدوام الآن\n🕐 ${opts.time}`;
    const stamp = `attendance-${opts.isEnd ? "end" : "start"}-${employee.id}-${Date.now()}`;
    const results: string[] = [];
    results.push(await sendNotification(`${stamp}-self`, employee.id, personal));
    if (employee.supervisor_id && employee.supervisor_id !== employee.id) {
      results.push(
        await sendNotification(`${stamp}-sup`, employee.supervisor_id, toSupervisor),
      );
    }
    return results.includes("failed")
      ? "failed"
      : results.includes("sent")
        ? "sent"
        : results[0];
  } catch {
    return "failed";
  }
}
export async function notifyComment(
  commentId: string,
  taskId: string,
  commenter: Profile,
  body: string,
) {
  try {
    if (!serviceReady()) return "unconfigured";
    const db = serviceClient();
    const { data: task } = await db
      .from("tasks")
      .select("id,title,assigned_by,employee_id")
      .eq("id", taskId)
      .single();
    if (!task) return "failed";
    const recipientIds = new Set<string>();
    if (task.employee_id) recipientIds.add(task.employee_id);
    try {
      const { data: assignees } = await db
        .from("task_assignees")
        .select("employee_id")
        .eq("task_id", task.id);
      for (const a of assignees ?? []) recipientIds.add(a.employee_id);
    } catch { }
    if (task.assigned_by) {
      const { data: creator } = await db
        .from("employees")
        .select("id")
        .eq("user_id", task.assigned_by)
        .maybeSingle();
      if (creator) recipientIds.add(creator.id);
    }
    if (commenter.id) {
      const { data: self } = await db
        .from("employees")
        .select("id")
        .eq("user_id", commenter.id)
        .maybeSingle();
      if (self) recipientIds.delete(self.id);
    }
    if (!recipientIds.size) return "sent";
    const snippet = body.length > 140 ? `${body.slice(0, 140)}…` : body;
    const text = `💬 تعليق جديد على المهمة «${task.title}»\n${commenter.name}: ${snippet}`;
    const results = await Promise.all(
      [...recipientIds].map((id) => sendNotification(commentId, id, text)),
    );
    if (serviceReady()) {
      try {
        const { data: cEmp } = await serviceClient()
          .from("employees")
          .select("id, name, supervisor_id")
          .eq("user_id", commenter.id)
          .is("archived_at", null)
          .maybeSingle();
        if (cEmp?.supervisor_id && cEmp.supervisor_id !== cEmp.id) {
          results.push(
            await sendNotification(
              `${commentId}-sup`,
              cEmp.supervisor_id,
              `💬 موظفك ${cEmp.name} علّق على المهمة «${task.title}»\n${commenter.name}: ${snippet}`,
            ),
          );
        }
      } catch {
        /* المسؤول المباشر إضافة — لن تُعطِّل إشعار التعليق */
      }
    }
    return results.includes("failed")
      ? "failed"
      : results.includes("sent")
        ? "sent"
        : results[0];
  } catch {
    return "failed";
  }
}

export async function notifyTask(
  db: SupabaseClient,
  task: Task,
  actor: Profile,
  action: string,
) {
  // Business data is already committed. Delivery failure must never turn success into an apparent failed write.
  try {
    const { data: event } = await db
      .from("task_activities")
      .select("id")
      .eq("task_id", task.id)
      .eq("actor_id", actor.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (!event) return "unconfigured";
    const status = { todo: "مطلوب", in_progress: "قيد العمل", done: "منجز" }[
      task.status
    ];
    const text = `${actor.name} ${action}\n${task.title}\nالحالة: ${status}`;
    const recipientIds = new Set<string>();
    if (task.employee_id) recipientIds.add(task.employee_id);
    if (serviceReady()) {
      try {
        const { data: assignees } = await serviceClient()
          .from("task_assignees")
          .select("employee_id")
          .eq("task_id", task.id);
        for (const a of assignees ?? []) recipientIds.add(a.employee_id);
      } catch { }
    }
    if (serviceReady() && task.assigned_by && task.assigned_by !== actor.id) {
      const { data: assigner } = await serviceClient()
        .from("employees")
        .select("id")
        .eq("user_id", task.assigned_by)
        .maybeSingle();
      if (assigner) recipientIds.add(assigner.id);
    }
    const results = await Promise.all(
      [...recipientIds].map((id) => sendNotification(event.id, id, text)),
    );
    if (serviceReady() && recipientIds.size) {
      try {
        const { data: involved } = await serviceClient()
          .from("employees")
          .select("id, name, supervisor_id")
          .in("id", [...recipientIds])
          .is("archived_at", null);
        const bySup = new Map<string, string[]>();
        for (const emp of involved ?? []) {
          if (emp.supervisor_id && emp.supervisor_id !== emp.id) {
            const names = bySup.get(emp.supervisor_id) ?? [];
            names.push(emp.name);
            bySup.set(emp.supervisor_id, names);
          }
        }
        let i = 0;
        for (const [supId, names] of bySup) {
          results.push(
            await sendNotification(
              `${event.id}-sup${i++}`,
              supId,
              `📋 مهمة «${task.title}» تخص موظفك: ${names.join("، ")}\nالحالة: ${status}\nبواسطة ${actor.name}`,
            ),
          );
        }
      } catch {
        /* المسؤولون المباشرون إضافة — لن تُعطِّل إشعارات المهمة */
      }
    }
    return results.includes("failed")
      ? "failed"
      : results.includes("sent")
        ? "sent"
        : results[0];
  } catch {
    return "failed";
  }
}
