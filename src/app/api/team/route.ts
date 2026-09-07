import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
} from "@/lib/server";
export async function GET(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    if (profile.role !== "owner") throw new ApiError(403, "متاح للمالك فقط.");
    const { data, error } = await db.from("profiles").select("id,name,role");
    assertDb(error);
    return NextResponse.json(data);
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    if (profile.role !== "owner") throw new ApiError(403, "متاح للمالك فقط.");
    const input = z
      .object({ id: z.string().uuid(), role: z.enum(["manager", "employee"]) })
      .parse(await req.json());
    if (input.id === profile.id)
      throw new ApiError(400, "لا يمكنك تغيير صلاحيات حسابك.");
    const { error } = await db
      .from("profiles")
      .update({ role: input.role })
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
    if (profile.role !== "owner") throw new ApiError(403, "متاح للمالك فقط.");
    const input = z
      .object({
        employee_id: z.string().uuid(),
        email: z.email(),
        password: z.string().min(12).max(72),
        role: z.enum(["manager", "employee"]),
      })
      .parse(await req.json());
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
      .insert({ id: data.user.id, name: employee.name, role: input.role });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw new ApiError(500, "تعذّر تهيئة ملف الحساب.");
    }
    const { data: linked, error: linkError } = await admin
      .from("employees")
      .update({ user_id: data.user.id })
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
