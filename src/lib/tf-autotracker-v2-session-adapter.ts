import {
  reduceAutoTrackerV2Session,
  type AutoTrackerV2SessionMachineConfig,
  type AutoTrackerV2SessionMachineEvent,
  type AutoTrackerV2SessionMachineResult,
  type AutoTrackerV2SessionMachineState,
} from "./tf-autotracker-v2-session-machine.js";

export type AutoTrackerV2SessionAdapterInput = {
  state: AutoTrackerV2SessionMachineState;
  event: AutoTrackerV2SessionMachineEvent;
  config?: AutoTrackerV2SessionMachineConfig;
};

export type AutoTrackerV2SessionAdapterBatchInput = {
  state: AutoTrackerV2SessionMachineState;
  events: readonly AutoTrackerV2SessionMachineEvent[];
  config?: AutoTrackerV2SessionMachineConfig;
};

export type AutoTrackerV2SessionAdapterOutput = AutoTrackerV2SessionMachineResult;

export function applyAutoTrackerV2SessionEvent(
  input: AutoTrackerV2SessionAdapterInput,
): AutoTrackerV2SessionAdapterOutput {
  return reduceAutoTrackerV2Session(input.state, input.event, input.config);
}

export function applyAutoTrackerV2SessionEvents(
  input: AutoTrackerV2SessionAdapterBatchInput,
): AutoTrackerV2SessionAdapterOutput {
  let state = input.state;
  const finalizedSessions: AutoTrackerV2SessionAdapterOutput["finalizedSessions"] = [];

  for (const event of input.events) {
    const result = reduceAutoTrackerV2Session(state, event, input.config);
    state = result.state;
    finalizedSessions.push(...result.finalizedSessions);
  }

  return { state, finalizedSessions };
}
