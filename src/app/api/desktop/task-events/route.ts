import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSystemRunning,
  authorize,
  fail,
  serviceClient,
} from "@/lib/server";
import { notifyComment, notifyTask } from "@/lib/telegram";
import type { Task } from "@/lib/types";

const eventSchema = z.object({
  task_id: z.string().uuid(),
  kind: z.enum(["created", "comment"]),
  comment_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req, true);
    await assertSystemRunning();
    const input = eventSchema.parse(await req.json());
    const { data: task } = await db
      .from("tasks")
      .select("*")
      .eq("id", input.task_id)
      .maybeSingle();
    if (!task) throw new ApiError(403, "لا تملك صلاحية الوصول إلى هذه المهمة.");

    if (input.kind === "created") {
      if (task.assigned_by !== profile.id)
        throw new ApiError(403, "مرسل المهمة فقط يستطيع تشغيل إشعار إنشائها.");
      const notification = await notifyTask(
        db,
        task as Task,
        profile,
        "أسند إليك مهمة جديدة",
      );
      return NextResponse.json({ ok: true, notification });
    }

    if (!input.comment_id)
      throw new ApiError(400, "معرّف التعليق مطلوب.");
    const { data: comment } = await serviceClient()
      .from("task_comments")
      .select("id,task_id,author_id,body")
      .eq("id", input.comment_id)
      .eq("task_id", input.task_id)
      .maybeSingle();
    if (!comment || comment.author_id !== profile.id)
      throw new ApiError(403, "كاتب التعليق فقط يستطيع تشغيل إشعاره.");
    const notification = await notifyComment(
      comment.id,
      input.task_id,
      profile,
      comment.body,
    );
    return NextResponse.json({ ok: true, notification });
  } catch (error) {
    return fail(error);
  }
}
