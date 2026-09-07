import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceSchema,
  employeeSchema,
  taskSchema,
  settingsSchema,
} from "../src/lib/validation";
test("rejects productive duration exceeding attendance", () => {
  assert.equal(
    attendanceSchema.safeParse({
      id: crypto.randomUUID(),
      work_date: "2026-09-07",
      started_at: "2026-09-07T06:00:00Z",
      ended_at: null,
      attendance_seconds: 100,
      active_seconds: 101,
    }).success,
    false,
  );
});
test("rejects invalid employee hours and impossible dates", () => {
  const e = {
    name: "موظف جديد",
    profession: "مصمم",
    daily_hours: 25,
    joined_on: "2026-09-07",
  };
  assert.equal(employeeSchema.safeParse(e).success, false);
  assert.equal(
    employeeSchema.safeParse({ ...e, daily_hours: 8, joined_on: "2026-02-31" })
      .success,
    false,
  );
});
test("rejects an empty workweek", () => {
  assert.equal(
    settingsSchema.safeParse({
      organization_name: "المصطفى",
      work_days: [],
      telegram_enabled: false,
    }).success,
    false,
  );
});
test("task payload does not accept impersonation or a forged completed status", () => {
  const t = taskSchema.parse({
    title: "مهمة جديدة",
    employee_id: crypto.randomUUID(),
    assigned_by: "someone-else",
    status: "done",
  });
  assert.equal("assigned_by" in t, false);
  assert.equal("status" in t, false);
});
