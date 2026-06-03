import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerUrgeContext,
  getManualTimerMethodStartError,
  resolveAttentionTimerMode,
  resolvePersistedTimerMode,
} from "../../src/features/timefolio/session-log-panel.tsx";

test("falls back to manual mode when auto-tracker mode is unavailable", () => {
  assert.equal(resolvePersistedTimerMode("auto", false), "manual");
  assert.equal(resolvePersistedTimerMode("manual", false), "manual");
  assert.equal(resolvePersistedTimerMode(null, false), "manual");
});

test("keeps persisted auto mode only when auto-tracker mode is available", () => {
  assert.equal(resolvePersistedTimerMode("auto", true), "auto");
  assert.equal(resolvePersistedTimerMode("manual", true), "manual");
  assert.equal(resolvePersistedTimerMode(null, true), "manual");
});

test("manual timer attention keeps manual controls visible over pending auto work", () => {
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "auto",
      autoTrackerAvailable: true,
      manualNeedsAttention: true,
      autoIsBlocking: false,
      autoHasSaveableEntries: true,
    }),
    "manual",
  );
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "manual",
      autoTrackerAvailable: true,
      manualNeedsAttention: true,
      autoIsBlocking: true,
      autoHasSaveableEntries: true,
    }),
    "manual",
  );
});

test("pending auto save entries do not force an idle manual timer into auto mode", () => {
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "manual",
      autoTrackerAvailable: true,
      manualNeedsAttention: false,
      autoIsBlocking: false,
      autoHasSaveableEntries: true,
    }),
    "manual",
  );
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "auto",
      autoTrackerAvailable: true,
      manualNeedsAttention: false,
      autoIsBlocking: false,
      autoHasSaveableEntries: true,
    }),
    "auto",
  );
});

test("active auto-tracker work can bring the idle timer card back to auto mode", () => {
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "manual",
      autoTrackerAvailable: true,
      manualNeedsAttention: false,
      autoIsBlocking: true,
      autoHasSaveableEntries: false,
    }),
    "auto",
  );
  assert.equal(
    resolveAttentionTimerMode({
      currentMode: "auto",
      autoTrackerAvailable: false,
      manualNeedsAttention: false,
      autoIsBlocking: true,
      autoHasSaveableEntries: true,
    }),
    "manual",
  );
});

test("auto-tracker urge context uses real active span context without inventing a session id", () => {
  const context = buildAutoTrackerUrgeContext({
    currentPreviewSpan: {
      id: "span-1",
      label: "apps.uworld.com",
      kind: "website",
      browserUrl: "https://apps.uworld.com/courseapp",
      startedAtMs: 10_000,
      endedAtMs: null,
      durationMs: null,
      sourceEventIds: ["event-1"],
      classification: "tracked",
      classificationReason: "Matched website rule.",
      matchedRuleName: "UWorld",
      matchedRuleTarget: "apps.uworld.com",
    },
    lastDetectedAppName: "Safari",
    previewNowMs: 73_000,
  });

  assert.deepEqual(context, {
    subject: "UWorld",
    elapsedSeconds: 63,
  });
  assert.equal("sessionId" in context, false);
});

test("manual timer start requires a nonblank method title", () => {
  assert.equal(getManualTimerMethodStartError(""), "Method title required to start timer.");
  assert.equal(getManualTimerMethodStartError("   "), "Method title required to start timer.");
  assert.equal(getManualTimerMethodStartError("Active Recall"), null);
});
