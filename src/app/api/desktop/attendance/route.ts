import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail, assertSystemRunning } from "@/lib/server";
import { attendanceSchema } from "@/lib/validation";
import { notifyAttendance } from "@/lib/telegram";

export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authorize(req, true);
    await assertSystemRunning();
    const payload = attendanceSchema.parse(await req.json());
    const { data: before } = await db
      .from("attendance")
      .select("ended_at")
      .eq("id", payload.id)
      .maybeSingle();
    const { error } = await db.rpc("sync_attendance", { payload });
    assertDb(error);
    const { data: employee } = await db
      .from("employees")
      .select("id, name")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .maybeSingle();
    const isStart = !before && !payload.ended_at;
    const isEnd = Boolean(payload.ended_at && before && !before.ended_at);
    if (employee?.id && (isStart || isEnd)) {
      const time = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Baghdad",
      }).format(new Date());
      const h = Math.floor(payload.attendance_seconds / 3600);
      const m = Math.floor((payload.attendance_seconds % 3600) / 60);
      const duration =
        h > 0 ? `${h} ساعة${m ? ` و${m} دقيقة` : ""}` : `${m} دقيقة`;
      void notifyAttendance(employee.id, { isEnd, duration, time });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
