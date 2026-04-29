import { applyAutoTrackerV2SessionEvent } from "./tf-autotracker-v2-session-adapter.js";
import type {
  AutoTrackerV2SessionMachineConfig,
  AutoTrackerV2SessionMachineEvent,
} from "./tf-autotracker-v2-session-machine.js";
import type { AutoTrackerV2SessionPersistencePort } from "./tf-autotracker-v2-session-persistence-port.js";
import type { AutoTrackerV2SessionRepositorySnapshot } from "./tf-autotracker-v2-session-repository.js";

export type AutoTrackerV2SessionConsumer = {
  readSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot>;
  resetSnapshot(): Promise<AutoTrackerV2SessionRepositorySnapshot>;
  applyEvent(
    event: AutoTrackerV2SessionMachineEvent,
    config?: AutoTrackerV2SessionMachineConfig,
  ): Promise<AutoTrackerV2SessionRepositorySnapshot>;
};

export function createAutoTrackerV2SessionConsumer(
  port: AutoTrackerV2SessionPersistencePort,
): AutoTrackerV2SessionConsumer {
  return {
    readSnapshot() {
      return port.readSnapshot();
    },

    resetSnapshot() {
      return port.resetSnapshot();
    },

    async applyEvent(
      event: AutoTrackerV2SessionMachineEvent,
      config?: AutoTrackerV2SessionMachineConfig,
    ): Promise<AutoTrackerV2SessionRepositorySnapshot> {
      const snapshot = await port.readSnapshot();
      const result = applyAutoTrackerV2SessionEvent({
        state: snapshot.currentState,
        event,
        config,
      });
      const nextSnapshot = {
        ...snapshot,
        currentState: result.state,
        finalizedSessions: [
          ...snapshot.finalizedSessions,
          ...result.finalizedSessions,
        ],
      };

      return port.writeSnapshot(nextSnapshot);
    },
  };
}
