import assert from "node:assert/strict";
import test from "node:test";

import { getTrackedStudyMinutesForDate } from "../../src/lib/tf-session-metrics.ts";
import type { TfSessionLog } from "../../src/types/models.ts";

function makeLog(overrides: Partial<TfSessionLog> & { date: string }): TfSessionLog {
  return {
    id: crypto.randomUUID(),
    method: "Manual",
    methodKey: "manual",
    hours: 1,
    startISO: `${overrides.date}T09:00:00.000Z`,
    endISO: `${overrides.date}T10:00:00.000Z`,
    notes: "",
    isDistraction: false,
    isLive: false,
    ...overrides,
  };
}

test("sums hours for matching date, converts to minutes", () => {
  const logs = [
    makeLog({ date: "2026-05-16", hours: 1.5 }),
    makeLog({ date: "2026-05-16", hours: 0.5 }),
  ];
  assert.equal(getTrackedStudyMinutesForDate(logs, "2026-05-16"), 120);
});

test("excludes distraction sessions", () => {
  const logs = [
    makeLog({ date: "2026-05-16", hours: 2 }),
    makeLog({ date: "2026-05-16", hours: 1, isDistraction: true }),
  ];
  assert.equal(getTrackedStudyMinutesForDate(logs, "2026-05-16"), 120);
});

test("filters to the requested date only", () => {
  const logs = [
    makeLog({ date: "2026-05-16", hours: 1 }),
    makeLog({ date: "2026-05-15", hours: 3 }),
    makeLog({ date: "2026-05-17", hours: 2 }),
  ];
  assert.equal(getTrackedStudyMinutesForDate(logs, "2026-05-16"), 60);
});

test("returns 0 for empty log list", () => {
  assert.equal(getTrackedStudyMinutesForDate([], "2026-05-16"), 0);
});
