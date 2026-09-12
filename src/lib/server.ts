import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Profile } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const serviceReady = () =>
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
export function serviceClient() {
  if (!serviceReady())
    throw new ApiError(
      503,
      "تحتاج هذه الميزة إعداد مفتاح الخادم في ملف البيئة.",
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function authorize(request: NextRequest, allowEmployee = false) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError(503, "لم يكتمل ربط Supabase بعد.");
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new ApiError(401, "يرجى تسجيل الدخول.");
  const db = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user)
    throw new ApiError(401, "انتهت الجلسة. سجل الدخول مجددًا.");
  let { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id,name,role,can_follow_tasks")
    .eq("id", user.id)
    .single();
  // يبقي تسجيل دخول الإدارة عاملاً قبل تطبيق ترقية العمود الجديد.
  if (profileError?.code === "42703") {
    const fallback = await db
      .from("profiles")
      .select("id,name,role")
      .eq("id", user.id)
      .single();
    profile = fallback.data
      ? { ...fallback.data, can_follow_tasks: false }
      : null;
    profileError = fallback.error;
  }
  if (
    profileError ||
    !profile ||
    (!allowEmployee &&
      !["owner", "management", "supervisor"].includes(profile.role) &&
      !profile.can_follow_tasks)
  )
    throw new ApiError(403, "هذا الحساب لا يملك صلاحية استخدام لوحة الإدارة.");
  const { data: employee } = await db
    .from("employees")
    .select("archived_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (employee?.archived_at)
    throw new ApiError(403, "هذا الحساب مؤرشف. تواصل مع المالك.");
  return { db, profile: profile as Profile, user };
}
export function fail(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      { error: "تحقق من الحقول المدخلة.", fields: error.flatten().fieldErrors },
      { status: 400 },
    );
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  return NextResponse.json(
    {
      error:
        "تعذّر إتمام العملية. تحقق من اتصال قاعدة البيانات وإعداد الجداول.",
    },
    { status: 500 },
  );
}
export function assertDb(error: { message: string } | null) {
  if (error)
    throw new ApiError(400, "تعذّر حفظ البيانات. تحقق من المدخلات والصلاحيات.");
}
export async function assertSystemRunning() {
  if (!serviceReady()) return;
  const { data, error } = await serviceClient()
    .from("app_settings")
    .select("system_suspended, system_suspend_reason")
    .eq("id", 1)
    .single();
  if (error) return;
  if (data?.system_suspended) {
    const reason = (data.system_suspend_reason || "").trim();
    throw new ApiError(
      423,
      reason
        ? `النظام موقوف مؤقتًا من قبل المالك: ${reason}`
        : "النظام موقوف مؤقتًا من قبل المالك. أعد المحاولة لاحقًا.",
    );
  }
}
