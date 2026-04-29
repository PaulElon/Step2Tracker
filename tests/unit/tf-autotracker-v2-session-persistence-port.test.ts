import assert from "node:assert/strict";
import test from "node:test";

import { applyAutoTrackerV2SessionEvents } from "../../src/lib/tf-autotracker-v2-session-adapter.js";
import { createAutoTrackerV2InitialState, type AutoTrackerV2Target } from "../../src/lib/tf-autotracker-v2-session-machine.js";
import {
  createInMemoryAutoTrackerV2SessionPersistencePort,
  type AutoTrackerV2SessionPersistencePort,
} from "../../src/lib/tf-autotracker-v2-session-persistence-port.js";
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
  finalizedBy: AutoTrackerV2SessionRepositorySnapshot["finalizedSessions"][number]["finalizedBy"],
) {
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

function createNontrivialSnapshot(): AutoTrackerV2SessionRepositorySnapshot {
  const currentState = applyAutoTrackerV2SessionEvents({
    state: createAutoTrackerV2InitialState(),
    events: [
      { type: "targetFocused", nowMs: 0, target: anki },
      { type: "untrackedFocused", nowMs: 5_000 },
      { type: "targetFocused", nowMs: 35_000, target: anki },
    ],
  }).state;

  return {
    schemaVersion: 1,
    currentState,
    finalizedSessions: [
      createFinalizedSession("session-a", anki, 0, 10_000, "awayGraceElapsed"),
      createFinalizedSession("session-b", browser, 20_000, 25_000, "manualStop"),
    ],
  };
}

async function readSnapshot(port: AutoTrackerV2SessionPersistencePort) {
  return port.readSnapshot();
}

test("readSnapshot returns the initial empty idle snapshot", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort();

  await assert.deepEqual(await readSnapshot(port), {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
  });
});

test("writeSnapshot then readSnapshot round-trips currentState and finalizedSessions verbatim", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort();
  const snapshot = createNontrivialSnapshot();

  await port.writeSnapshot(snapshot);
  const reread = await port.readSnapshot();

  assert.deepEqual(reread, snapshot);
});

test("writeSnapshot preserves finalized session order exactly", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort();
  const snapshot: AutoTrackerV2SessionRepositorySnapshot = {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(123),
    finalizedSessions: [
      createFinalizedSession("session-a", anki, 0, 10_000, "manualStop"),
      createFinalizedSession("session-b", browser, 10_000, 20_000, "awayGraceElapsed"),
      createFinalizedSession("session-c", anki, 20_000, 30_000, "manualStop"),
    ],
  };

  await port.writeSnapshot(snapshot);
  const reread = await port.readSnapshot();

  assert.deepEqual(
    reread.finalizedSessions.map((session) => session.sessionId),
    ["session-a", "session-b", "session-c"],
  );
});

test("writeSnapshot defensively clones input so caller mutation after write does not mutate port internals", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort();
  const snapshot = createNontrivialSnapshot();

  await port.writeSnapshot(snapshot);
  snapshot.currentState = createAutoTrackerV2InitialState(999);
  snapshot.finalizedSessions[0].sessionId = "mutated-source";
  snapshot.finalizedSessions.push(
    createFinalizedSession("session-c", anki, 30_000, 35_000, "manualStop"),
  );

  const reread = await port.readSnapshot();

  assert.equal(reread.currentState.lastEventMs, 35_000);
  assert.deepEqual(
    reread.finalizedSessions.map((session) => session.sessionId),
    ["session-a", "session-b"],
  );
});

test("readSnapshot returns defensive clones so caller mutation after read does not mutate port internals", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort(createNontrivialSnapshot());

  const firstRead = await port.readSnapshot();
  firstRead.currentState = createAutoTrackerV2InitialState(111);
  firstRead.finalizedSessions[0].sessionId = "mutated-read";
  firstRead.finalizedSessions.push(
    createFinalizedSession("session-c", browser, 30_000, 35_000, "manualStop"),
  );

  const secondRead = await port.readSnapshot();

  assert.equal(secondRead.currentState.lastEventMs, 35_000);
  assert.deepEqual(
    secondRead.finalizedSessions.map((session) => session.sessionId),
    ["session-a", "session-b"],
  );
});

test("resetSnapshot returns and stores the empty idle snapshot", async () => {
  const port = createInMemoryAutoTrackerV2SessionPersistencePort(createNontrivialSnapshot());

  const reset = await port.resetSnapshot();
  const reread = await port.readSnapshot();
  const emptySnapshot = {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
  };

  assert.deepEqual(reset, emptySnapshot);
  assert.deepEqual(reread, emptySnapshot);
});
