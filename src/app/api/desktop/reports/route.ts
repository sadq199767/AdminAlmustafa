import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, assertDb, fail, assertSystemRunning } from "@/lib/server";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authorize(req, true);
    await assertSystemRunning();
    const input = z
      .object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        summary: z.string().trim().min(3).max(10000),
      })
      .parse(await req.json());
    const { error } = await db.rpc("submit_daily_report", {
      day: input.day,
      report_summary: input.summary,
    });
    assertDb(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
