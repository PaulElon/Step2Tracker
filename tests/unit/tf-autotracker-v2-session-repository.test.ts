import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAutoTrackerV2SessionEvent,
  applyAutoTrackerV2SessionEvents,
} from "../../src/lib/tf-autotracker-v2-session-adapter.js";
import {
  createAutoTrackerV2InitialState,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2SessionMachineState,
  type AutoTrackerV2Target,
} from "../../src/lib/tf-autotracker-v2-session-machine.js";
import {
  createAutoTrackerV2SessionRepository,
  type AutoTrackerV2SessionRepositorySnapshot,
} from "../../src/lib/tf-autotracker-v2-session-repository.js";

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

function createFocusedState(nowMs = 0): AutoTrackerV2SessionMachineState {
  return applyAutoTrackerV2SessionEvent({
    state: createAutoTrackerV2InitialState(),
    event: { type: "targetFocused", nowMs, target: anki },
  }).state;
}

function createAwayPendingState(leftAtMs = 5_000): AutoTrackerV2SessionMachineState {
  return applyAutoTrackerV2SessionEvents({
    state: createFocusedState(0),
    events: [{ type: "untrackedFocused", nowMs: leftAtMs }],
  }).state;
}

function createRecoverableOpenState(
  leftAtMs = 5_000,
): AutoTrackerV2SessionMachineState {
  return applyAutoTrackerV2SessionEvents({
    state: createFocusedState(0),
    events: [
      { type: "untrackedFocused", nowMs: leftAtMs },
      { type: "appShutdown", nowMs: leftAtMs + 15_000 },
    ],
  }).state;
}

function createFinalizedSession(
  sessionId: string,
  target: AutoTrackerV2Target,
  startedAtMs: number,
  endedAtMs: number,
  finalizedBy: AutoTrackerV2FinalizedSession["finalizedBy"],
): AutoTrackerV2FinalizedSession {
  return {
    sessionId,
    target,
    startedAtMs,
    endedAtMs,
    pauseIntervals: [],
    finalizedAtMs: endedAtMs,
    finalizedBy,
  };
}

test("focused snapshot round-trips without changing reducer state shape", () => {
  const repository = createAutoTrackerV2SessionRepository({
    schemaVersion: 1,
    currentState: createFocusedState(),
    finalizedSessions: [],
  });

  const snapshot = repository.getSnapshot();
  const focusedState = snapshot.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(focusedState.status, "focused");
  assert.equal(focusedState.session.target.stableId, anki.stableId);
  assert.equal("previousTarget" in focusedState, false);
});

test("awayPending snapshot round-trips without changing reducer state shape", () => {
  const repository = createAutoTrackerV2SessionRepository();
  repository.saveCurrentState(createAwayPendingState());

  const snapshot = repository.getSnapshot();
  const awayPendingState = snapshot.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "awayPending" }
  >;

  assert.equal(awayPendingState.status, "awayPending");
  assert.equal(awayPendingState.previousTarget.stableId, anki.stableId);
  assert.equal(awayPendingState.leftAtMs, 5_000);
  assert.equal("recoveryReason" in awayPendingState, false);
});

test("recoverableOpen snapshot round-trips without changing reducer state shape", () => {
  const repository = createAutoTrackerV2SessionRepository({
    schemaVersion: 1,
    currentState: createRecoverableOpenState(),
    finalizedSessions: [],
  });

  const snapshot = repository.getSnapshot();
  const recoverableOpenState = snapshot.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "recoverableOpen" }
  >;

  assert.equal(recoverableOpenState.status, "recoverableOpen");
  assert.equal(recoverableOpenState.recoveryReason, "appShutdown");
  assert.equal(recoverableOpenState.openStateBeforeShutdown.status, "awayPending");
  assert.equal("previousTarget" in recoverableOpenState, false);
});

test("pauseIntervals inside an open session round-trip unchanged", () => {
  const repository = createAutoTrackerV2SessionRepository();
  const state = applyAutoTrackerV2SessionEvents({
    state: createAutoTrackerV2InitialState(),
    events: [
      { type: "targetFocused", nowMs: 0, target: anki },
      { type: "untrackedFocused", nowMs: 5_000 },
      { type: "targetFocused", nowMs: 35_000, target: anki },
    ],
  }).state;

  assert.equal(state.status, "focused");
  const focusedState = state as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;

  assert.deepEqual(focusedState.session.pauseIntervals, [
    { startedAtMs: 5_000, resumedAtMs: 35_000 },
  ]);

  repository.saveCurrentState(state);
  const snapshot = repository.getSnapshot();
  const storedFocusedState = snapshot.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;

  assert.deepEqual(storedFocusedState.session.pauseIntervals, [
    { startedAtMs: 5_000, resumedAtMs: 35_000 },
  ]);
});

