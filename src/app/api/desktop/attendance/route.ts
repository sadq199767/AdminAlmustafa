import { NextRequest, NextResponse } from "next/server";
import { authorize, assertDb, fail, assertSystemRunning } from "@/lib/server";
import { attendanceSchema } from "@/lib/validation";
import { notifyAttendance } from "@/lib/telegram";
import { attendanceNotificationForTransition } from "@/lib/attendance-notifications";

export async function POST(req: NextRequest) {
  try {
    const { db, user } = await authorize(req, true);
    await assertSystemRunning();
    const parsed = attendanceSchema.parse(await req.json());
    const { notification_event: requestedEvent, ...payload } = parsed;
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
    const notificationEvent = attendanceNotificationForTransition({
      existedBefore: Boolean(before),
      previousEndedAt: before?.ended_at ?? null,
      startedAt: payload.started_at,
      endedAt: payload.ended_at,
      requestedEvent,
    });
    if (employee?.id && notificationEvent) {
      const occurredAt = notificationEvent === "end"
        ? payload.ended_at!
        : payload.started_at;
      const time = new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Baghdad",
      }).format(new Date(occurredAt));
      const h = Math.floor(payload.attendance_seconds / 3600);
      const m = Math.floor((payload.attendance_seconds % 3600) / 60);
      const duration =
        h > 0 ? `${h} ساعة${m ? ` و${m} دقيقة` : ""}` : `${m} دقيقة`;
      void notifyAttendance(employee.id, {
        eventId: payload.id,
        isEnd: notificationEvent === "end",
        duration,
        time,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
