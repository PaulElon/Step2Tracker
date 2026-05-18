import assert from "node:assert/strict";
import test from "node:test";

import { daysUntilDateKey, formatShortMinutes, formatTimerLabel } from "../../src/lib/datetime.ts";

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
