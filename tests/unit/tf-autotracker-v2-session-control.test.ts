import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2UserModeStatusCopy,
  buildAutoTrackerV2StopSaveCopy,
  buildAutoTrackerV2UserModeSetupCopy,
  formatAutoTrackerV2SavedRunSummary,
  formatAutoTrackerV2ApproxDuration,
} from "../../src/lib/tf-autotracker-v2-user-mode-copy.js";

test("buildAutoTrackerV2UserModeStatusCopy returns compact status labels", () => {
  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: false,
      savedEntryCount: 0,
      needsSetup: false,
    }),
    {
      pillLabel: "Off",
      metaLabel: null,
      statusLine: "Off",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: true,
      savedEntryCount: 0,
      needsSetup: false,
    }),
    {
      pillLabel: "Running",
      metaLabel: null,
      statusLine: "Running",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: true,
      runningElapsedLabel: "06:42",
      savedEntryCount: 0,
      needsSetup: false,
    }),
    {
      pillLabel: "Running",
      metaLabel: "06:42",
      statusLine: "Running · 06:42",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: false,
      savedEntryCount: 5,
      needsSetup: false,
    }),
    {
      pillLabel: "Saved",
      metaLabel: "5 entries",
      statusLine: "Saved 5 entries",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2UserModeStatusCopy({
      isRunning: false,
      savedEntryCount: 0,
      needsSetup: true,
    }),
    {
      pillLabel: "Needs setup",
      metaLabel: null,
      statusLine: "Needs setup",
    },
  );
});

test("buildAutoTrackerV2StopSaveCopy uses compact CTA wording", () => {
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
      supportingLine: null,
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
      supportingLine: "Nothing tracked yet",
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2StopSaveCopy({
      isRunning: false,
      saveableCount: 0,
      hasDetectedActivity: true,
      hasUnclassifiedActivity: false,
      alreadyWritten: true,
    }),
    {
      actionLabel: "Start New Run",
      supportingLine: null,
    },
  );

  assert.deepEqual(
    buildAutoTrackerV2StopSaveCopy({
      isRunning: false,
      saveableCount: 0,
      hasDetectedActivity: false,
      hasUnclassifiedActivity: false,
      alreadyWritten: false,
    }),
    {
      actionLabel: "Start Auto-Tracking",
      supportingLine: null,
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
      detail: null,
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
      label: "Needs setup",
      detail: "Turn on macOS Automation and System Events permissions in System Settings.",
    },
  );

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
        note: "rules missing",
      },
      trackedRuleCount: 0,
      distractionRuleCount: 0,
      samplerHasError: false,
    }),
    {
      tone: "attention",
      label: "Needs setup",
      detail: "Add at least one allowed app or site in Tracker Settings.",
    },
  );
});

test("formatAutoTrackerV2ApproxDuration keeps timeline labels compact", () => {
  assert.equal(formatAutoTrackerV2ApproxDuration(11_000), "11s");
  assert.equal(formatAutoTrackerV2ApproxDuration(70_000), "1m");
  assert.equal(formatAutoTrackerV2ApproxDuration(119_000), "2m");
  assert.equal(formatAutoTrackerV2ApproxDuration(3_720_000), "1h 2m");
});

test("formatAutoTrackerV2SavedRunSummary stays compact", () => {
  assert.equal(
    formatAutoTrackerV2SavedRunSummary([
      "Goodnotes",
      "Anki",
      "TrueLearn",
      "UWorld",
      "ChatGPT",
    ]),
    "Goodnotes, Anki, TrueLearn, UWorld, ChatGPT",
  );

  assert.equal(
    formatAutoTrackerV2SavedRunSummary([
      "Goodnotes",
      "Anki",
      "TrueLearn",
      "UWorld",
      "ChatGPT",
      "Pathoma",
      "Boards & Beyond",
    ]),
    "Goodnotes, Anki, TrueLearn, UWorld, ChatGPT, +2 more",
  );
});
