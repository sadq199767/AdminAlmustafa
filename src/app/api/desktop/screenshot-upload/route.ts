import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  assertSystemRunning,
  authorize,
  fail,
  serviceClient,
} from "@/lib/server";
import { sendScreenshotToChat } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authorize(req, true);
    await assertSystemRunning();
    const form = await req.formData();
    const requestId = String(form.get("request_id") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(requestId))
      throw new ApiError(400, "طلب لقطة الشاشة غير صالح.");
    const files = form.getAll("screens").filter((value): value is File => value instanceof File);
    if (!files.length || files.length > 4)
      throw new ApiError(400, "عدد صور الشاشات غير صالح.");
    if (files.some((file) => file.type !== "image/jpeg" || file.size > 8_000_000))
      throw new ApiError(400, "ملف لقطة الشاشة غير صالح أو كبير جدًا.");

    const { data: employee } = await db
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
    const admin = serviceClient();
    const { data: screenshotRequest } = await admin
      .from("screenshot_requests")
      .select("id,employee_id,requester_id,status")
      .eq("id", requestId)
      .maybeSingle();
    if (!employee || !screenshotRequest || screenshotRequest.employee_id !== employee.id || screenshotRequest.status !== "pending")
      throw new ApiError(403, "طلب لقطة الشاشة غير متاح لهذا الجهاز.");
    const { data: recipient } = await admin
      .from("employees")
      .select("id,telegram_id")
      .eq("user_id", screenshotRequest.requester_id)
      .is("archived_at", null)
      .maybeSingle();
    let chatId = recipient?.telegram_id ?? null;
    let recipientForLog = recipient?.id ?? null;
    if (!chatId || !recipientForLog) {
      const { data: profile } = await admin
        .from("profiles")
        .select("telegram_id")
        .eq("id", screenshotRequest.requester_id)
        .maybeSingle();
      const profileChat = profile?.telegram_id ?? null;
      if (!profileChat) throw new ApiError(400, "حساب المسؤول الطالب غير مرتبط بمعرّف تلكرام.");
      if (!chatId) chatId = profileChat;
      if (!recipientForLog) {
        const { data: fallback } = await admin
          .from("employees")
          .select("id")
          .eq("telegram_id", profileChat)
          .is("archived_at", null)
          .limit(1)
          .maybeSingle();
        recipientForLog = fallback?.id ?? null;
      }
    }
    if (!chatId || !recipientForLog)
      throw new ApiError(400, "حساب المسؤول الطالب غير مرتبط بمعرّف تلكرام.");

    const images = await Promise.all(files.map(async (file, index) => ({
      bytes: await file.arrayBuffer(),
      name: `screen-${index + 1}.jpg`,
    })));
    const notification = await sendScreenshotToChat(
      `screenshot-${requestId}`,
      chatId,
      recipientForLog,
      images,
    );
    if (!['sent','duplicate'].includes(notification))
      throw new ApiError(502, `تعذّر إرسال لقطة الشاشة عبر تلكرام (${notification}).`);
    return NextResponse.json({ ok: true, notification });
  } catch (error) {
    return fail(error);
  }
}
