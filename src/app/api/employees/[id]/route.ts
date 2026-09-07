import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
} from "@/lib/server";
import { z } from "zod";
import { employeeSchema } from "@/lib/validation";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const { db, profile } = await authorize(req);
    if (profile.role !== "owner")
      throw new ApiError(403, "تعديل بيانات الموظف متاح للمالك فقط.");
    const { id } = await ctx.params;
    const { data, error } = await db
      .from("employees")
      .update(employeeSchema.parse(await req.json()))
      .eq("id", id)
      .select()
      .single();
    assertDb(error);
    return NextResponse.json(data);
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const { db } = await authorize(req);
    const { id } = await ctx.params;
    z.uuid().parse(id);
    const { data: userId, error } = await db.rpc("delete_employee", {
      target_id: id,
    });
    assertDb(error);
    let authCleanupPending = false;
    if (userId) {
      try {
        const { error } = await serviceClient().auth.admin.deleteUser(userId);
        authCleanupPending = Boolean(error);
      } catch {
        authCleanupPending = true;
      }
    }
    return NextResponse.json({
      ok: true,
      auth_cleanup_pending: authCleanupPending,
    });
  } catch (e) {
    return fail(e);
  }
}
