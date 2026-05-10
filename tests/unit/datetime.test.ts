import assert from "node:assert/strict";
import test from "node:test";

import { formatShortMinutes } from "../../src/lib/datetime.ts";

test("formatShortMinutes avoids the ugly 0m label", () => {
  assert.equal(formatShortMinutes(0), "<1m");
  assert.equal(formatShortMinutes(0.4), "<1m");
  assert.equal(formatShortMinutes(1), "1m");
  assert.equal(formatShortMinutes(62), "1h 2m");
});
