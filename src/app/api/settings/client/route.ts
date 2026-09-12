import { NextRequest, NextResponse } from "next/server";
import { authorize, fail, serviceClient, assertDb } from "@/lib/server";
export async function GET(req: NextRequest) {
  try {
    await authorize(req, true);
    const { data, error } = await serviceClient()
      .from("app_settings")
      .select("idle_threshold_minutes, system_suspended, system_suspend_reason")
      .eq("id", 1)
      .single();
    assertDb(error);
    return NextResponse.json(
      {
        idle_threshold_minutes: data?.idle_threshold_minutes ?? 10,
        system_suspended: Boolean(data?.system_suspended),
        system_suspend_reason: data?.system_suspend_reason ?? "",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}