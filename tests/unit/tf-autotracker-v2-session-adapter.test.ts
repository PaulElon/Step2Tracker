import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutoTrackerV2SessionEvent,
  applyAutoTrackerV2SessionEvents,
} from "../../src/lib/tf-autotracker-v2-session-adapter.js";
import {
  AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
  createAutoTrackerV2InitialState,
  type AutoTrackerV2SessionMachineState,
  type AutoTrackerV2Target,
} from "../../src/lib/tf-autotracker-v2-session-machine.js";

const anki: AutoTrackerV2Target = {
  kind: "app",
  stableId: "com.ankiapp.client",
  label: "Anki",
};

const browser: AutoTrackerV2Target = {
  kind: "app",
  stableId: "com.apple.Safari",
  label: "Safari",
};

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function applyOne(
  state: AutoTrackerV2SessionMachineState,
  event: Parameters<typeof applyAutoTrackerV2SessionEvent>[0]["event"],
) {
  return applyAutoTrackerV2SessionEvent({ state, event });
}

test("focused events create and continue an open session without mutating the input state", () => {
  const initialState = createAutoTrackerV2InitialState();
  const initialSnapshot = snapshot(initialState);

  const firstResult = applyOne(initialState, {
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });

  assert.equal(firstResult.state.status, "focused");
  assert.equal(firstResult.finalizedSessions.length, 0);
  assert.deepEqual(initialState, initialSnapshot);

  const focusedState = firstResult.state;
  const focusedSnapshot = snapshot(focusedState);
  const secondResult = applyOne(focusedState, {
    type: "targetFocused",
    nowMs: 5_000,
    target: anki,
  });

  assert.equal(secondResult.state.status, "focused");
  assert.equal(secondResult.state.session.startedAtMs, 0);
  assert.equal(secondResult.finalizedSessions.length, 0);
  assert.deepEqual(focusedState, focusedSnapshot);
});

test("untracked then tick past away grace finalizes exactly one session", () => {
  let state: AutoTrackerV2SessionMachineState = createAutoTrackerV2InitialState();
  let result = applyOne(state, {
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });
  state = result.state;

  result = applyOne(state, {
    type: "untrackedFocused",
    nowMs: 5_000,
  });
  state = result.state;

  result = applyOne(state, {
    type: "tick",
    nowMs: 5_000 + AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
  });

  assert.equal(result.state.status, "idle");
  assert.equal(result.finalizedSessions.length, 1);
  assert.equal(result.finalizedSessions[0].target.stableId, anki.stableId);
  assert.equal(result.finalizedSessions[0].endedAtMs, 5_000);
});

test("missing heartbeat alone does not finalize a session", () => {
  const firstResult = applyOne(createAutoTrackerV2InitialState(), {
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });

  const result = applyOne(firstResult.state, {
    type: "missingHeartbeat",
    nowMs: 120_000,
  });

  assert.equal(result.state.status, "focused");
  assert.equal(result.finalizedSessions.length, 0);
});

test("app shutdown returns recoverable open state and no finalized sessions", () => {
  const firstResult = applyOne(createAutoTrackerV2InitialState(), {
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });

  const result = applyOne(firstResult.state, {
    type: "appShutdown",
    nowMs: 12_000,
  });

  assert.equal(result.state.status, "recoverableOpen");
  assert.equal(result.state.recoveryReason, "appShutdown");
  assert.equal(result.state.session.target.stableId, anki.stableId);
  assert.equal(result.finalizedSessions.length, 0);
});

test("batch application preserves event order and accumulates finalized sessions", () => {
  const result = applyAutoTrackerV2SessionEvents({
    state: createAutoTrackerV2InitialState(),
    events: [
      { type: "targetFocused", nowMs: 0, target: anki },
      { type: "untrackedFocused", nowMs: 5_000 },
      { type: "tick", nowMs: 5_000 + AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS },
      { type: "targetFocused", nowMs: 70_000, target: browser },
      { type: "manualStop", nowMs: 80_000 },
    ],
  });

  assert.equal(result.state.status, "idle");
  assert.equal(result.finalizedSessions.length, 2);
  assert.equal(result.finalizedSessions[0].target.stableId, anki.stableId);
  assert.equal(result.finalizedSessions[0].endedAtMs, 5_000);
  assert.equal(result.finalizedSessions[1].target.stableId, browser.stableId);
  assert.equal(result.finalizedSessions[1].finalizedBy, "manualStop");
});
