import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail } from "@/lib/server";
import { attendanceSchema } from "@/lib/validation";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authorize(req, true);
    const payload = attendanceSchema.parse(await req.json());
    const { error } = await db.rpc("sync_attendance", { payload });
    assertDb(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
