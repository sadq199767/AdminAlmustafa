import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
  serviceReady,
  assertSystemRunning,
} from "@/lib/server";
import { z } from "zod";
import { employeeSchema } from "@/lib/validation";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const { db, profile } = await authorize(req);
    if (!["owner", "supervisor"].includes(profile.role))
      throw new ApiError(403, "تعديل بيانات الموظف متاح للمالك والمسؤول المباشر فقط.");
    await assertSystemRunning();
    const { id } = await ctx.params;
    const body: Record<string, unknown> = await req.json();
    if (body.password === "") delete body.password;
    if (
      body.email !== undefined &&
      (typeof body.email !== "string" || !body.email.trim())
    )
      throw new ApiError(400, "أدخل بريدًا إلكترونيًا صحيحًا.");
    if (
      body.password !== undefined &&
      (typeof body.password !== "string" ||
        body.password.length < 6 ||
        body.password.length > 12)
    )
      throw new ApiError(400, "كلمة المرور من 6 إلى 12 خانة.");

    const email = typeof body.email === "string" ? body.email.trim() : undefined;
    const password =
      typeof body.password === "string" && body.password ? body.password : undefined;
    const data = employeeSchema.parse(body);

    if (email !== undefined || password !== undefined) {
      if (!serviceReady()) throw new ApiError(503, "مفتاح الخادم غير متاح.");
      const { data: employee, error: employeeError } = await db
        .from("employees")
        .select("user_id, supervisor_id")
        .eq("id", id)
        .single();
      assertDb(employeeError);
      if (employee?.user_id) {
        const admin = serviceClient();
        const { error: authError } = await admin.auth.admin.updateUserById(
          employee.user_id,
          {
            ...(email !== undefined ? { email, email_confirm: true } : {}),
            ...(password ? { password } : {}),
          },
        );
        if (authError) {
          if (["email_exists", "user_already_exists"].includes(authError.code || ""))
            throw new ApiError(409, "البريد الإلكتروني مستخدم لحساب آخر. اختر بريدًا مختلفًا.");
          throw new ApiError(400, "تعذّر تعديل حساب الدخول. تحقق من البريد وكلمة المرور ثم حاول مجددًا.");
        }
      } else if (email && password) {
        const admin = serviceClient();
        const { data: account, error: accountError } =
          await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
        if (accountError || !account.user) {
          if (
            ["email_exists", "user_already_exists"].includes(
              accountError?.code || "",
            )
          )
            throw new ApiError(409, "البريد الإلكتروني مستخدم لحساب آخر. اختر بريدًا مختلفًا.");
          throw new ApiError(400, "تعذّر إنشاء حساب الدخول. تحقق من البريد وكلمة المرور ثم حاول مجددًا.");
        }
        const write = assertDb;
        const { error: profileError } = await admin
          .from("profiles")
          .insert({ id: account.user.id, name: String(body.name ?? ""), role: "employee" });
        write(profileError);
        const { error: userError } = await db
          .from("employees")
          .update({ user_id: account.user.id })
          .eq("id", id);
        assertDb(userError);
      }
    }

    const { data: updated, error } = await db
      .from("employees")
      .update(data)
      .eq("id", id)
      .select()
      .single();
    assertDb(error);
    return NextResponse.json({ ...updated, email: email ?? undefined });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const { db, profile } = await authorize(req);
    if (!["owner", "supervisor"].includes(profile.role))
      throw new ApiError(403, "حذف الموظفين متاح للمالك والمسؤول المباشر فقط.");
    await assertSystemRunning();
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
