import {
  createAutoTrackerV2InitialState,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2SessionMachineState,
} from "./tf-autotracker-v2-session-machine.js";

export type AutoTrackerV2SessionRepositorySnapshot = {
  schemaVersion: 1;
  currentState: AutoTrackerV2SessionMachineState;
  finalizedSessions: AutoTrackerV2FinalizedSession[];
};

export class InMemoryAutoTrackerV2SessionRepository {
  #snapshot: AutoTrackerV2SessionRepositorySnapshot;

  constructor(snapshot?: AutoTrackerV2SessionRepositorySnapshot) {
    this.#snapshot = snapshot
      ? cloneSnapshot(assertAndNormalizeSnapshot(snapshot))
      : createEmptySnapshot();
  }

  loadSnapshot(snapshot: unknown): AutoTrackerV2SessionRepositorySnapshot {
    this.#snapshot = cloneSnapshot(assertAndNormalizeSnapshot(snapshot));
    return this.getSnapshot();
  }

  getSnapshot(): AutoTrackerV2SessionRepositorySnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  saveCurrentState(
    currentState: AutoTrackerV2SessionMachineState,
  ): AutoTrackerV2SessionRepositorySnapshot {
    this.#snapshot = {
      schemaVersion: 1,
      currentState: cloneSessionMachineState(currentState),
      finalizedSessions: cloneFinalizedSessions(this.#snapshot.finalizedSessions),
    };

    return this.getSnapshot();
  }

  appendFinalizedSessions(
    finalizedSessions: readonly AutoTrackerV2FinalizedSession[],
  ): AutoTrackerV2SessionRepositorySnapshot {
    this.#snapshot = {
      schemaVersion: 1,
      currentState: cloneSessionMachineState(this.#snapshot.currentState),
      finalizedSessions: [
        ...cloneFinalizedSessions(this.#snapshot.finalizedSessions),
        ...cloneFinalizedSessions(finalizedSessions),
      ],
    };

    return this.getSnapshot();
  }

  replaceFinalizedSessions(
    finalizedSessions: readonly AutoTrackerV2FinalizedSession[],
  ): AutoTrackerV2SessionRepositorySnapshot {
    this.#snapshot = {
      schemaVersion: 1,
      currentState: cloneSessionMachineState(this.#snapshot.currentState),
      finalizedSessions: cloneFinalizedSessions(finalizedSessions),
    };

    return this.getSnapshot();
  }
}

export function createAutoTrackerV2SessionRepository(
  snapshot?: AutoTrackerV2SessionRepositorySnapshot,
): InMemoryAutoTrackerV2SessionRepository {
  return new InMemoryAutoTrackerV2SessionRepository(snapshot);
}

function createEmptySnapshot(): AutoTrackerV2SessionRepositorySnapshot {
  return {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
  };
}

function assertAndNormalizeSnapshot(
  snapshot: unknown,
): AutoTrackerV2SessionRepositorySnapshot {
  if (!isRecord(snapshot)) {
    throw new TypeError("Auto-Tracker V2 session snapshot must be an object.");
  }

  if (snapshot.schemaVersion !== 1) {
    throw new RangeError("Auto-Tracker V2 session snapshot schemaVersion must be 1.");
  }

  if (!("currentState" in snapshot) || !("finalizedSessions" in snapshot)) {
    throw new TypeError(
      "Auto-Tracker V2 session snapshot must include currentState and finalizedSessions.",
    );
  }

  if (!isRecord(snapshot.currentState) || !Array.isArray(snapshot.finalizedSessions)) {
    throw new TypeError(
      "Auto-Tracker V2 session snapshot must contain an object currentState and an array finalizedSessions.",
    );
  }

  return {
    schemaVersion: 1,
    currentState: cloneSessionMachineState(
      snapshot.currentState as AutoTrackerV2SessionMachineState,
    ),
    finalizedSessions: cloneFinalizedSessions(snapshot.finalizedSessions),
  };
}

function cloneSnapshot(
  snapshot: AutoTrackerV2SessionRepositorySnapshot,
): AutoTrackerV2SessionRepositorySnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    currentState: cloneSessionMachineState(snapshot.currentState),
    finalizedSessions: cloneFinalizedSessions(snapshot.finalizedSessions),
  };
}

function cloneFinalizedSessions(
  finalizedSessions: readonly AutoTrackerV2FinalizedSession[],
): AutoTrackerV2FinalizedSession[] {
  return finalizedSessions.map((session) => cloneFinalizedSession(session));
}

function cloneSessionMachineState(
  state: AutoTrackerV2SessionMachineState,
): AutoTrackerV2SessionMachineState {
  return structuredClone(state);
}

function cloneFinalizedSession(
  session: AutoTrackerV2FinalizedSession,
): AutoTrackerV2FinalizedSession {
  return structuredClone(session);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
