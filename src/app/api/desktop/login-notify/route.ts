import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  fail,
  serviceClient,
  serviceReady,
  assertSystemRunning,
} from "@/lib/server";
import { sendNotification } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { profile, user } = await authorize(req, true);
    await assertSystemRunning();
    if (!serviceReady())
      return NextResponse.json({ ok: true, sent: false });

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
      .select("id, telegram_id, name")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();

    if (!employee?.id) return NextResponse.json({ ok: true, sent: false });

    const now = new Date();
    const time = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Baghdad",
    }).format(now);

    let sent = false;
    if (employee.telegram_id) {
      const message = `🔔 مرحبًا ${profile.name} 👋\nتم تسجيل دخولك إلى تطبيق الموظفين.\nالوقت: ${time}`;
      const result = await sendNotification(
        `login-${user.id}-${now.getTime()}`,
        employee.id,
        message,
      );
      sent = result === "sent";
    }
    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    return fail(e);
  }
}
