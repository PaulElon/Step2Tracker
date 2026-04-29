import assert from "node:assert/strict";
import test from "node:test";

import {
  createAutoTrackerV2InitialState,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2SessionMachineEvent,
  type AutoTrackerV2Target,
} from "../../src/lib/tf-autotracker-v2-session-machine.js";
import {
  createAutoTrackerV2SessionConsumer,
  type AutoTrackerV2SessionConsumer,
} from "../../src/lib/tf-autotracker-v2-session-consumer.js";
import type { AutoTrackerV2SessionPersistencePort } from "../../src/lib/tf-autotracker-v2-session-persistence-port.js";
import type { AutoTrackerV2SessionRepositorySnapshot } from "../../src/lib/tf-autotracker-v2-session-repository.js";

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

function createSnapshot(
  overrides: Partial<AutoTrackerV2SessionRepositorySnapshot> = {},
): AutoTrackerV2SessionRepositorySnapshot {
  return {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
    ...overrides,
  };
}

function createSpyPort(
  initialSnapshot: AutoTrackerV2SessionRepositorySnapshot = createSnapshot(),
): AutoTrackerV2SessionPersistencePort & {
  calls: {
    readSnapshot: number;
    writeSnapshot: number;
    resetSnapshot: number;
  };
  snapshots: AutoTrackerV2SessionRepositorySnapshot[];
} {
  const calls = {
    readSnapshot: 0,
    writeSnapshot: 0,
    resetSnapshot: 0,
  };
  let snapshot = structuredClone(initialSnapshot);
  const snapshots: AutoTrackerV2SessionRepositorySnapshot[] = [];

  return {
    calls,
    snapshots,
    async readSnapshot() {
      calls.readSnapshot += 1;
      return structuredClone(snapshot);
    },
    async writeSnapshot(nextSnapshot) {
      calls.writeSnapshot += 1;
      snapshot = structuredClone(nextSnapshot);
      snapshots.push(structuredClone(nextSnapshot));
      return structuredClone(snapshot);
    },
    async resetSnapshot() {
      calls.resetSnapshot += 1;
      snapshot = createSnapshot();
      snapshots.push(structuredClone(snapshot));
      return structuredClone(snapshot);
    },
  };
}

function createConsumer(
  initialSnapshot?: AutoTrackerV2SessionRepositorySnapshot,
): {
  consumer: AutoTrackerV2SessionConsumer;
  port: ReturnType<typeof createSpyPort>;
} {
  const port = createSpyPort(initialSnapshot);
  return {
    consumer: createAutoTrackerV2SessionConsumer(port),
    port,
  };
}

test("consumer readSnapshot returns the initial fake-port snapshot", async () => {
  const initialSnapshot = createSnapshot({
    currentState: {
      status: "focused",
      lastEventMs: 123,
      target: anki,
      session: {
        sessionId: "app:com.ankiapp.client:0",
        target: anki,
        startedAtMs: 0,
        pauseIntervals: [],
      },
    },
    finalizedSessions: [createFinalizedSession("session-1", browser, 10_000, 20_000, "manualStop")],
  });
  const { consumer, port } = createConsumer(initialSnapshot);

  const snapshot = await consumer.readSnapshot();

  assert.equal(port.calls.readSnapshot, 1);
  assert.deepEqual(snapshot, initialSnapshot);
});

test("consumer applyEvent for targetFocused persists focused state through the port", async () => {
  const { consumer, port } = createConsumer();

  const snapshot = await consumer.applyEvent({
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });

  assert.equal(port.calls.readSnapshot, 1);
  assert.equal(port.calls.writeSnapshot, 1);
  assert.equal(port.calls.resetSnapshot, 0);
  assert.equal(snapshot.currentState.status, "focused");
  assert.equal(snapshot.currentState.lastEventMs, 0);
  assert.equal(snapshot.currentState.session.target.stableId, anki.stableId);
  assert.deepEqual(snapshot.finalizedSessions, []);
});

