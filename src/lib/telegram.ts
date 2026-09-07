import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
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
export async function sendNotification(
  eventId: string,
  recipientId: string,
  message: string,
) {
  if (!serviceReady()) return "unconfigured";
  const db = serviceClient();
  const [{ data: settings }, { data: employee }, { data: secret }] =
    await Promise.all([
      db.from("app_settings").select("telegram_enabled").eq("id", 1).single(),
      db
        .from("employees")
        .select("telegram_id")
        .eq("id", recipientId)
        .is("archived_at", null)
        .single(),
      db.from("bot_secrets").select("encrypted_token").eq("id", 1).single(),
    ]);
  if (!settings?.telegram_enabled) return "disabled";
  if (!employee?.telegram_id || !secret) return "unconfigured";
  const { data: delivery, error } = await db
    .from("notification_deliveries")
    .insert({
      event_id: eventId,
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
    const recipientIds = new Set([task.employee_id]);
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
    return results.includes("failed")
      ? "failed"
      : results.includes("sent")
        ? "sent"
        : results[0];
  } catch {
    return "failed";
  }
}
