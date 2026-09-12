import type { AppData, Employee } from "./types";
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
  workDays: number[],
  today = todayInBaghdad(),
) {
  const [year, mo] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (
      date <= today &&
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
