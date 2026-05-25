import assert from "node:assert/strict";
import test from "node:test";

import {
  combineLocalDateAndTimeToIso,
  daysUntilDateKey,
  formatShortMinutes,
  formatTimerLabel,
  getLocalDateKeyFromIso,
} from "../../src/lib/datetime.ts";

test("formatShortMinutes avoids the ugly 0m label", () => {
  assert.equal(formatShortMinutes(0), "<1m");
  assert.equal(formatShortMinutes(0.4), "<1m");
  assert.equal(formatShortMinutes(1), "1m");
  assert.equal(formatShortMinutes(62), "1h 2m");
});

test("formatTimerLabel uses one consistent timer format", () => {
  assert.equal(formatTimerLabel(0), "00:00");
  assert.equal(formatTimerLabel(65_000), "01:05");
  assert.equal(formatTimerLabel(3_723_000), "1:02:03");
});

test("daysUntilDateKey counts local calendar days", () => {
  assert.equal(daysUntilDateKey("2026-05-16", "2026-05-16"), 0);
  assert.equal(daysUntilDateKey("2026-05-17", "2026-05-16"), 1);
  assert.equal(daysUntilDateKey("2026-05-15", "2026-05-16"), 0);
});

test("combineLocalDateAndTimeToIso builds a valid local timestamp", () => {
  const iso = combineLocalDateAndTimeToIso("2026-05-21", "13:15");
  assert.ok(iso);
  assert.equal(getLocalDateKeyFromIso(iso ?? ""), "2026-05-21");
});

test("combineLocalDateAndTimeToIso rejects invalid clock values", () => {
  assert.equal(combineLocalDateAndTimeToIso("2026-05-21", "24:00"), null);
  assert.equal(combineLocalDateAndTimeToIso("2026-05-21", "9:15"), null);
});

test("sub-minute Auto-Tracker sessions display as <1m using timestamp-based floor division", () => {
  // session-log-panel uses Math.floor(preciseMs / 60_000) when timestamps show < 60s
  assert.equal(formatShortMinutes(Math.floor(1_000 / 60_000)), "<1m");    // 1 second
  assert.equal(formatShortMinutes(Math.floor(30_000 / 60_000)), "<1m");   // 30 seconds
  assert.equal(formatShortMinutes(Math.floor(59_999 / 60_000)), "<1m");   // 59.999 seconds
  assert.equal(formatShortMinutes(Math.floor(60_000 / 60_000)), "1m");    // exactly 60 seconds
  assert.equal(formatShortMinutes(Math.floor(70_000 / 60_000)), "1m");    // 70 seconds
  assert.equal(formatShortMinutes(Math.floor(300_000 / 60_000)), "5m");   // 5 minutes
});
