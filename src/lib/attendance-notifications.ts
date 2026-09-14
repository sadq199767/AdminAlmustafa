export type AttendanceNotificationEvent = "start" | "end" | "none";

const MAX_NOTIFICATION_DELAY_MS = 5 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 60 * 1000;

type AttendanceTransition = {
  existedBefore: boolean;
  previousEndedAt: string | null;
  startedAt: string;
  endedAt: string | null;
  requestedEvent?: AttendanceNotificationEvent;
  now?: Date;
};

function isRecentEvent(occurredAt: string, now: Date): boolean {
  const eventTime = Date.parse(occurredAt);
  if (!Number.isFinite(eventTime)) return false;
  const age = now.getTime() - eventTime;
  return age >= -MAX_FUTURE_CLOCK_SKEW_MS && age <= MAX_NOTIFICATION_DELAY_MS;
}

export function attendanceNotificationForTransition({
  existedBefore,
  previousEndedAt,
  startedAt,
  endedAt,
  requestedEvent,
  now = new Date(),
}: AttendanceTransition): Exclude<AttendanceNotificationEvent, "none"> | null {
  const transition = !existedBefore && !endedAt
    ? "start"
    : existedBefore && !previousEndedAt && endedAt
      ? "end"
      : null;

  if (!transition || requestedEvent === "none") return null;
  if (requestedEvent && requestedEvent !== transition) return null;

  const occurredAt = transition === "start" ? startedAt : endedAt;
  return occurredAt && isRecentEvent(occurredAt, now) ? transition : null;
}
