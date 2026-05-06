import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2UserModeStatusCopy,
} from "../../src/lib/tf-autotracker-v2-user-mode-copy.js";

test("buildAutoTrackerV2UserModeStatusCopy uses concise user-facing wording", () => {
  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: false,
      lastDetectedAppName: null,
    }),
    {
      statusLine: "Auto-Tracking is off.",
      lastDetectedLine: "Last detected: None yet",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: true,
      lastDetectedAppName: "UWorld",
    }),
    {
      statusLine: "Auto-Tracking is running.",
      lastDetectedLine: "Last detected: UWorld",
    },
  );
});
