import assert from "node:assert/strict";
import test from "node:test";
import { attendanceNotificationForTransition } from "../src/lib/attendance-notifications";

const now = new Date("2026-09-14T08:00:00.000Z");

test("notifies for a current attendance start from an older desktop client", () => {
  assert.equal(
    attendanceNotificationForTransition({
      existedBefore: false,
      previousEndedAt: null,
      startedAt: "2026-09-14T07:59:30.000Z",
      endedAt: null,
      now,
    }),
    "start",
  );
});

test("does not notify when an old session is recovered after startup", () => {
  assert.equal(
    attendanceNotificationForTransition({
      existedBefore: true,
      previousEndedAt: null,
      startedAt: "2026-09-14T04:00:00.000Z",
      endedAt: "2026-09-14T05:40:00.000Z",
      now,
    }),
    null,
  );
});

test("explicitly silent attendance sync never sends a notification", () => {
  assert.equal(
    attendanceNotificationForTransition({
      existedBefore: true,
      previousEndedAt: null,
      startedAt: "2026-09-14T07:00:00.000Z",
      endedAt: "2026-09-14T07:59:45.000Z",
      requestedEvent: "none",
      now,
    }),
    null,
  );
});

test("notifies once for a matching current end transition", () => {
  assert.equal(
    attendanceNotificationForTransition({
      existedBefore: true,
      previousEndedAt: null,
      startedAt: "2026-09-14T07:00:00.000Z",
      endedAt: "2026-09-14T07:59:45.000Z",
      requestedEvent: "end",
      now,
    }),
    "end",
  );
  assert.equal(
    attendanceNotificationForTransition({
      existedBefore: true,
      previousEndedAt: "2026-09-14T07:59:45.000Z",
      startedAt: "2026-09-14T07:00:00.000Z",
      endedAt: "2026-09-14T07:59:45.000Z",
      requestedEvent: "end",
      now,
    }),
    null,
  );
});
