export const AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS = 60_000;

export type AutoTrackerV2TargetKind =
  | "app"
  | "website"
  | "bundle"
  | "process"
  | "window"
  | "browser"
  | "custom";

export type AutoTrackerV2Target = {
  kind: AutoTrackerV2TargetKind;
  stableId: string;
  label?: string;
};

export type AutoTrackerV2PauseInterval = {
  startedAtMs: number;
  resumedAtMs: number;
};

export type AutoTrackerV2OpenSession = {
  sessionId: string;
  target: AutoTrackerV2Target;
  startedAtMs: number;
  pauseIntervals: AutoTrackerV2PauseInterval[];
};

export type AutoTrackerV2FinalizedBy = "awayGraceElapsed" | "manualStop";

export type AutoTrackerV2FinalizedSession = {
  sessionId: string;
  target: AutoTrackerV2Target;
  startedAtMs: number;
  endedAtMs: number;
  pauseIntervals: AutoTrackerV2PauseInterval[];
  finalizedAtMs: number;
  finalizedBy: AutoTrackerV2FinalizedBy;
};

export type AutoTrackerV2IdleState = {
  status: "idle";
  lastEventMs: number;
};

export type AutoTrackerV2FocusedState = {
  status: "focused";
  lastEventMs: number;
  target: AutoTrackerV2Target;
  session: AutoTrackerV2OpenSession;
};

export type AutoTrackerV2AwayPendingState = {
  status: "awayPending";
  lastEventMs: number;
  previousTarget: AutoTrackerV2Target;
  leftAtMs: number;
  session: AutoTrackerV2OpenSession;
};

export type AutoTrackerV2RecoverableOpenState = {
  status: "recoverableOpen";
  lastEventMs: number;
  session: AutoTrackerV2OpenSession;
  recoveryReason: "appShutdown";
  openStateBeforeShutdown: AutoTrackerV2FocusedState | AutoTrackerV2AwayPendingState;
};

export type AutoTrackerV2SessionMachineState =
  | AutoTrackerV2IdleState
  | AutoTrackerV2FocusedState
  | AutoTrackerV2AwayPendingState
  | AutoTrackerV2RecoverableOpenState;

export type AutoTrackerV2TargetFocusedEvent = {
  type: "targetFocused";
  nowMs: number;
  target: AutoTrackerV2Target;
};

export type AutoTrackerV2UntrackedFocusedEvent = {
  type: "untrackedFocused";
  nowMs: number;
};

export type AutoTrackerV2TickEvent = {
  type: "tick";
  nowMs: number;
};

export type AutoTrackerV2AppShutdownEvent = {
  type: "appShutdown";
  nowMs: number;
};

export type AutoTrackerV2ManualStopEvent = {
  type: "manualStop";
  nowMs: number;
};

export type AutoTrackerV2MissingHeartbeatEvent = {
  type: "missingHeartbeat" | "heartbeatMissed";
  nowMs: number;
};

export type AutoTrackerV2SessionMachineEvent =
  | AutoTrackerV2TargetFocusedEvent
  | AutoTrackerV2UntrackedFocusedEvent
  | AutoTrackerV2TickEvent
  | AutoTrackerV2AppShutdownEvent
  | AutoTrackerV2ManualStopEvent
  | AutoTrackerV2MissingHeartbeatEvent;

export type AutoTrackerV2SessionMachineConfig = {
  awayGraceMs?: number;
};

export type AutoTrackerV2SessionMachineResult = {
  state: AutoTrackerV2SessionMachineState;
  finalizedSessions: AutoTrackerV2FinalizedSession[];
};

export function createAutoTrackerV2InitialState(
  lastEventMs = 0,
): AutoTrackerV2IdleState {
  return { status: "idle", lastEventMs };
}

export function areAutoTrackerV2TargetsEqual(
  a: AutoTrackerV2Target,
  b: AutoTrackerV2Target,
): boolean {
  return a.kind === b.kind && a.stableId === b.stableId;
}

export function reduceAutoTrackerV2Session(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2SessionMachineEvent,
  config: AutoTrackerV2SessionMachineConfig = {},
): AutoTrackerV2SessionMachineResult {
  assertMonotonicTimestamp(state, event);

  const awayGraceMs = config.awayGraceMs ?? AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS;

  switch (event.type) {
    case "targetFocused":
      return reduceTargetFocused(state, event, awayGraceMs);
    case "untrackedFocused":
      return reduceUntrackedFocused(state, event, awayGraceMs);
    case "tick":
      return reduceTick(state, event, awayGraceMs);
    case "appShutdown":
      return reduceAppShutdown(state, event);
    case "manualStop":
      return reduceManualStop(state, event);
    case "missingHeartbeat":
    case "heartbeatMissed":
      return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
  }
}

