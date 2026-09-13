import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ApiError,
  assertSystemRunning,
  authorize,
  fail,
  serviceClient,
} from "@/lib/server";
import { notifyComment, notifyTask, sendNotification } from "@/lib/telegram";
import type { Task } from "@/lib/types";

const eventSchema = z.object({
  task_id: z.string().uuid(),
  kind: z.enum(["created", "comment", "assignee_done"]),
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

    if (input.kind === "assignee_done") {
      const sdb = serviceClient();
      const { data: actorEmp } = await sdb
        .from("employees")
        .select("id, name")
        .eq("user_id", profile.id)
        .is("archived_at", null)
        .maybeSingle();
      if (!actorEmp)
        throw new ApiError(403, "الموظف غير مسجل في المنصة.");
      const { data: assignees } = await sdb
        .from("task_assignees")
        .select("employee_id")
        .eq("task_id", task.id);
      const recipients = new Set<string>();
      for (const a of assignees ?? []) recipients.add(a.employee_id);
      if (task.assigned_by && task.assigned_by !== profile.id) {
        const { data: assigner } = await sdb
          .from("employees")
          .select("id")
          .eq("user_id", task.assigned_by)
          .maybeSingle();
        if (assigner) recipients.add(assigner.id);
      }
      recipients.delete(actorEmp.id);
      const text = `✅ ${actorEmp.name} أنهى عمله على المهمة «${task.title}»`;
      const stamp = `assignee-done-${task.id}-${profile.id}-${Date.now()}`;
      const results = await Promise.all(
        [...recipients].map((id, i) =>
          sendNotification(`${stamp}-${i}`, id, text),
        ),
      );
      return NextResponse.json({
        ok: true,
        notification: results.includes("failed")
          ? "failed"
          : results.includes("sent")
            ? "sent"
            : results[0],
      });
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
