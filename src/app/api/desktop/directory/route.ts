import { NextRequest, NextResponse } from "next/server";
import { authorize, fail, serviceClient, assertDb } from "@/lib/server";
export async function GET(req: NextRequest) {
  try {
    await authorize(req, true);
    const { data, error } = await serviceClient()
      .from("employees")
      .select("id,name,profession")
      .is("archived_at", null)
      .order("name");
    assertDb(error);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
