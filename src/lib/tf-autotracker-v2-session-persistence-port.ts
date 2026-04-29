import { createAutoTrackerV2InitialState } from "./tf-autotracker-v2-session-machine.js";
import type { AutoTrackerV2SessionRepositorySnapshot } from "./tf-autotracker-v2-session-repository.js";

export type AutoTrackerV2SessionPersistencePort = {
  readSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot>;
  writeSnapshot(
    snapshot: AutoTrackerV2SessionRepositorySnapshot,
  ): Promise<AutoTrackerV2SessionRepositorySnapshot>;
  resetSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot>;
};

export class InMemoryAutoTrackerV2SessionPersistencePort
  implements AutoTrackerV2SessionPersistencePort
{
  #snapshot: AutoTrackerV2SessionRepositorySnapshot;

  constructor(snapshot?: AutoTrackerV2SessionRepositorySnapshot) {
    this.#snapshot = snapshot ? cloneSnapshot(snapshot) : createEmptySnapshot();
  }

  async readSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot> {
    return cloneSnapshot(this.#snapshot);
  }

  async writeSnapshot(
    snapshot: AutoTrackerV2SessionRepositorySnapshot,
  ): Promise<AutoTrackerV2SessionRepositorySnapshot> {
    this.#snapshot = cloneSnapshot(snapshot);
    return cloneSnapshot(this.#snapshot);
  }

  async resetSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot> {
    this.#snapshot = createEmptySnapshot();
    return cloneSnapshot(this.#snapshot);
  }
}

export function createInMemoryAutoTrackerV2SessionPersistencePort(
  snapshot?: AutoTrackerV2SessionRepositorySnapshot,
): AutoTrackerV2SessionPersistencePort {
  return new InMemoryAutoTrackerV2SessionPersistencePort(snapshot);
}

function createEmptySnapshot(): AutoTrackerV2SessionRepositorySnapshot {
  return {
    schemaVersion: 1,
    currentState: createAutoTrackerV2InitialState(),
    finalizedSessions: [],
  };
}

function cloneSnapshot(
  snapshot: AutoTrackerV2SessionRepositorySnapshot,
): AutoTrackerV2SessionRepositorySnapshot {
  return structuredClone(snapshot);
}
