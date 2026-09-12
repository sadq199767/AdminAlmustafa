import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail, ApiError, assertSystemRunning } from "@/lib/server";
import { taskSchema } from "@/lib/validation";
import { notifyTask } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    if (!["owner", "supervisor"].includes(profile.role) && !profile.can_follow_tasks)
      throw new ApiError(403, "إسناد المهام متاح للمالك والمسؤول المباشر والمتابع فقط.");
    await assertSystemRunning();
    const input = taskSchema.parse(await req.json());
    const chosen = input.assignee_ids.length ? input.assignee_ids : [];
    if (input.employee_id && !chosen.includes(input.employee_id))
      chosen.unshift(input.employee_id);
    const assignee_ids = [...new Set(chosen)];
    if (!assignee_ids.length)
      throw new ApiError(400, "اختر موظفًا واحدًا على الأقل للمهمة.");
    if (assignee_ids.length > 8)
      throw new ApiError(400, "الحد الأقصى 8 موظفين لكل مهمة.");
    if (profile.can_follow_tasks && !["owner", "supervisor"].includes(profile.role)) {
      const id = crypto.randomUUID();
      const { data, error } = await db.rpc("save_employee_task", {
        p_id: id,
        p_create: true,
        p_title: input.title,
        p_description: input.description,
        p_priority: input.priority,
        p_due_date: input.due_date,
        p_assignee_ids: assignee_ids,
      });
      assertDb(error);
      const task = data as Parameters<typeof notifyTask>[1];
      const notification = await notifyTask(
        db,
        task,
        profile,
        "أسند إليك مهمة جديدة",
      );
      return NextResponse.json({ ...task, notification }, { status: 201 });
    }
    const { data: active } = await db
      .from("employees")
      .select("id")
      .in("id", assignee_ids)
      .is("archived_at", null);
    if (!active || active.length !== assignee_ids.length)
      throw new ApiError(400, "أحد الموظفين المختارين غير صالح أو مؤرشف.");
    const employee_id = assignee_ids[0];
    const { data, error } = await db
      .from("tasks")
      .insert({ ...input, assignee_ids: undefined, employee_id, assigned_by: profile.id })
      .select()
      .single();
    assertDb(error);
    const { error: ae } = await db
      .from("task_assignees")
      .upsert(
        assignee_ids.map((employee_id) => ({ task_id: data.id, employee_id })),
        { onConflict: "task_id,employee_id" },
      );
    assertDb(ae);
    const notification = await notifyTask(
      db,
      data,
      profile,
      "أسند إليك مهمة جديدة",
    );
    return NextResponse.json({ ...data, assignee_ids, notification }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
