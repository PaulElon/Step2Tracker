import assert from "node:assert/strict";
import test from "node:test";

import { splitAutoSessionMethodLabel } from "../../src/lib/tf-session-adapters.ts";

test("splitAutoSessionMethodLabel removes the Auto suffix for display only", () => {
  assert.deepEqual(splitAutoSessionMethodLabel("UWorld [Auto]"), {
    label: "UWorld",
    isAuto: true,
  });

  assert.deepEqual(splitAutoSessionMethodLabel("Manual Review"), {
    label: "Manual Review",
    isAuto: false,
  });

  assert.deepEqual(splitAutoSessionMethodLabel(""), {
    label: "Other",
    isAuto: false,
  });
});
