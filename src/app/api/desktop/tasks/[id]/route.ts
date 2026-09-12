import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize, assertDb, fail, ApiError, assertSystemRunning } from '@/lib/server';
import { saveDesktopTask } from '@/lib/desktop-task-mutation';
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return saveDesktopTask(req, (await ctx.params).id);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { db, user } = await authorize(req, true);
    await assertSystemRunning();
    const { id } = await ctx.params;
    z.uuid().parse(id);
    const { data: existing } = await db
      .from("tasks")
      .select("id,assigned_by")
      .eq("id", id)
      .single();
    if (!existing)
      throw new ApiError(404, "المهمة غير موجودة أو حُذفت.");
    if (existing.assigned_by !== user.id)
      throw new ApiError(403, "يمكنك حذف المهام التي أضفتها أنت فقط.");
    const { error } = await db.rpc("delete_task", { target_id: id });
    if (error?.code === "P0002")
      throw new ApiError(404, "المهمة غير موجودة أو حُذفت.");
    if (error?.code === "42501")
      throw new ApiError(
        403,
        "لا تملك صلاحية حذف هذه المهمة؛ يمكنك حذف ما أضفته أنت فقط.",
      );
    assertDb(error);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return fail(e);
  }
}