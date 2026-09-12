import { NextResponse } from "next/server";
import { serviceClient, serviceReady, fail, assertDb } from "@/lib/server";

export async function GET() {
  try {
    if (!serviceReady()) {
      return NextResponse.json(
        { system_suspended: false, system_suspend_reason: "" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data, error } = await serviceClient()
      .from("app_settings")
      .select("system_suspended, system_suspend_reason")
      .eq("id", 1)
      .single();
    assertDb(error);
    return NextResponse.json(
      {
        system_suspended: Boolean(data?.system_suspended),
        system_suspend_reason: data?.system_suspend_reason ?? "",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}