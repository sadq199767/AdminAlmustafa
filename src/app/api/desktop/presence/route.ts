import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  authorize,
  fail,
  serviceClient,
  serviceReady,
} from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { user } = await authorize(req, true);
    if (!serviceReady())
      throw new ApiError(503, "خدمة تسجيل الاتصال غير مهيأة.");

    const seenAt = new Date().toISOString();
    const { data, error } = await serviceClient()
      .from("employees")
      .update({ last_seen_at: seenAt })
      .eq("user_id", user.id)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data)
      throw new ApiError(403, "هذا الحساب غير مرتبط بموظف فعّال.");

    return NextResponse.json(
      { ok: true, seen_at: seenAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
