import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, assertDb, fail, ApiError, assertSystemRunning, serviceClient } from "@/lib/server";
import { commentSchema } from "@/lib/validation";
import { notifyComment } from "@/lib/telegram";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await authorize(req, true);
    const { id } = await ctx.params;
    z.uuid().parse(id);
    const { data: task } = await db
      .from("tasks")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!task)
      throw new ApiError(403, "لا تملك صلاحية الاطلاع على تعليقات هذه المهمة.");
    const { data, error } = await serviceClient()
      .from("task_comments")
      .select("id,task_id,author_id,author_name,body,created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: true });
    assertDb(error);
    return NextResponse.json(data ?? []);
  } catch (e) {
    return fail(e);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { db, profile } = await authorize(req, true);
    await assertSystemRunning();
    const { id } = await ctx.params;
    z.uuid().parse(id);
    const input = commentSchema.parse(await req.json());
    const { data: task } = await db
      .from("tasks")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!task)
      throw new ApiError(403, "لا تملك صلاحية التعليق على هذه المهمة.");
    const { data, error } = await serviceClient()
      .from("task_comments")
      .insert({
        task_id: id,
        author_id: profile.id,
        author_name: profile.name,
        body: input.body,
      })
      .select("id,task_id,author_id,author_name,body,created_at")
      .single();
    assertDb(error);
    if (data) {
      void notifyComment(data.id, id, profile, input.body);
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}