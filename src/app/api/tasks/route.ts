import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail } from "@/lib/server";
import { taskSchema } from "@/lib/validation";
import { notifyTask } from "@/lib/telegram";
export async function POST(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    const input = taskSchema.parse(await req.json());
    const { data, error } = await db
      .from("tasks")
      .insert({ ...input, assigned_by: profile.id })
      .select()
      .single();
    assertDb(error);
    const notification = await notifyTask(
      db,
      data,
      profile,
      "أسند إليك مهمة جديدة",
    );
    return NextResponse.json({ ...data, notification }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
