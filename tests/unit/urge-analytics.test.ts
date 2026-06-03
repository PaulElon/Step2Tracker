import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIntensityDistribution,
  buildTimeBuckets,
  buildTriggerBreakdown,
  buildUrgeAnalytics,
  buildUrgeDaySummary,
  classifyTimeOfDay,
  filterUrgesByDate,
  getUrgeDateKey,
} from "../../src/lib/urge-analytics.ts";
import type { UrgeLog, UrgeTrigger } from "../../src/types/models.ts";

let nextId = 0;

/** Build an urge at a specific LOCAL wall-clock time so tests are timezone-stable. */
function localUrge(
  year: number,
  month: number,
  day: number,
  hour: number,
  trigger: UrgeTrigger,
  intensity: UrgeLog["intensity"],
  extras: Partial<UrgeLog> = {},
): UrgeLog {
  nextId += 1;
  return {
    id: `urge-${nextId}`,
    timestamp: new Date(year, month - 1, day, hour, 0, 0).toISOString(),
    trigger,
    intensity,
    ...extras,
  };
}

function localDateKey(year: number, month: number, day: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

test("buildUrgeDaySummary filters to a single local date and summarizes it", () => {
  const target = localDateKey(2026, 6, 3);
  const logs = [
    localUrge(2026, 6, 3, 9, "phone", 2),
    localUrge(2026, 6, 3, 14, "phone", 4, { note: "drifted" }),
    localUrge(2026, 6, 3, 20, "boredom", 5),
    localUrge(2026, 6, 2, 11, "gaming", 3), // different day, excluded
  ];

  const summary = buildUrgeDaySummary(logs, target);

  assert.equal(summary.totalCount, 3);
  assert.equal(summary.topTrigger, "phone");
  assert.equal(summary.highestIntensity, 5);
  assert.ok(Math.abs(summary.averageIntensity - 11 / 3) < 1e-9);
  // newest first
  assert.deepEqual(
    summary.entries.map((entry) => entry.intensity),
    [5, 4, 2],
  );
});

test("date-specific urge summary excludes other days", () => {
  const logs = [
    localUrge(2026, 6, 1, 10, "phone", 3),
    localUrge(2026, 6, 2, 10, "gaming", 4),
    localUrge(2026, 6, 3, 10, "boredom", 2),
  ];

  const day2 = buildUrgeDaySummary(logs, localDateKey(2026, 6, 2));
  assert.equal(day2.totalCount, 1);
  assert.equal(day2.entries[0]?.trigger, "gaming");
});

test("trigger breakdown counts and sorts descending by count", () => {
  const logs = [
    localUrge(2026, 6, 3, 9, "phone", 3),
    localUrge(2026, 6, 3, 10, "phone", 4),
    localUrge(2026, 6, 3, 11, "phone", 2),
    localUrge(2026, 6, 3, 12, "gaming", 5),
    localUrge(2026, 6, 3, 13, "gaming", 1),
    localUrge(2026, 6, 3, 14, "boredom", 3),
  ];
  const entries = filterUrgesByDate(logs, localDateKey(2026, 6, 3));
  const breakdown = buildTriggerBreakdown(entries);

  assert.deepEqual(
    breakdown.map((entry) => [entry.trigger, entry.count]),
    [
      ["phone", 3],
      ["gaming", 2],
      ["boredom", 1],
    ],
  );
  assert.equal(breakdown[0]?.label, "Phone");
  assert.ok(Math.abs((breakdown[0]?.sharePercent ?? 0) - 50) < 1e-9);
});

test("intensity distribution counts levels 1 through 5", () => {
  const logs = [
    localUrge(2026, 6, 3, 9, "phone", 1),
    localUrge(2026, 6, 3, 10, "phone", 3),
    localUrge(2026, 6, 3, 11, "phone", 3),
    localUrge(2026, 6, 3, 12, "gaming", 5),
    localUrge(2026, 6, 3, 13, "gaming", 5),
    localUrge(2026, 6, 3, 14, "boredom", 5),
  ];
  const entries = filterUrgesByDate(logs, localDateKey(2026, 6, 3));
  const distribution = buildIntensityDistribution(entries);

  assert.deepEqual(
    distribution.map((bucket) => [bucket.intensity, bucket.count]),
    [
      [1, 1],
      [2, 0],
      [3, 2],
      [4, 0],
      [5, 3],
    ],
  );
});

test("classifyTimeOfDay and buildTimeBuckets bucket morning/afternoon/evening/night", () => {
  assert.equal(classifyTimeOfDay(6), "morning");
  assert.equal(classifyTimeOfDay(11), "morning");
  assert.equal(classifyTimeOfDay(12), "afternoon");
  assert.equal(classifyTimeOfDay(16), "afternoon");
  assert.equal(classifyTimeOfDay(17), "evening");
  assert.equal(classifyTimeOfDay(21), "evening");
  assert.equal(classifyTimeOfDay(22), "night");
  assert.equal(classifyTimeOfDay(2), "night");

  const logs = [
    localUrge(2026, 6, 3, 7, "phone", 3), // morning
    localUrge(2026, 6, 3, 9, "phone", 3), // morning
    localUrge(2026, 6, 3, 13, "gaming", 4), // afternoon
    localUrge(2026, 6, 3, 19, "boredom", 5), // evening
    localUrge(2026, 6, 3, 23, "fatigue", 2), // night
  ];
  const entries = filterUrgesByDate(logs, localDateKey(2026, 6, 3));
  const buckets = buildTimeBuckets(entries);
  const byBucket = Object.fromEntries(buckets.map((bucket) => [bucket.bucket, bucket.count]));

  assert.equal(byBucket.morning, 2);
  assert.equal(byBucket.afternoon, 1);
  assert.equal(byBucket.evening, 1);
  assert.equal(byBucket.night, 1);
});

test("malformed timestamps do not crash and are excluded from date-filtered summaries", () => {
  const logs: UrgeLog[] = [
    localUrge(2026, 6, 3, 9, "phone", 3),
    { id: "bad-1", timestamp: "not-a-date", trigger: "other", intensity: 4 },
    { id: "bad-2", timestamp: "", trigger: "gaming", intensity: 5 },
  ];

  assert.equal(getUrgeDateKey("not-a-date"), null);
  assert.equal(getUrgeDateKey(""), null);

  const summary = buildUrgeDaySummary(logs, localDateKey(2026, 6, 3));
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.entries[0]?.trigger, "phone");
});

test("buildUrgeAnalytics over a fixed today window summarizes and excludes malformed entries", () => {
  const todayKey = localDateKey(2026, 6, 3);
  const logs: UrgeLog[] = [
    localUrge(2026, 6, 3, 9, "phone", 4),
    localUrge(2026, 6, 2, 13, "phone", 2),
    localUrge(2026, 6, 1, 19, "gaming", 5),
    { id: "bad", timestamp: "broken", trigger: "other", intensity: 3 },
  ];

  const analytics = buildUrgeAnalytics(logs, 14, todayKey);
  assert.equal(analytics.totalCount, 3);
  assert.equal(analytics.topTrigger, "phone");
  assert.equal(analytics.highestIntensity, 5);
  assert.equal(analytics.dailyTrend.length, 14);
  const todayPoint = analytics.dailyTrend[analytics.dailyTrend.length - 1];
  assert.equal(todayPoint?.dateKey, todayKey);
  assert.equal(todayPoint?.count, 1);
});
