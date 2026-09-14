import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceByDay,
  requiredHours,
  hours,
  isEmployeeOnline,
  todayInBaghdad,
  employeeMetrics,
} from "../src/lib/metrics";
import { createDemo } from "../src/lib/demo";
const employee = {
  id: "e",
  user_id: null,
  name: "موظف",
  phone: "",
  profession: "مصمم",
  telegram_id: "",
  daily_hours: 8,
  work_days: [0, 1, 2, 3, 4],
  joined_on: "2026-09-01",
  archived_at: null,
  created_at: "2026-09-01T00:00:00Z",
};
test("required hours cover every scheduled day in the selected month", () => {
  assert.equal(requiredHours(employee, "2026-09"), 176);
});
test("required hours start on employee join date", () => {
  assert.equal(
    requiredHours({ ...employee, joined_on: "2026-09-06" }, "2026-09"),
    152,
  );
});
test("future month uses the complete employee schedule", () => {
  assert.equal(requiredHours(employee, "2026-10"), 168);
});
test("required hours use each employee's own days and daily hours", () => {
  assert.equal(
    requiredHours(
      { ...employee, daily_hours: 6, work_days: [1, 3] },
      "2026-09",
    ),
    54,
  );
});
test("Baghdad dates use UTC+3 at the midnight boundary", () => {
  assert.equal(todayInBaghdad(new Date("2026-08-31T22:00:00Z")), "2026-09-01");
});
test("online status only follows a recent desktop heartbeat", () => {
  const now = Date.parse("2026-09-13T12:00:00Z");
  assert.equal(
    isEmployeeOnline({ last_seen_at: "2026-09-13T11:59:00Z" }, now),
    true,
  );
  assert.equal(
    isEmployeeOnline({ last_seen_at: "2026-09-13T11:55:00Z" }, now),
    false,
  );
  assert.equal(isEmployeeOnline({ last_seen_at: null }, now), false);
});
test("fresh attendance sync bridges desktop versions without stale online dots", () => {
  const now = Date.parse("2026-09-13T12:00:00Z");
  const entry = {
    id: "attendance-1",
    employee_id: "employee-1",
    work_date: "2026-09-13",
    attendance_seconds: 3600,
    active_seconds: 3000,
    started_at: "2026-09-13T10:59:00Z",
    ended_at: null,
    updated_at: "2026-09-13T11:59:00Z",
  };

  assert.equal(
    isEmployeeOnline(
      { id: "employee-1", last_seen_at: null },
      [entry],
      now,
    ),
    true,
  );
  assert.equal(
    isEmployeeOnline(
      { id: "employee-1", last_seen_at: null },
      [{ ...entry, updated_at: "2026-09-13T11:55:00Z" }],
      now,
    ),
    false,
  );
  assert.equal(
    isEmployeeOnline(
      { id: "employee-2", last_seen_at: null },
      [entry],
      now,
    ),
    false,
  );
});
test("attendance sessions are combined into one row per day", () => {
  const sessions = [
    {
      id: "late",
      employee_id: "e",
      work_date: "2026-09-13",
      attendance_seconds: 7200,
      active_seconds: 6000,
      started_at: "2026-09-13T10:00:00Z",
      ended_at: "2026-09-13T12:00:00Z",
      updated_at: "",
    },
    {
      id: "early",
      employee_id: "e",
      work_date: "2026-09-13",
      attendance_seconds: 3600,
      active_seconds: 3000,
      started_at: "2026-09-13T07:00:00Z",
      ended_at: "2026-09-13T08:00:00Z",
      updated_at: "",
    },
  ];
  const result = attendanceByDay(sessions);
  assert.equal(result.length, 1);
  assert.equal(result[0].attendance_seconds, 10800);
  assert.equal(result[0].active_seconds, 9000);
  assert.equal(result[0].started_at, "2026-09-13T07:00:00Z");
  assert.equal(result[0].ended_at, "2026-09-13T12:00:00Z");
  assert.deepEqual(result[0].sessions.map((entry) => entry.id), ["early", "late"]);
});
test("attendance and productive time stay separate, and task completion uses Baghdad month", () => {
  const d = createDemo();
  d.employees = [employee];
  d.attendance = [
    {
      id: "a",
      employee_id: "e",
      work_date: "2026-09-02",
      attendance_seconds: 28800,
      active_seconds: 21600,
      started_at: "2026-09-02T06:00:00Z",
      ended_at: "2026-09-02T14:00:00Z",
      updated_at: "",
    },
  ];
  d.tasks = [
    {
      ...d.tasks[0],
      employee_id: "e",
      status: "done",
      completed_at: "2026-08-31T22:00:00Z",
    },
  ];
  const result = employeeMetrics(d, employee, "2026-09");
  assert.equal(hours(result.attendance), 8);
  assert.equal(hours(result.active), 6);
  assert.equal(result.completed, 1);
});
