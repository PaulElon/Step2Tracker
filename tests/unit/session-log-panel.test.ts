import assert from "node:assert/strict";
import test from "node:test";

import { resolvePersistedTimerMode } from "../../src/features/timefolio/session-log-panel.tsx";

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