test("consumer forwards custom awayGraceMs through applyEvent and preserves finalized ledger order", async () => {
  const initialSnapshot = createSnapshot({
    finalizedSessions: [createFinalizedSession("session-0", browser, 1_000, 2_000, "manualStop")],
  });
  const { consumer, port } = createConsumer(initialSnapshot);
  const customAwayGraceMs = 5_000;

  await consumer.applyEvent({
    type: "targetFocused",
    nowMs: 0,
    target: anki,
  });
  await consumer.applyEvent(
    {
      type: "untrackedFocused",
      nowMs: 5_000,
    },
    { awayGraceMs: customAwayGraceMs },
  );
  const snapshot = await consumer.applyEvent(
    {
      type: "tick",
      nowMs: 5_000 + customAwayGraceMs,
    },
    { awayGraceMs: customAwayGraceMs },
  );

  assert.equal(port.calls.readSnapshot, 3);
  assert.equal(port.calls.writeSnapshot, 3);
  assert.equal(snapshot.currentState.status, "idle");
  assert.equal(snapshot.finalizedSessions.length, 2);
  assert.deepEqual(
    snapshot.finalizedSessions.map((session) => session.sessionId),
    ["session-0", "app:com.ankiapp.client:0"],
  );
  assert.equal(snapshot.finalizedSessions[1].endedAtMs, 5_000);
  assert.equal(snapshot.finalizedSessions[1].finalizedBy, "awayGraceElapsed");
});

test("consumer missingHeartbeat writes no finalized session and preserves open state", async () => {
  const initialSnapshot = createSnapshot({
    currentState: {
      status: "focused",
      lastEventMs: 0,
      target: anki,
      session: {
        sessionId: "app:com.ankiapp.client:0",
        target: anki,
        startedAtMs: 0,
        pauseIntervals: [],
      },
    },
  });
  const { consumer, port } = createConsumer(initialSnapshot);

  const snapshot = await consumer.applyEvent({
    type: "missingHeartbeat",
    nowMs: 120_000,
  });

  assert.equal(port.calls.readSnapshot, 1);
  assert.equal(port.calls.writeSnapshot, 1);
  assert.equal(snapshot.currentState.status, "focused");
  assert.equal(snapshot.currentState.lastEventMs, 120_000);
  assert.equal(snapshot.finalizedSessions.length, 0);
});

test("consumer appShutdown persists recoverable open state and no finalized session", async () => {
  const initialSnapshot = createSnapshot({
    currentState: {
      status: "focused",
      lastEventMs: 10_000,
      target: anki,
      session: {
        sessionId: "app:com.ankiapp.client:0",
        target: anki,
        startedAtMs: 0,
        pauseIntervals: [],
      },
    },
  });
  const { consumer, port } = createConsumer(initialSnapshot);

  const snapshot = await consumer.applyEvent({
    type: "appShutdown",
    nowMs: 12_000,
  });

  assert.equal(port.calls.readSnapshot, 1);
  assert.equal(port.calls.writeSnapshot, 1);
  assert.equal(snapshot.currentState.status, "recoverableOpen");
  assert.equal(snapshot.currentState.recoveryReason, "appShutdown");
  assert.equal(snapshot.currentState.session.sessionId, "app:com.ankiapp.client:0");
  assert.equal(snapshot.finalizedSessions.length, 0);
});

test("consumer resetSnapshot clears current state to idle and clears finalized ledger", async () => {
  const initialSnapshot = createSnapshot({
    currentState: {
      status: "focused",
      lastEventMs: 10_000,
      target: anki,
      session: {
        sessionId: "app:com.ankiapp.client:0",
        target: anki,
        startedAtMs: 0,
        pauseIntervals: [],
      },
    },
    finalizedSessions: [
      createFinalizedSession("session-1", anki, 0, 10_000, "awayGraceElapsed"),
    ],
  });
  const { consumer, port } = createConsumer(initialSnapshot);

  const snapshot = await consumer.resetSnapshot();

  assert.equal(port.calls.readSnapshot, 0);
  assert.equal(port.calls.writeSnapshot, 0);
  assert.equal(port.calls.resetSnapshot, 1);
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
  });
});