test("finalizedSessions append and restore in adapter emission order", () => {
  const repository = createAutoTrackerV2SessionRepository();
  const result = applyAutoTrackerV2SessionEvents({
    state: createAutoTrackerV2InitialState(),
    events: [
      { type: "targetFocused", nowMs: 0, target: anki },
      { type: "untrackedFocused", nowMs: 5_000 },
      { type: "tick", nowMs: 65_000 },
      { type: "targetFocused", nowMs: 70_000, target: browser },
      { type: "manualStop", nowMs: 80_000 },
    ],
  });

  repository.appendFinalizedSessions([result.finalizedSessions[0]]);
  repository.appendFinalizedSessions([result.finalizedSessions[1]]);

  const snapshot = repository.getSnapshot();

  assert.equal(snapshot.finalizedSessions.length, 2);
  assert.equal(snapshot.finalizedSessions[0].target.stableId, anki.stableId);
  assert.equal(snapshot.finalizedSessions[1].target.stableId, browser.stableId);
  assert.equal(snapshot.finalizedSessions[0].finalizedBy, "awayGraceElapsed");
  assert.equal(snapshot.finalizedSessions[1].finalizedBy, "manualStop");
});

test("schemaVersion is preserved and explicitly checked", () => {
  const repository = createAutoTrackerV2SessionRepository({
    schemaVersion: 1,
    currentState: createFocusedState(),
    finalizedSessions: [],
  });

  assert.equal(repository.getSnapshot().schemaVersion, 1);
  assert.throws(
    () =>
      repository.loadSnapshot({
        schemaVersion: 2,
        currentState: createFocusedState(),
        finalizedSessions: [],
      }),
    /schemaVersion must be 1/,
  );
});

test("unknown fields are ignored safely when loading a snapshot", () => {
  const repository = createAutoTrackerV2SessionRepository();
  const loaded = repository.loadSnapshot({
    schemaVersion: 1,
    currentState: createFocusedState(123),
    finalizedSessions: [],
    extraTopLevelField: "ignore me",
  } as AutoTrackerV2SessionRepositorySnapshot & {
    extraTopLevelField: string;
  });

  assert.equal(loaded.schemaVersion, 1);
  assert.equal("extraTopLevelField" in loaded, false);
  assert.equal(loaded.currentState.lastEventMs, 123);
});

test("repository does not synthesize finalization from missingHeartbeat or any event", () => {
  const repository = createAutoTrackerV2SessionRepository({
    schemaVersion: 1,
    currentState: createFocusedState(),
    finalizedSessions: [],
  });

  const before = repository.getSnapshot();
  repository.saveCurrentState({
    ...before.currentState,
    lastEventMs: 120_000,
  });

  const after = repository.getSnapshot();
  const beforeFocusedState = before.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;
  const afterFocusedState = after.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;

  assert.equal(afterFocusedState.status, "focused");
  assert.equal(after.finalizedSessions.length, 0);
  assert.equal(before.finalizedSessions.length, 0);
  assert.equal(afterFocusedState.session.sessionId, beforeFocusedState.session.sessionId);
});

test("repository returns defensive copies of snapshots and nested arrays", () => {
  const repository = createAutoTrackerV2SessionRepository({
    schemaVersion: 1,
    currentState: createFocusedState(),
    finalizedSessions: [createFinalizedSession("session-1", anki, 0, 10_000, "manualStop")],
  });

  const snapshot = repository.getSnapshot();
  const focusedState = snapshot.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;
  snapshot.finalizedSessions.push(
    createFinalizedSession("session-2", browser, 10_000, 20_000, "manualStop"),
  );
  focusedState.session.pauseIntervals.push({
    startedAtMs: 1,
    resumedAtMs: 2,
  });

  const reread = repository.getSnapshot();
  const rereadFocusedState = reread.currentState as Extract<
    AutoTrackerV2SessionMachineState,
    { status: "focused" }
  >;

  assert.equal(reread.finalizedSessions.length, 1);
  assert.equal(rereadFocusedState.session.pauseIntervals.length, 0);
});
