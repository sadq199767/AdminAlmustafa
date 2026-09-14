import type { AppData, Attendance, Employee } from "./types";

const PRESENCE_TIMEOUT_MS = 180_000;

export function isEmployeeOnline(
  employee: Pick<Employee, "last_seen_at"> & { id?: string },
  attendanceOrNow: Attendance[] | number = [],
  now = Date.now(),
) {
  const attendance = Array.isArray(attendanceOrNow) ? attendanceOrNow : [];
  const clock = typeof attendanceOrNow === "number" ? attendanceOrNow : now;
  const isRecent = (value?: string | null) => {
    if (!value) return false;
    const seenAt = Date.parse(value);
    const age = clock - seenAt;
    return Number.isFinite(seenAt) && age >= -60_000 && age < PRESENCE_TIMEOUT_MS;
  };

  if (isRecent(employee.last_seen_at)) return true;

  const today = todayInBaghdad(new Date(clock));
  return attendance.some(
    (entry) =>
      Boolean(employee.id) &&
      entry.employee_id === employee.id &&
      entry.work_date === today &&
      !entry.ended_at &&
      isRecent(entry.updated_at),
  );
}

export type AttendanceDay = {
  work_date: string;
  attendance_seconds: number;
  active_seconds: number;
  started_at: string;
  ended_at: string | null;
  sessions: Attendance[];
};

export function attendanceByDay(entries: Attendance[]): AttendanceDay[] {
  const grouped = new Map<string, Attendance[]>();
  for (const entry of entries) {
    const sessions = grouped.get(entry.work_date) ?? [];
    sessions.push(entry);
    grouped.set(entry.work_date, sessions);
  }

  return [...grouped.entries()]
    .map(([work_date, entriesForDay]) => {
      const sessions = [...entriesForDay].sort((a, b) =>
        a.started_at.localeCompare(b.started_at),
      );
      const hasOpenSession = sessions.some((entry) => !entry.ended_at);
      const endedAt = hasOpenSession
        ? null
        : sessions.reduce<string | null>(
            (latest, entry) =>
              !latest || (entry.ended_at && entry.ended_at > latest)
                ? entry.ended_at
                : latest,
            null,
          );

      return {
        work_date,
        attendance_seconds: sessions.reduce(
          (total, entry) => total + entry.attendance_seconds,
          0,
        ),
        active_seconds: sessions.reduce(
          (total, entry) => total + entry.active_seconds,
          0,
        ),
        started_at: sessions[0].started_at,
        ended_at: endedAt,
        sessions,
      };
    })
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
}

export const todayInBaghdad = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const hours = (seconds: number) => Math.round(seconds / 360) / 10;
export function requiredHours(
  employee: Employee,
  month: string,
  fallbackWorkDays = [0, 1, 2, 3, 4],
) {
  const workDays = employee.work_days?.length
    ? employee.work_days
    : fallbackWorkDays;
  const [year, mo] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (
      date >= employee.joined_on &&
      workDays.includes(new Date(Date.UTC(year, mo - 1, day)).getUTCDay())
    )
      count++;
  }
  return count * employee.daily_hours;
}
export function employeeMetrics(
  data: AppData,
  employee: Employee,
  month: string,
) {
  const logs = data.attendance.filter(
    (a) => a.employee_id === employee.id && a.work_date.startsWith(month),
  );
  const attendance = logs.reduce((s, a) => s + a.attendance_seconds, 0);
  const active = logs.reduce((s, a) => s + a.active_seconds, 0);
  const required = requiredHours(employee, month, data.settings.work_days);
  return {
    attendance,
    active,
    required,
    requiredDays: required / employee.daily_hours,
    percent:
      required > 0 ? Math.round((attendance / 3600 / required) * 100) : 0,
    completed: data.tasks.filter(
      (t) =>
        (t.employee_id === employee.id ||
          t.assignee_ids.includes(employee.id)) &&
        t.status === "done" &&
        t.completed_at &&
        todayInBaghdad(new Date(t.completed_at)).startsWith(month),
    ).length,
  };
}