function reduceTargetFocused(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2TargetFocusedEvent,
  awayGraceMs: number,
): AutoTrackerV2SessionMachineResult {
  if (state.status === "idle") {
    const session = createOpenSession(event.target, event.nowMs);

    return {
      state: {
        status: "focused",
        lastEventMs: event.nowMs,
        target: event.target,
        session,
      },
      finalizedSessions: [],
    };
  }

  if (state.status === "focused") {
    if (areAutoTrackerV2TargetsEqual(state.target, event.target)) {
      return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
    }

    return {
      state: {
        status: "awayPending",
        lastEventMs: event.nowMs,
        previousTarget: state.target,
        leftAtMs: event.nowMs,
        session: state.session,
      },
      finalizedSessions: [],
    };
  }

  if (state.status === "awayPending") {
    if (
      !areAutoTrackerV2TargetsEqual(state.previousTarget, event.target) &&
      event.nowMs - state.leftAtMs < awayGraceMs
    ) {
      return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
    }

    if (
      areAutoTrackerV2TargetsEqual(state.previousTarget, event.target) &&
      event.nowMs - state.leftAtMs < awayGraceMs
    ) {
      const session = {
        ...state.session,
        pauseIntervals: [
          ...state.session.pauseIntervals,
          { startedAtMs: state.leftAtMs, resumedAtMs: event.nowMs },
        ],
      };

      return {
        state: {
          status: "focused",
          lastEventMs: event.nowMs,
          target: event.target,
          session,
        },
        finalizedSessions: [],
      };
    }

    const finalizedSession = finalizeSession(
      state.session,
      state.leftAtMs,
      event.nowMs,
      "awayGraceElapsed",
    );
    const session = createOpenSession(event.target, event.nowMs);

    return {
      state: {
        status: "focused",
        lastEventMs: event.nowMs,
        target: event.target,
        session,
      },
      finalizedSessions: [finalizedSession],
    };
  }

  return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
}

function reduceUntrackedFocused(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2UntrackedFocusedEvent,
  awayGraceMs: number,
): AutoTrackerV2SessionMachineResult {
  if (state.status === "focused") {
    return {
      state: {
        status: "awayPending",
        lastEventMs: event.nowMs,
        previousTarget: state.target,
        leftAtMs: event.nowMs,
        session: state.session,
      },
      finalizedSessions: [],
    };
  }

  if (state.status === "awayPending") {
    return finalizeIfAwayGraceElapsed(state, event.nowMs, awayGraceMs);
  }

  return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
}

function reduceTick(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2TickEvent,
  awayGraceMs: number,
): AutoTrackerV2SessionMachineResult {
  if (state.status === "awayPending") {
    return finalizeIfAwayGraceElapsed(state, event.nowMs, awayGraceMs);
  }

  return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
}

function reduceAppShutdown(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2AppShutdownEvent,
): AutoTrackerV2SessionMachineResult {
  if (state.status === "focused" || state.status === "awayPending") {
    return {
      state: {
        status: "recoverableOpen",
        lastEventMs: event.nowMs,
        session: state.session,
        recoveryReason: "appShutdown",
        openStateBeforeShutdown: withLastEventMs(state, event.nowMs),
      },
      finalizedSessions: [],
    };
  }

  return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
}

function reduceManualStop(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2ManualStopEvent,
): AutoTrackerV2SessionMachineResult {
  if (state.status === "focused") {
    return {
      state: createAutoTrackerV2InitialState(event.nowMs),
      finalizedSessions: [
        finalizeSession(state.session, event.nowMs, event.nowMs, "manualStop"),
      ],
    };
  }

  if (state.status === "awayPending") {
    return {
      state: createAutoTrackerV2InitialState(event.nowMs),
      finalizedSessions: [
        finalizeSession(state.session, state.leftAtMs, event.nowMs, "manualStop"),
      ],
    };
  }

  if (state.status === "recoverableOpen") {
    return {
      state: createAutoTrackerV2InitialState(event.nowMs),
      finalizedSessions: [
        finalizeSession(state.session, event.nowMs, event.nowMs, "manualStop"),
      ],
    };
  }

  return { state: withLastEventMs(state, event.nowMs), finalizedSessions: [] };
}

function finalizeIfAwayGraceElapsed(
  state: AutoTrackerV2AwayPendingState,
  nowMs: number,
  awayGraceMs: number,
): AutoTrackerV2SessionMachineResult {
  if (nowMs - state.leftAtMs < awayGraceMs) {
    return { state: withLastEventMs(state, nowMs), finalizedSessions: [] };
  }

  return {
    state: createAutoTrackerV2InitialState(nowMs),
    finalizedSessions: [
      finalizeSession(state.session, state.leftAtMs, nowMs, "awayGraceElapsed"),
    ],
  };
}

function createOpenSession(
  target: AutoTrackerV2Target,
  startedAtMs: number,
): AutoTrackerV2OpenSession {
  return {
    sessionId: `${target.kind}:${target.stableId}:${startedAtMs}`,
    target,
    startedAtMs,
    pauseIntervals: [],
  };
}

function finalizeSession(
  session: AutoTrackerV2OpenSession,
  endedAtMs: number,
  finalizedAtMs: number,
  finalizedBy: AutoTrackerV2FinalizedBy,
): AutoTrackerV2FinalizedSession {
  return {
    sessionId: session.sessionId,
    target: session.target,
    startedAtMs: session.startedAtMs,
    endedAtMs,
    pauseIntervals: [...session.pauseIntervals],
    finalizedAtMs,
    finalizedBy,
  };
}

function assertMonotonicTimestamp(
  state: AutoTrackerV2SessionMachineState,
  event: AutoTrackerV2SessionMachineEvent,
): void {
  if (!Number.isFinite(event.nowMs)) {
    throw new RangeError("Auto-Tracker V2 event nowMs must be finite.");
  }

  if (event.nowMs < state.lastEventMs) {
    throw new RangeError(
      "Auto-Tracker V2 event nowMs must be monotonic for a reducer state.",
    );
  }
}

function withLastEventMs<TState extends AutoTrackerV2SessionMachineState>(
  state: TState,
  lastEventMs: number,
): TState {
  return { ...state, lastEventMs };
}
