import { NextRequest, NextResponse } from "next/server";
import {
  authorize,
  serviceClient,
  serviceReady,
  fail,
  assertDb,
} from "@/lib/server";

// المسؤول المباشر/المالك/الإدارة يطلبون التقاط شاشة موظف معيّن.
// يُنشئ الطلب في جدول screenshot_requests، ويلتقطه تطبيق الديسكتوب
// الخاص بالموظف ويرسله لتلكرام.
//
// يُنشأ الطلب عبر سكربت الخدمة (service_role) لأنه يتجاوز RLS بثبات،
// بينما ضيّق authorize() عليه مسبقاً من يستطيع استدعاء المسار (مالك/
// إدارة/مسؤول مباشر فقط). requester_id يُثبّت بأنه هوية الطالب نفسه
// (منع انتحال الهوية) من منتصف التحقق الموثوق.
export async function POST(request: NextRequest) {
  try {
    const { user, profile } = await authorize(request);
    const { employee_id } = (await request.json()) as { employee_id?: string };

    if (!employee_id)
      return NextResponse.json(
        { error: "حدّد الموظف المطلوب التقاط شاشته." },
        { status: 400 },
      );

    if (!serviceReady())
      return NextResponse.json(
        { error: "مفتاح الخادم غير مهيّأ لإنشاء الطلب." },
        { status: 503 },
      );
    const db = serviceClient();

    // تأكد من وجود الموظف وعدم أرشفته
    const { data: emp, error: empErr } = await db
      .from("employees")
      .select("id")
      .eq("id", employee_id)
      .is("archived_at", null)
      .maybeSingle();
    assertDb(empErr);
    if (!emp)
      return NextResponse.json(
        { error: "الموظف غير موجود أو مؤرشف." },
        { status: 404 },
      );

    const { data, error } = await db
      .from("screenshot_requests")
      .insert({ employee_id, requester_id: user.id })
      .select("id, created_at")
      .single();

    if (error) {
      // قد لا يكون الجدول مهاجراً بعد — أعد رسالة واضحة
      if (/relation .*screenshot_requests.* does not exist/.test(error.message))
        return NextResponse.json(
          {
            error:
              "جدول طلبات التقاط الشاشة غير مفعّل بعد. طبّق هجرة 011 على قاعدة البيانات أولاً.",
          },
          { status: 501 },
        );
      assertDb(error);
    }

    return NextResponse.json(
      {
        ok: true,
        request: data,
        requested_by: profile.name,
      },
      { status: 201 },
    );
  } catch (e) {
    return fail(e);
  }
}
