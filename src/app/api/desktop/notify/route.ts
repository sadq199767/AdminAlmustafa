import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  fail,
  serviceClient,
  serviceReady,
  assertSystemRunning,
} from "@/lib/server";
import { sendNotification } from "@/lib/telegram";

export const dynamic = "force-dynamic";

const notifySchema = z.object({
  event: z.enum([
    "attendance_start",
    "attendance_end",
    "report",
    "task_status",
    "review",
  ]),
  detail: z.record(z.string(), z.string()).optional(),
});

const statusNames: Record<string, string> = {
  todo: "مطلوب",
  in_progress: "قيد العمل",
  done: "منجز",
};

function buildText(
  event: string,
  detail: Record<string, string> | undefined,
  time: string,
) {
  switch (event) {
    case "attendance_start":
      return `\u{1F7E2} بدأت الدوام الآن\n\u{1F550} ${time}`;
    case "attendance_end":
      return `\u{1F534} أنهيت الدوام\n\u{23F1} المدة: ${detail?.duration || "—"}\n\u{1F550} ${time}`;
    case "report":
      return `\u{1F4C4} أرسلتَ تقرير اليوم\n\u{1F550} ${time}`;
    case "task_status":
      return `\u{1F539} غيّرتَ حالة المهمة «${detail?.title || ""}» إلى «${statusNames[detail?.status || ""] || detail?.status || ""}»\n\u{1F550} ${time}`;
    case "review":
      return `\u{1F9FE} طلبتَ مراجعة على المهمة «${detail?.title || ""}»\n\u{1F550} ${time}`;
    default:
      return `حدث جديد في التطبيق\n\u{1F550} ${time}`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await authorize(req, true);
    await assertSystemRunning();
    const body = notifySchema.parse(await req.json());
    if (!serviceReady()) return NextResponse.json({ ok: true, sent: false });

    const db = serviceClient();
    const { data: settings } = await db
      .from("app_settings")
      .select("telegram_enabled")
      .eq("id", 1)
      .single();
    if (!settings?.telegram_enabled)
      return NextResponse.json({ ok: true, sent: false });

    const { data: employee } = await db
      .from("employees")
      .select("id, telegram_id")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
    if (!employee?.id || !employee.telegram_id)
      return NextResponse.json({ ok: true, sent: false });

    const time = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Baghdad",
    }).format(new Date());

    const message = buildText(body.event, body.detail, time);
    const result = await sendNotification(
      `${body.event}-${user.id}-${Date.now()}`,
      employee.id,
      message,
    );
    return NextResponse.json({ ok: true, sent: result === "sent" });
  } catch (e) {
    return fail(e);
  }
}