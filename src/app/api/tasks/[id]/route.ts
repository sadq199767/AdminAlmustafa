import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail, ApiError, assertSystemRunning } from "@/lib/server";
import { statusSchema } from "@/lib/validation";
import { notifyTask } from "@/lib/telegram";
import { z } from "zod";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { db, profile } = await authorize(req);
    await assertSystemRunning();
    const { id } = await ctx.params;
    z.uuid().parse(id);
    const { error } = await db.rpc("delete_task", { target_id: id });
    if (error?.code === "P0002")
      throw new ApiError(404, "المهمة غير موجودة أو حُذفت مسبقًا.");
    if (error?.code === "42501")
      throw new ApiError(403, "يمكنك حذف المهام التي أضفتها أنت فقط.");
    assertDb(error);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { db, profile, user } = await authorize(req, true);
    await assertSystemRunning();
    const { id } = await ctx.params;
    const input = statusSchema.parse(await req.json());
    const { data: existing } = await db
      .from("tasks")
      .select("*")
      .eq("id", id)
      .single();
    if (!existing) throw new ApiError(404, "المهمة غير موجودة.");
    if (existing.status === input.status) return NextResponse.json(existing);
    const { data: actorEmployee } = await db
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
    const completedBy =
      input.status === "done" ? actorEmployee?.id ?? null : null;
    const { data, error } = await db
      .from("tasks")
      .update({ ...input, completed_by: completedBy })
      .eq("id", id)
      .select()
      .single();
    assertDb(error);
    const notification = await notifyTask(
      db,
      data,
      profile,
      "حدّث حالة المهمة",
    );
    return NextResponse.json({ ...data, notification });
  } catch (e) {
    return fail(e);
  }
}
