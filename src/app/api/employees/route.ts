import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail } from "@/lib/server";
import { employeeSchema } from "@/lib/validation";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authorize(req);
    const input = employeeSchema.parse(await req.json());
    const { data, error } = await db
      .from("employees")
      .insert(input)
      .select()
      .single();
    assertDb(error);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
