import assert from "node:assert/strict";
import test from "node:test";

import { daysUntilDateKey, formatShortMinutes } from "../../src/lib/datetime.ts";

test("formatShortMinutes avoids the ugly 0m label", () => {
  assert.equal(formatShortMinutes(0), "<1m");
  assert.equal(formatShortMinutes(0.4), "<1m");
  assert.equal(formatShortMinutes(1), "1m");
  assert.equal(formatShortMinutes(62), "1h 2m");
});

test("daysUntilDateKey counts local calendar days", () => {
  assert.equal(daysUntilDateKey("2026-05-16", "2026-05-16"), 0);
  assert.equal(daysUntilDateKey("2026-05-17", "2026-05-16"), 1);
  assert.equal(daysUntilDateKey("2026-05-15", "2026-05-16"), 0);
});
