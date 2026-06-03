import assert from "node:assert/strict";
import test from "node:test";

import { buildPortfolioUrgeSummary } from "../../src/lib/portfolio-urge-awareness.ts";
import type { UrgeLog } from "../../src/types/models.ts";

function makeUrgeLog(overrides: Partial<UrgeLog> & Pick<UrgeLog, "id" | "timestamp" | "trigger" | "intensity">): UrgeLog {
  return {
    id: overrides.id,
    timestamp: overrides.timestamp,
    trigger: overrides.trigger,
    intensity: overrides.intensity,
    ...overrides,
  };
}

test("buildPortfolioUrgeSummary summarizes all-time urge data without mutating input order", () => {
  const urgeLogs = [
    makeUrgeLog({
      id: "older-phone",
      timestamp: "2026-05-10T13:00:00.000Z",
      sessionId: "session-1",
      trigger: "phone",
      intensity: 3,
      subject: "Anki",
    }),
    makeUrgeLog({
      id: "invalid-fatigue",
      timestamp: "not-a-real-date",
      sessionId: "session-2",
      trigger: "fatigue",
      intensity: 5,
      note: "Hit a wall",
    }),
    makeUrgeLog({
      id: "newer-phone",
      timestamp: "2026-05-12T09:30:00.000Z",
      sessionId: "session-1",
      trigger: "phone",
      intensity: 4,
    }),
  ];

  const originalIds = urgeLogs.map((log) => log.id);
  const summary = buildPortfolioUrgeSummary(urgeLogs);

  assert.equal(summary.totalCount, 3);
  assert.equal(summary.averageIntensity, 4);
  assert.equal(summary.topTrigger, "phone");
  assert.equal(summary.sessionCount, 2);
  assert.deepEqual(
    summary.breakdown.map((entry) => [entry.trigger, entry.count, entry.label]),
    [
      ["phone", 2, "Phone"],
      ["fatigue", 1, "Fatigue"],
    ],
  );
  assert.deepEqual(
    summary.examples.map((entry) => entry.id),
    ["newer-phone", "older-phone", "invalid-fatigue"],
  );
  assert.deepEqual(
    urgeLogs.map((log) => log.id),
    originalIds,
  );
});

test("buildPortfolioUrgeSummary applies an inclusive local date range and drops malformed timestamps from ranged results", () => {
  const urgeLogs: UrgeLog[] = [
    makeUrgeLog({
      id: "before-range",
      timestamp: "2026-05-10T23:00:00.000Z",
      sessionId: "session-1",
      trigger: "phone",
      intensity: 2,
    }),
    makeUrgeLog({
      id: "in-range",
      timestamp: "2026-05-12T14:15:00.000Z",
      sessionId: "session-2",
      trigger: "side_project",
      intensity: 5,
      note: "Wanted to switch tasks",
    }),
    makeUrgeLog({
      id: "bad-date",
      timestamp: "invalid-date",
      sessionId: "session-3",
      trigger: "other",
      intensity: 4,
    }),
    makeUrgeLog({
      id: "after-range",
      timestamp: "2026-05-13T08:00:00.000Z",
      sessionId: "session-4",
      trigger: "gaming",
      intensity: 3,
    }),
  ];

  const summary = buildPortfolioUrgeSummary(urgeLogs, {
    startDate: "2026-05-11",
    endDate: "2026-05-12",
  });

  assert.equal(summary.totalCount, 1);
  assert.equal(summary.averageIntensity, 5);
  assert.equal(summary.topTrigger, "side_project");
  assert.equal(summary.sessionCount, 1);
  assert.deepEqual(summary.examples.map((entry) => entry.id), ["in-range"]);
});
