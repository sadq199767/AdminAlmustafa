import { NextRequest, NextResponse } from "next/server";
import { authorize, fail, serviceClient, assertDb } from "@/lib/server";
export async function GET(req: NextRequest) {
  try {
    await authorize(req, true);
    const client = serviceClient();
    const { data: employees, error } = await client
      .from("employees")
      .select("id, name, profession")
      .is("archived_at", null)
      .order("name");
    assertDb(error);
    const entries = (employees ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      profession: e.profession ?? "",
    }));
    return NextResponse.json(entries, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}