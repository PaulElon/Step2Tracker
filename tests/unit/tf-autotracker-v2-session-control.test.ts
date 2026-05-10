import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2UserModeStatusCopy,
  buildAutoTrackerV2StopSaveCopy,
  buildAutoTrackerV2UserModeSetupCopy,
  formatAutoTrackerV2ApproxDuration,
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

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: true,
      lastDetectedAppName: "ChatGPT",
      runningElapsedLabel: "06:42",
    }),
    {
      statusLine: "Auto-Tracking is running · 06:42",
      lastDetectedLine: "Last detected: ChatGPT",
    },
  );
});

test("buildAutoTrackerV2StopSaveCopy highlights when the current run will save multiple entries", () => {
  assert.deepEqual(
    buildAutoTrackerV2StopSaveCopy({
      isRunning: true,
      saveableCount: 5,
      hasDetectedActivity: true,
      hasUnclassifiedActivity: true,
      alreadyWritten: false,
    }),
    {
      actionLabel: "Stop & Save 5 entries",
      summaryLine: "Stop & Save will add 5 Session Log entries.",
      detailLine:
        "Every classified span in this run will save together. Unclassified activity stays out of the Session Log.",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2StopSaveCopy({
      isRunning: true,
      saveableCount: 0,
      hasDetectedActivity: true,
      hasUnclassifiedActivity: true,
      alreadyWritten: false,
    }),
    {
      actionLabel: "Stop Auto-Tracking",
      summaryLine: "Nothing will save yet.",
      detailLine:
        "This run only has unclassified activity so far. Add Allowed or Distraction rules if you want it counted.",
    },
  );
});

test("buildAutoTrackerV2UserModeSetupCopy reflects readiness vs missing setup", () => {
  assert.deepEqual(
    buildAutoTrackerV2UserModeSetupCopy({
      nativeStatus: {
        platform: "macos",
        supported: true,
        foregroundProbeAvailable: true,
        idleProbeAvailable: true,
        bufferLen: 0,
        bufferCapacity: 500,
        lastSampledAtMs: null,
        note: "ready",
      },
      trackedRuleCount: 4,
      distractionRuleCount: 1,
      samplerHasError: false,
    }),
    {
      tone: "ready",
      label: "Ready",
      detail: "Allowed rules: 4. Distraction rules: 1.",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeSetupCopy({
      nativeStatus: {
        platform: "macos",
        supported: true,
        foregroundProbeAvailable: false,
        idleProbeAvailable: true,
        bufferLen: 0,
        bufferCapacity: 500,
        lastSampledAtMs: null,
        note: "permissions missing",
      },
      trackedRuleCount: 0,
      distractionRuleCount: 0,
      samplerHasError: false,
    }),
    {
      tone: "attention",
      label: "Setup needed",
      detail: "Grant the required macOS permissions so foreground and idle detection can run.",
    },
  );
});

test("formatAutoTrackerV2ApproxDuration keeps timeline labels compact", () => {
  assert.equal(formatAutoTrackerV2ApproxDuration(11_000), "~11s");
  assert.equal(formatAutoTrackerV2ApproxDuration(70_000), "~1m 10s");
  assert.equal(formatAutoTrackerV2ApproxDuration(3_720_000), "~1h 2m");
});
