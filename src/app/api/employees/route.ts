import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  assertDb,
  fail,
  ApiError,
  serviceClient,
} from "@/lib/server";
import { createEmployeeSchema } from "@/lib/validation";
export async function POST(req: NextRequest) {
  try {
    const { db } = await authorize(req);
    const { email, password, ...input } = createEmployeeSchema.parse(
      await req.json(),
    );
    if (email !== undefined && password !== undefined) {
      const admin = serviceClient();
      // Create Auth first so a duplicate email cannot leave an unlinked employee.
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
        ) {
          throw new ApiError(
            409,
            "البريد الإلكتروني مستخدم لحساب آخر. اختر بريدًا مختلفًا.",
          );
        }
        throw new ApiError(
          400,
          "تعذّر إنشاء حساب الدخول. تحقق من البريد وكلمة المرور ثم حاول مجددًا.",
        );
      }
      try {
        // Both administrators can add employees, but this flow never grants an administrative role.
        const { error: profileError } = await admin
          .from("profiles")
          .insert({ id: account.user.id, name: input.name, role: "employee" });
        assertDb(profileError);
        const { data: employee, error: employeeError } = await admin
          .from("employees")
          .insert({ ...input, user_id: account.user.id })
          .select()
          .single();
        assertDb(employeeError);
        return NextResponse.json(employee, { status: 201 });
      } catch (error) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(
          account.user.id,
        );
        if (cleanupError) {
          // Revoke application access even if the Auth service cannot finish cleanup.
          await admin.from("profiles").delete().eq("id", account.user.id);
          throw new ApiError(
            500,
            "تعذّر إكمال إنشاء الموظف وتنظيف حساب الدخول. راجع حساب البريد في Supabase قبل إعادة المحاولة.",
          );
        }
        throw error;
      }
    }
    // Retain support for existing integrations that create an employee record before its account.
    const { data, error } = await db
      .from("employees")
      .insert(input)
      .select()
      .single();
    assertDb(error);
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
