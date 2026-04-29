import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
  createAutoTrackerV2InitialState,
  reduceAutoTrackerV2Session,
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

function reduceAll(
  events: Parameters<typeof reduceAutoTrackerV2Session>[1][],
  initialState: AutoTrackerV2SessionMachineState = createAutoTrackerV2InitialState(),
) {
  let state = initialState;
  const finalized = [];

  for (const event of events) {
    const result = reduceAutoTrackerV2Session(state, event);
    state = result.state;
    finalized.push(...result.finalizedSessions);
  }

  return { state, finalized };
}

test("continuous tracked target for more than 10 minutes never finalizes", () => {
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "tick", nowMs: 10 * 60_000 },
    { type: "tick", nowMs: 10 * 60_000 + 1 },
    { type: "targetFocused", nowMs: 25 * 60_000, target: anki },
  ]);

  assert.equal(state.status, "focused");
  assert.equal(finalized.length, 0);
});

test("returns within away grace as one session with a pause interval, then finalizes after leaving for grace", () => {
  const firstFocusedMs = 10 * 60_000 + 15_000;
  const firstReturnMs = firstFocusedMs + 59_000;
  const secondLeaveMs = firstReturnMs + 10 * 60_000;
  const finalTickMs = secondLeaveMs + AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS;

  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "untrackedFocused", nowMs: firstFocusedMs },
    { type: "targetFocused", nowMs: firstReturnMs, target: anki },
    { type: "untrackedFocused", nowMs: secondLeaveMs },
    { type: "tick", nowMs: finalTickMs },
  ]);

  assert.equal(state.status, "idle");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].target.stableId, anki.stableId);
  assert.equal(finalized[0].startedAtMs, 0);
  assert.equal(finalized[0].endedAtMs, secondLeaveMs);
  assert.deepEqual(finalized[0].pauseIntervals, [
    { startedAtMs: firstFocusedMs, resumedAtMs: firstReturnMs },
  ]);
});

test("away for at least 60 seconds finalizes the previous session", () => {
  const leftAtMs = 5_000;
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "untrackedFocused", nowMs: leftAtMs },
    { type: "tick", nowMs: leftAtMs + AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS },
  ]);

  assert.equal(state.status, "idle");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].endedAtMs, leftAtMs);
});

test("different tracked target before away grace does not finalize previous session", () => {
  const leftAtMs = 5_000;
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "untrackedFocused", nowMs: leftAtMs },
    { type: "targetFocused", nowMs: leftAtMs + 30_000, target: browser },
  ]);

  assert.equal(state.status, "awayPending");
  assert.equal(finalized.length, 0);
});

test("different tracked target after away grace finalizes previous session and starts the new target", () => {
  const leftAtMs = 5_000;
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "untrackedFocused", nowMs: leftAtMs },
    {
      type: "targetFocused",
      nowMs: leftAtMs + AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
      target: browser,
    },
  ]);

  assert.equal(state.status, "focused");
  assert.equal(state.target.stableId, browser.stableId);
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].target.stableId, anki.stableId);
  assert.equal(finalized[0].endedAtMs, leftAtMs);
});

test("app shutdown persists recoverable open state without finalizing", () => {
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "appShutdown", nowMs: 12_000 },
  ]);

  assert.equal(state.status, "recoverableOpen");
  assert.equal(state.recoveryReason, "appShutdown");
  assert.equal(state.session.target.stableId, anki.stableId);
  assert.equal(finalized.length, 0);
});

test("missing native heartbeat alone does not finalize", () => {
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "missingHeartbeat", nowMs: 120_000 },
  ]);

  assert.equal(state.status, "focused");
  assert.equal(finalized.length, 0);
});

test("manual stop finalizes an open focused session", () => {
  const { state, finalized } = reduceAll([
    { type: "targetFocused", nowMs: 0, target: anki },
    { type: "manualStop", nowMs: 45_000 },
  ]);

  assert.equal(state.status, "idle");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].endedAtMs, 45_000);
  assert.equal(finalized[0].finalizedBy, "manualStop");
});
