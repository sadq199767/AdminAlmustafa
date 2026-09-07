import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
} from "@/lib/server";
import { settingsSchema } from "@/lib/validation";
import { encryptToken } from "@/lib/telegram";
export async function PATCH(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    if (profile.role !== "owner")
      throw new ApiError(403, "إعدادات النظام متاحة للمالك فقط.");
    const body = await req.json();
    const input = settingsSchema.parse(body);
    if (body.bot_token) {
      if (
        typeof body.bot_token !== "string" ||
        !/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(body.bot_token)
      )
        throw new ApiError(400, "توكن البوت غير صالح.");
      const encrypted = encryptToken(body.bot_token);
      const admin = serviceClient();
      const response = await fetch(
        `https://api.telegram.org/bot${body.bot_token}/getMe`,
        { signal: AbortSignal.timeout(8000) },
      );
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new ApiError(400, "لم يقبل تلكرام هذا التوكن.");
      const { error } = await admin
        .from("bot_secrets")
        .upsert({
          id: 1,
          encrypted_token: encrypted,
          updated_at: new Date().toISOString(),
        });
      assertDb(error);
    }
    const { error } = await db.from("app_settings").update(input).eq("id", 1);
    assertDb(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
