import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
  assertSystemRunning,
} from "@/lib/server";
import { sendNotification } from "@/lib/telegram";
export async function POST(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req, true);
    await assertSystemRunning();
    const input = z
      .object({
        task_id: z.string().uuid(),
        reviewer_id: z.string().uuid(),
        note: z.string().max(2000).default(""),
      })
      .parse(await req.json());
    const { data: task } = await db
      .from("tasks")
      .select("*")
      .eq("id", input.task_id)
      .single();
    if (!task) throw new ApiError(404, "المهمة غير موجودة.");
    if (profile.role === "employee") {
      const { data: emp } = await db
        .from("employees")
        .select("id")
        .eq("user_id", profile.id)
        .single();
      if (emp?.id !== task.employee_id)
        throw new ApiError(403, "لا يمكنك طلب مراجعة لهذه المهمة.");
    }
    const admin = serviceClient();
    const { data: reviewer } = await admin
      .from("employees")
      .select("id")
      .eq("id", input.reviewer_id)
      .is("archived_at", null)
      .single();
    if (!reviewer) throw new ApiError(400, "المراجع غير موجود.");
    const { data, error } = await admin
      .from("review_requests")
      .insert({ ...input, requested_by: profile.id })
      .select("id")
      .single();
    assertDb(error);
    let notification = "failed";
    try {
      notification = await sendNotification(
        data!.id,
        input.reviewer_id,
        `${profile.name} طلب مراجعتك للمهمة: ${task.title}\n${input.note}`,
      );
    } catch {}
    return NextResponse.json({ ok: true, notification });
  } catch (e) {
    return fail(e);
  }
}
