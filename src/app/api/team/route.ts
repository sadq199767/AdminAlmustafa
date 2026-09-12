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
const manage = (role: string) =>
  ["owner", "supervisor"].includes(role)
    ? null
    : new ApiError(403, "إدارة الحسابات متاحة للمالك والمسؤول المباشر فقط.");
const assignableRoles = ["management", "supervisor", "employee", "follower"] as const;
function canAssign(actorRole: string, targetRole: string) {
  if (actorRole === "owner") return null;
  if (targetRole === "employee" || targetRole === "follower")
    return null;
  return new ApiError(403, "تعيين مسؤول أو إدارة متاح للمالك فقط.");
}
export async function GET(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    const denied = manage(profile.role);
    if (denied) throw denied;
    const { data, error } = await db.from("profiles").select("id,name,role,can_follow_tasks");
    assertDb(error);
    return NextResponse.json(data);
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    await assertSystemRunning();
    const input = z
      .object({
        id: z.string().uuid(),
        role: z.enum(assignableRoles).optional(),
        can_follow_tasks: z.boolean().optional(),
      })
      .refine((value) => value.role !== undefined || value.can_follow_tasks !== undefined)
      .parse(await req.json());
    if (input.id === profile.id)
      throw new ApiError(400, "لا يمكنك تغيير صلاحيات حسابك.");
    if (input.role) {
      const denied = canAssign(profile.role, input.role);
      if (denied) throw denied;
    }
    if (input.can_follow_tasks !== undefined && profile.role !== "owner")
      throw new ApiError(403, "صلاحية المتابع يحددها المالك فقط.");
    const { error } = await db
      .from("profiles")
      .update(input)
      .eq("id", input.id);
    assertDb(error);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const { profile } = await authorize(req);
    await assertSystemRunning();
    const input = z
      .object({
        employee_id: z.string().uuid(),
        email: z.email(),
        password: z.string().min(6).max(12),
        role: z.enum(assignableRoles),
        can_follow_tasks: z.boolean().optional().default(false),
        telegram_id: z.string().trim().max(32).optional(),
      })
      .parse(await req.json());
    const denied = canAssign(profile.role, input.role);
    if (denied) throw denied;
    if (input.can_follow_tasks && profile.role !== "owner")
      throw new ApiError(403, "صلاحية المتابع يحددها المالك فقط.");
    const admin = serviceClient();
    const { data: employee } = await admin
      .from("employees")
      .select("id,name,user_id")
      .eq("id", input.employee_id)
      .is("archived_at", null)
      .single();
    if (!employee || employee.user_id)
      throw new ApiError(400, "الموظف غير متاح أو لديه حساب بالفعل.");
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (error || !data.user)
      throw new ApiError(
        400,
        "تعذّر إنشاء الحساب. تحقق من البريد ومتطلبات كلمة المرور.",
      );
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: data.user.id, name: employee.name, role: input.role, can_follow_tasks: input.can_follow_tasks });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new ApiError(500, "تعذّر تهيئة ملف الحساب.");
    }
    const linkedEmployee: { telegram_id?: string } = {};
    if (input.telegram_id) linkedEmployee.telegram_id = input.telegram_id;
    const { data: linked, error: linkError } = await admin
      .from("employees")
      .update({ user_id: data.user.id, ...linkedEmployee })
      .eq("id", employee.id)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (linkError || !linked) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new ApiError(409, "تعذّر ربط الحساب بالموظف.");
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
