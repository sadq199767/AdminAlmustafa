import test from "node:test";
import assert from "node:assert/strict";
import {
  requiredHours,
  hours,
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
  joined_on: "2026-09-01",
  archived_at: null,
  created_at: "2026-09-01T00:00:00Z",
};
test("required hours exclude weekends and future dates", () => {
  assert.equal(
    requiredHours(employee, "2026-09", [0, 1, 2, 3, 4], "2026-09-07"),
    40,
  );
});
test("required hours start on employee join date", () => {
  assert.equal(
    requiredHours(
      { ...employee, joined_on: "2026-09-06" },
      "2026-09",
      [0, 1, 2, 3, 4],
      "2026-09-07",
    ),
    16,
  );
});
test("future month has no required hours", () => {
  assert.equal(
    requiredHours(employee, "2026-10", [0, 1, 2, 3, 4], "2026-09-07"),
    0,
  );
});
test("Baghdad dates use UTC+3 at the midnight boundary", () => {
  assert.equal(todayInBaghdad(new Date("2026-08-31T22:00:00Z")), "2026-09-01");
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
