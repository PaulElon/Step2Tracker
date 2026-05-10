import {
  AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
  areAutoTrackerV2TargetsEqual,
  createAutoTrackerV2InitialState,
  reduceAutoTrackerV2Session,
  type AutoTrackerV2FinalizedBy,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2OpenSession,
  type AutoTrackerV2SessionMachineState,
  type AutoTrackerV2Target,
} from "./tf-autotracker-v2-session-machine.js";
import type {
  AutoTrackerV2NativeRecoveryDiagnostics,
  AutoTrackerV2NativeRecoveryState,
  AutoTrackerV2NativeSamplerStatus,
  AutoTrackerV2NativeSnapshot,
} from "./tf-autotracker-v2-native-events.js";
import { methodKeyFromLabel, roundHours } from "./tf-session-adapters.js";
import { TF_AUTOTRACKER_V2_DEV_EVENT_LIMIT } from "./tf-storage.js";
import type {
  TfAutotrackerV2PreviewClassification,
  TfAutotrackerV2PreviewSpan,
} from "./tf-autotracker-v2-preview-spans.js";
import type {
  TfAutoTrackerV2DevPersistedEvent,
  TfAutoTrackerV2DevPersistedState,
  TfAutoTrackerV2DevPersistedOpenPreviewSession,
  TfAutoTrackerV2DevPersistedSamplerStatus,
  TfAutoTrackerV2DevRecoveryStatus,
  TfSessionLog,
} from "../types/models";

export type TfAutotrackerV2ReducerPreviewIgnoredSpan = {
  spanId: string;
  label: string;
  classification: "distraction" | "unclassified";
  reason: string;
};

export type TfAutotrackerV2ReducerPreviewEvent = {
  timestampMs: number;
  kind: string;
  label: string;
  sourceSpanId: string;
  targetStableId?: string;
};

export type TfAutotrackerV2FinalizedPreviewSession = {
  previewSessionId: string;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  targetLabel: string;
  matchedRuleName?: string;
  matchedRuleTarget?: string;
  sourceTargetStableId: string;
  sourceSpanIds: string[];
  sourceEventIds: string[];
  appName?: string;
  bundleId?: string;
  browserTitle?: string;
  browserUrl?: string;
  classificationReason: string;
  classification: TfAutotrackerV2PreviewClassification;
  finalizedBy: AutoTrackerV2FinalizedBy;
  isDistraction: boolean;
};

export type TfAutotrackerV2ReducerPreview = {
  state: AutoTrackerV2SessionMachineState;
  reducerEvents: TfAutotrackerV2ReducerPreviewEvent[];
  finalizedCount: number;
  finalizedPreviewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  ignoredSpans: TfAutotrackerV2ReducerPreviewIgnoredSpan[];
};

export type TfAutotrackerV2ContinuousWriteSelection = {
  previewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  skippedDuplicateCount: number;
  names: string[];
};

export type TfAutotrackerV2StopSaveSelection = {
  previewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  skippedDuplicateCount: number;
  names: string[];
  reason: "eligible" | "alreadyWritten" | "noEligibleSession";
};

export type TfAutotrackerV2StopFinalizeSelection = {
  previewSession: TfAutotrackerV2FinalizedPreviewSession | null;
  reason:
    | "eligible"
    | "alreadyWritten"
    | "noActiveSession"
    | "unclassifiedActiveSession";
};

export type TfAutotrackerV2RecoveredPreviewSessionAssessment = {
  status: TfAutoTrackerV2DevRecoveryStatus;
  recoveredPreviewSession: TfAutoTrackerV2DevPersistedOpenPreviewSession | null;
  gapMs: number;
  canFinalize: boolean;
  message: string;
};

export type AutoTrackerV2RecoveryHydration = {
  restoredState: TfAutoTrackerV2DevPersistedState | null;
  snapshot: AutoTrackerV2NativeSnapshot | null;
  samplerStatus: AutoTrackerV2NativeSamplerStatus | null;
  recoveryDiagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
};

export function shouldStartAutoTrackerV2StartupRecoveryHydration({
  hasAppliedHydration,
  nativeInspectorEnabled,
  nativeSamplerEnabled,
  userModeEnabled,
}: {
  hasAppliedHydration: boolean;
  nativeInspectorEnabled: boolean;
  nativeSamplerEnabled: boolean;
  userModeEnabled: boolean;
}): boolean {
  return !hasAppliedHydration && (nativeInspectorEnabled || nativeSamplerEnabled || userModeEnabled);
}

type ActiveFinalizedPreviewSession = {
  previewSessionId: string;
  targetLabel: string;
  matchedRuleName?: string;
  matchedRuleTarget?: string;
  sourceTargetStableId: string;
  sourceSpanIds: string[];
  sourceEventIds: string[];
  appName?: string;
  bundleId?: string;
  browserTitle?: string;
  browserUrl?: string;
  classificationReason: string;
};

type ReducerEventInput =
  | {
      type: "targetFocused";
      nowMs: number;
      target: AutoTrackerV2Target;
    }
  | {
      type: "untrackedFocused";
      nowMs: number;
    }
  | {
      type: "tick";
      nowMs: number;
    };

type ReducerPreviewBuildContext = {
  preview: TfAutotrackerV2ReducerPreview;
  sortedSpans: TfAutotrackerV2PreviewSpan[];
  activePreviewSession: ActiveFinalizedPreviewSession | null;
};

export function mergeAutoTrackerV2DevRecoveryState({
  localPersistedState,
  nativeRecoveryState,
}: {
  localPersistedState: TfAutoTrackerV2DevPersistedState | null;
  nativeRecoveryState: AutoTrackerV2NativeRecoveryState | null;
}): TfAutoTrackerV2DevPersistedState | null {
  if (!localPersistedState && !nativeRecoveryState) {
    return null;
  }

  const mergedEvents = mergeRecoveryEvents(
    localPersistedState?.events ?? [],
    nativeRecoveryState?.events ?? [],
  );
  const samplerStatus = selectPreferredRecoverySamplerStatus(
    localPersistedState?.samplerStatus ?? null,
    nativeRecoveryState?.samplerStatus ?? null,
  );
  const lastPersistedAtMs = Math.max(
    localPersistedState?.lastPersistedAtMs ?? 0,
    nativeRecoveryState?.lastPersistedAtMs ?? 0,
  );
  const lastSamplerTickCompletedAtMs = Math.max(
    localPersistedState?.lastSamplerTickCompletedAtMs ?? 0,
    nativeRecoveryState?.samplerStatus.lastTickCompletedAtMs ??
      nativeRecoveryState?.lastObservedEventTimestampMs ??
      0,
  );

  const mergedState: TfAutoTrackerV2DevPersistedState = {
    schemaVersion: 1,
    lastPersistedAtMs,
    events: mergedEvents,
    writtenPreviewSessionIds: [...(localPersistedState?.writtenPreviewSessionIds ?? [])],
    samplerStatus,
    continuousWriteStatus: localPersistedState?.continuousWriteStatus ?? null,
    lastSamplerRunning:
      samplerStatus?.running ?? localPersistedState?.lastSamplerRunning ?? false,
    lastSamplerTickCompletedAtMs:
      lastSamplerTickCompletedAtMs > 0 ? lastSamplerTickCompletedAtMs : null,
    lastEligibleOpenPreviewSession:
      localPersistedState?.lastEligibleOpenPreviewSession ?? null,
    recoveryStatus: localPersistedState?.recoveryStatus ?? "noEligibleSession",
    lastRecoveryMessage: localPersistedState?.lastRecoveryMessage ?? null,
  };

  if (
    mergedState.events.length === 0 &&
    mergedState.writtenPreviewSessionIds.length === 0 &&
    mergedState.samplerStatus === null &&
    mergedState.continuousWriteStatus === null &&
    !mergedState.lastSamplerRunning &&
    mergedState.lastSamplerTickCompletedAtMs === null &&
    mergedState.lastEligibleOpenPreviewSession === null &&
    mergedState.recoveryStatus === "noEligibleSession" &&
    mergedState.lastRecoveryMessage === null
  ) {
    return null;
  }

  return mergedState;
}

export function deriveAutoTrackerV2RecoveryHydration({
  localPersistedState = null,
  liveSamplerStatus,
  recoveryDiagnostics,
  recoveryState,
}: {
  localPersistedState?: TfAutoTrackerV2DevPersistedState | null;
  liveSamplerStatus: AutoTrackerV2NativeSamplerStatus | null;
  recoveryDiagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
  recoveryState: AutoTrackerV2NativeRecoveryState | null;
}): AutoTrackerV2RecoveryHydration {
  const shouldPreferNativeRecoveryFile =
    recoveryDiagnostics?.exists === true &&
    recoveryDiagnostics.selectedReadSource === "primary";
  const localStateForHydration = shouldPreferNativeRecoveryFile
    ? stripLocalFileBackedRecoveryState(localPersistedState)
    : localPersistedState;
  const restoredState = mergeAutoTrackerV2DevRecoveryState({
    localPersistedState: localStateForHydration,
    nativeRecoveryState: recoveryState,
  });
  const snapshotEvents = shouldPreferNativeRecoveryFile
    ? recoveryState?.events ?? []
    : restoredState?.events ?? [];

  return {
    restoredState,
    snapshot:
      snapshotEvents.length > 0 ? buildRecoveredAutoTrackerV2Snapshot(snapshotEvents) : null,
    samplerStatus: mergeNativeRecoverySamplerStatus({
      liveSamplerStatus,
      persistedSamplerStatus: recoveryState?.samplerStatus ?? null,
      recoveryDiagnostics,
    }),
    recoveryDiagnostics,
  };
}

export function buildAutoTrackerV2ReducerPreview(
  spans: TfAutotrackerV2PreviewSpan[],
): TfAutotrackerV2ReducerPreview {
  return buildAutoTrackerV2ReducerPreviewContext(spans).preview;
}

export function selectAutoTrackerV2StopFinalizePreviewSession({
  previewSpans,
  state,
  nowMs,
  writtenPreviewSessionIds,
}: {
  previewSpans: TfAutotrackerV2PreviewSpan[];
  state: AutoTrackerV2SessionMachineState;
  nowMs: number;
  writtenPreviewSessionIds: Iterable<string>;
}): TfAutotrackerV2StopFinalizeSelection {
  const writtenIds = new Set(writtenPreviewSessionIds);
  const context = buildAutoTrackerV2ReducerPreviewContext(previewSpans);

  if (state.status !== "idle") {
    const activeCandidate = selectLatestEligibleStopFinalizePreviewSpan(context.sortedSpans);

    if (activeCandidate) {
      const previewSession =
        activeCandidate.classification === "distraction"
          ? createManualStopDistractionPreviewSession(activeCandidate, nowMs)
          : createManualStopTrackedPreviewSession(activeCandidate, nowMs);

      if (previewSession) {
        if (writtenIds.has(previewSession.previewSessionId)) {
          return {
            previewSession: null,
            reason: "alreadyWritten",
          };
        }

        return {
          previewSession,
          reason: "eligible",
        };
      }
    }
  }

  const preferredTargetStableId = getOpenPreviewTargetStableId(state);
  const candidates = selectAutoTrackerV2StopFinalizePreviewSpanCandidates(
    context.sortedSpans,
    preferredTargetStableId,
  );
  let sawWrittenCandidate = false;

  for (const candidate of candidates) {
    if (candidate.classification === "distraction") {
      const previewSession = createManualStopDistractionPreviewSession(candidate, nowMs);
      if (!previewSession) {
        continue;
      }

      if (writtenIds.has(previewSession.previewSessionId)) {
        sawWrittenCandidate = true;
        continue;
      }

      return {
        previewSession,
        reason: "eligible",
      };
    }

    if (
      !preferredTargetStableId ||
      getPreviewSpanTargetStableId(candidate) !== preferredTargetStableId
    ) {
      continue;
    }

    const stopResult = reduceAutoTrackerV2Session(state, {
      type: "manualStop",
      nowMs,
    });
    const previewSession =
      stopResult.finalizedSessions
        .map((finalizedSession) =>
          finalizePreviewSession(context.activePreviewSession, finalizedSession),
        )
        .find(
          (
            selected,
          ): selected is TfAutotrackerV2FinalizedPreviewSession => selected !== null,
        ) ?? null;

    if (!previewSession) {
      continue;
    }

    if (writtenIds.has(previewSession.previewSessionId)) {
      sawWrittenCandidate = true;
      continue;
    }

    return {
      previewSession,
      reason: "eligible",
    };
  }

  return {
    previewSession: null,
    reason: sawWrittenCandidate ? "alreadyWritten" : "noActiveSession",
  };
}

export function selectAutoTrackerV2RecoveredPreviewSession({
  previewSpans,
  state,
  lastSeenAtMs,
}: {
  previewSpans: TfAutotrackerV2PreviewSpan[];
  state: AutoTrackerV2SessionMachineState;
  lastSeenAtMs: number;
}): TfAutoTrackerV2DevPersistedOpenPreviewSession | null {
  if (!Number.isFinite(lastSeenAtMs) || lastSeenAtMs <= 0) {
    return null;
  }

  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state,
    nowMs: lastSeenAtMs,
    writtenPreviewSessionIds: [],
  });

  if (!selection.previewSession) {
    return null;
  }

  return createRecoveredPreviewSessionSummary(selection.previewSession, lastSeenAtMs);
}

export function assessAutoTrackerV2RecoveredPreviewSession({
  recoveredPreviewSession,
  nowMs,
  writtenPreviewSessionIds,
  thresholdMs = AUTO_TRACKER_V2_DEFAULT_AWAY_GRACE_MS,
}: {
  recoveredPreviewSession: TfAutoTrackerV2DevPersistedOpenPreviewSession | null;
  nowMs: number;
  writtenPreviewSessionIds: Iterable<string>;
  thresholdMs?: number;
}): TfAutotrackerV2RecoveredPreviewSessionAssessment {
  if (!recoveredPreviewSession) {
    return {
      status: "noEligibleSession",
      recoveredPreviewSession: null,
      gapMs: 0,
      canFinalize: false,
      message: "No eligible tracked or distraction session was recovered.",
    };
  }

  if (
    recoveredPreviewSession.classification !== "tracked" &&
    recoveredPreviewSession.classification !== "distraction"
  ) {
    return {
      status: "ignored",
      recoveredPreviewSession,
      gapMs: 0,
      canFinalize: false,
      message: "Recovered session is unclassified, so no recovery write is allowed.",
    };
  }

  if (
    !Number.isFinite(recoveredPreviewSession.startedAtMs) ||
    !Number.isFinite(recoveredPreviewSession.lastSeenAtMs) ||
    recoveredPreviewSession.lastSeenAtMs <= recoveredPreviewSession.startedAtMs
  ) {
    return {
      status: "ignored",
      recoveredPreviewSession,
      gapMs: 0,
      canFinalize: false,
      message: "Recovered session timestamps are incomplete, so recovery was ignored.",
    };
  }

  const writtenIds = new Set(writtenPreviewSessionIds);
  if (writtenIds.has(recoveredPreviewSession.previewSessionId)) {
    return {
      status: "finalized",
      recoveredPreviewSession,
      gapMs: Math.max(0, nowMs - recoveredPreviewSession.lastSeenAtMs),
      canFinalize: false,
      message: "Recovered session was already written once and will not be duplicated.",
    };
  }

  const gapMs = Math.max(0, nowMs - recoveredPreviewSession.lastSeenAtMs);
  if (gapMs < thresholdMs) {
    return {
      status: "recoverable",
      recoveredPreviewSession,
      gapMs,
      canFinalize: false,
      message: "Recovered session is within the 60-second grace window, so no write is needed yet.",
    };
  }

  return {
    status: "finalizable",
    recoveredPreviewSession,
    gapMs,
    canFinalize: true,
    message: "Recovered session exceeded the 60-second gap threshold and can be finalized once.",
  };
}

export function finalizeAutoTrackerV2RecoveredPreviewSession(
  recoveredPreviewSession: TfAutoTrackerV2DevPersistedOpenPreviewSession | null,
): TfAutotrackerV2FinalizedPreviewSession | null {
  if (!recoveredPreviewSession) {
    return null;
  }

  if (
    (recoveredPreviewSession.classification !== "tracked" &&
      recoveredPreviewSession.classification !== "distraction") ||
    !Number.isFinite(recoveredPreviewSession.startedAtMs) ||
    !Number.isFinite(recoveredPreviewSession.lastSeenAtMs) ||
    recoveredPreviewSession.lastSeenAtMs <= recoveredPreviewSession.startedAtMs
  ) {
    return null;
  }

  const endedAtMs = recoveredPreviewSession.lastSeenAtMs;

  return {
    previewSessionId: recoveredPreviewSession.previewSessionId,
    startedAtMs: recoveredPreviewSession.startedAtMs,
    // Recovery finalization must stop at the last observed timestamp because sleep,
    // quit, or reload gaps cannot prove the user stayed on the same target afterward.
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - recoveredPreviewSession.startedAtMs),
    targetLabel: recoveredPreviewSession.targetLabel,
    matchedRuleName: recoveredPreviewSession.matchedRuleName,
    matchedRuleTarget: recoveredPreviewSession.matchedRuleTarget,
    sourceTargetStableId: recoveredPreviewSession.sourceTargetStableId,
    sourceSpanIds: [...recoveredPreviewSession.sourceSpanIds],
    sourceEventIds: [...recoveredPreviewSession.sourceEventIds],
    appName: recoveredPreviewSession.appName,
    bundleId: recoveredPreviewSession.bundleId,
    browserTitle: recoveredPreviewSession.browserTitle,
    browserUrl: recoveredPreviewSession.browserUrl,
    classificationReason: recoveredPreviewSession.classificationReason,
    classification: recoveredPreviewSession.classification,
    finalizedBy: "manualStop",
    isDistraction: recoveredPreviewSession.isDistraction,
  };
}

function buildAutoTrackerV2ReducerPreviewContext(
  spans: TfAutotrackerV2PreviewSpan[],
): ReducerPreviewBuildContext {
  const sortedSpans = [...spans].sort((a, b) => {
    const delta = a.startedAtMs - b.startedAtMs;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });

  let state: AutoTrackerV2SessionMachineState = createAutoTrackerV2InitialState();
  const reducerEvents: TfAutotrackerV2ReducerPreviewEvent[] = [];
  const ignoredSpans: TfAutotrackerV2ReducerPreviewIgnoredSpan[] = [];
  const finalizedSessions: AutoTrackerV2FinalizedSession[] = [];
  const finalizedPreviewSessions: TfAutotrackerV2FinalizedPreviewSession[] = [];
  let activePreviewSession: ActiveFinalizedPreviewSession | null = null;

  for (let index = 0; index < sortedSpans.length; index += 1) {
    const span = sortedSpans[index];
    const isTracked = span.classification === "tracked";
    const isDistraction = span.classification === "distraction";
    const isFinalizedSpan = isFinalizedPreviewSpan(span);

    if (!isTracked && state.status === "idle") {
      const classification =
        span.classification === "distraction" ? "distraction" : "unclassified";
      if (classification === "distraction" && isFinalizedSpan) {
        finalizedPreviewSessions.push(createDistractionPreviewSession(span));
      } else {
        ignoredSpans.push({
          spanId: span.id,
          label: span.label,
          classification,
          reason: "no tracked reducer session was open",
        });
      }
      continue;
    }

    const reducerEvent = isTracked
      ? createTargetFocusedEvent(span)
      : createUntrackedFocusedEvent(span);
    const previousState = state;
    const result = reduceAutoTrackerV2Session(state, reducerEvent);
    state = result.state;
    finalizedSessions.push(...result.finalizedSessions);
    activePreviewSession = updateActivePreviewSessionForSpan(
      activePreviewSession,
      previousState,
      state,
      span,
      result.finalizedSessions,
    );
    if (result.finalizedSessions.length > 0) {
      finalizedPreviewSessions.push(
        ...result.finalizedSessions
          .map((finalizedSession) =>
            finalizePreviewSession(activePreviewSession, finalizedSession),
          )
          .filter(
            (previewSession): previewSession is TfAutotrackerV2FinalizedPreviewSession =>
              previewSession !== null,
          ),
      );
      activePreviewSession = startPreviewSessionIfNeeded(activePreviewSession, state, span, isTracked);
    }

    reducerEvents.push(formatReducerEvent(span, reducerEvent));

    if (result.finalizedSessions.length === 0) {
      activePreviewSession = startPreviewSessionIfNeeded(activePreviewSession, state, span, isTracked);
    }

    const isLastSpan = index === sortedSpans.length - 1;
    if (
      !isTracked &&
      isLastSpan &&
      state.status !== "idle" &&
      span.endedAtMs !== null &&
      span.endedAtMs > span.startedAtMs
    ) {
      const tickEvent: ReducerEventInput = { type: "tick", nowMs: span.endedAtMs };
      const stateBeforeTick = state;
      const tickResult = reduceAutoTrackerV2Session(state, tickEvent);
      state = tickResult.state;
      finalizedSessions.push(...tickResult.finalizedSessions);
      if (tickResult.finalizedSessions.length > 0) {
        finalizedPreviewSessions.push(
          ...tickResult.finalizedSessions
            .map((finalizedSession) =>
              finalizePreviewSession(activePreviewSession, finalizedSession),
            )
            .filter(
              (previewSession): previewSession is TfAutotrackerV2FinalizedPreviewSession =>
                previewSession !== null,
            ),
        );
        activePreviewSession = null;
      } else {
        activePreviewSession = updateActivePreviewSessionForTick(
          activePreviewSession,
          stateBeforeTick,
          state,
          span,
        );
      }
      reducerEvents.push(formatReducerEvent(span, tickEvent));
    }

    if (isDistraction && isFinalizedSpan) {
      finalizedPreviewSessions.push(createDistractionPreviewSession(span));
    }
  }

  const orderedFinalizedPreviewSessions = [...finalizedPreviewSessions].sort((a, b) => {
    const startedDelta = a.startedAtMs - b.startedAtMs;
    if (startedDelta !== 0) {
      return startedDelta;
    }

    const endedDelta = a.endedAtMs - b.endedAtMs;
    if (endedDelta !== 0) {
      return endedDelta;
    }

    return a.previewSessionId.localeCompare(b.previewSessionId);
  });

  return {
    preview: {
      state,
      reducerEvents,
      finalizedCount: orderedFinalizedPreviewSessions.length,
      finalizedPreviewSessions: orderedFinalizedPreviewSessions,
      ignoredSpans,
    },
    sortedSpans,
    activePreviewSession,
  };
}

function mergeRecoveryEvents(
  localEvents: TfAutoTrackerV2DevPersistedEvent[],
  nativeEvents: AutoTrackerV2NativeRecoveryState["events"],
): TfAutoTrackerV2DevPersistedEvent[] {
  const deduped = new Map<string, TfAutoTrackerV2DevPersistedEvent>();

  for (const event of localEvents) {
    deduped.set(event.id, { ...event });
  }

  for (const event of nativeEvents) {
    deduped.set(event.id, mapNativeRecoveryEvent(event));
  }

  return [...deduped.values()]
    .sort((a, b) => {
      const delta = a.timestampMs - b.timestampMs;
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    })
    .slice(-TF_AUTOTRACKER_V2_DEV_EVENT_LIMIT);
}

function buildRecoveredAutoTrackerV2Snapshot(
  events: AutoTrackerV2NativeRecoveryState["events"],
): AutoTrackerV2NativeSnapshot {
  return {
    status: {
      platform: "macos",
      supported: true,
      foregroundProbeAvailable: true,
      idleProbeAvailable: true,
      bufferLen: events.length,
      bufferCapacity: TF_AUTOTRACKER_V2_DEV_EVENT_LIMIT,
      lastSampledAtMs: events.at(-1)?.timestampMs ?? null,
      note:
        "Recovered dev Auto-Tracker preview state from local/native persistence. Native sampler remains stopped until you start it again.",
    },
    events: [...events],
  };
}

function stripLocalFileBackedRecoveryState(
  state: TfAutoTrackerV2DevPersistedState | null,
): TfAutoTrackerV2DevPersistedState | null {
  if (!state) {
    return null;
  }

  return {
    ...state,
    events: [],
    samplerStatus: null,
    lastSamplerRunning: false,
    lastSamplerTickCompletedAtMs: null,
    lastEligibleOpenPreviewSession: null,
    recoveryStatus: "noEligibleSession",
    lastRecoveryMessage: null,
  };
}

function mergeNativeRecoverySamplerStatus({
  liveSamplerStatus,
  persistedSamplerStatus,
  recoveryDiagnostics,
}: {
  liveSamplerStatus: AutoTrackerV2NativeSamplerStatus | null;
  persistedSamplerStatus: AutoTrackerV2NativeSamplerStatus | null;
  recoveryDiagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
}): AutoTrackerV2NativeSamplerStatus | null {
  if (!liveSamplerStatus && !persistedSamplerStatus && !recoveryDiagnostics) {
    return null;
  }

  return {
    running: liveSamplerStatus?.running ?? persistedSamplerStatus?.running ?? false,
    intervalMs: pickPreferredPositiveNumber(
      liveSamplerStatus?.intervalMs,
      persistedSamplerStatus?.intervalMs,
    ),
    tickCount: pickPreferredPositiveNumber(
      liveSamplerStatus?.tickCount,
      persistedSamplerStatus?.tickCount,
    ),
    lastTickStartedAtMs: pickPreferredNullableNumber(
      liveSamplerStatus?.lastTickStartedAtMs,
      persistedSamplerStatus?.lastTickStartedAtMs,
    ),
    lastTickCompletedAtMs: pickPreferredNullableNumber(
      liveSamplerStatus?.lastTickCompletedAtMs,
      persistedSamplerStatus?.lastTickCompletedAtMs,
    ),
    lastAppendedCount: pickPreferredPositiveNumber(
      liveSamplerStatus?.lastAppendedCount,
      persistedSamplerStatus?.lastAppendedCount,
    ),
    lastError:
      liveSamplerStatus?.lastError ??
      persistedSamplerStatus?.lastError ??
      recoveryDiagnostics?.readError ??
      null,
    lastObservedAppName:
      liveSamplerStatus?.lastObservedAppName ??
      persistedSamplerStatus?.lastObservedAppName ??
      recoveryDiagnostics?.lastObservedAppName ??
      null,
    lastObservedBundleId:
      liveSamplerStatus?.lastObservedBundleId ??
      persistedSamplerStatus?.lastObservedBundleId ??
      recoveryDiagnostics?.lastObservedBundleId ??
      null,
    bufferCount: liveSamplerStatus?.bufferCount ?? persistedSamplerStatus?.bufferCount ?? 0,
    recoveryFilePath:
      recoveryDiagnostics?.primaryRecoveryFilePath ??
      liveSamplerStatus?.recoveryFilePath ??
      persistedSamplerStatus?.recoveryFilePath ??
      null,
    recoveryWritePath:
      recoveryDiagnostics?.writeFilePath ??
      liveSamplerStatus?.recoveryWritePath ??
      persistedSamplerStatus?.recoveryWritePath ??
      null,
    recoveryReadPath:
      recoveryDiagnostics?.readFilePath ??
      liveSamplerStatus?.recoveryReadPath ??
      persistedSamplerStatus?.recoveryReadPath ??
      null,
    recoveryWriteCount: pickPreferredPositiveNumber(
      liveSamplerStatus?.recoveryWriteCount,
      persistedSamplerStatus?.recoveryWriteCount,
    ),
    lastRecoveryWriteAtMs: pickPreferredNullableNumber(
      liveSamplerStatus?.lastRecoveryWriteAtMs,
      persistedSamplerStatus?.lastRecoveryWriteAtMs,
      recoveryDiagnostics?.modifiedAtMs,
    ),
    lastRecoveryWriteError:
      recoveryDiagnostics?.readError ??
      liveSamplerStatus?.lastRecoveryWriteError ??
      persistedSamplerStatus?.lastRecoveryWriteError ??
      null,
    lastRecoveryEventsCount:
      recoveryDiagnostics?.eventsCount ??
      pickPreferredPositiveNumber(
        liveSamplerStatus?.lastRecoveryEventsCount,
        persistedSamplerStatus?.lastRecoveryEventsCount,
      ),
    lastRecoveryWriteByteCount: pickPreferredNullableNumber(
      liveSamplerStatus?.lastRecoveryWriteByteCount,
      persistedSamplerStatus?.lastRecoveryWriteByteCount,
    ),
    lastRecoveryReadbackEventsCount:
      liveSamplerStatus?.lastRecoveryReadbackEventsCount ??
      persistedSamplerStatus?.lastRecoveryReadbackEventsCount ??
      recoveryDiagnostics?.eventsCount ??
      null,
    recoveryFileExistsAfterWrite:
      recoveryDiagnostics?.exists ??
      liveSamplerStatus?.recoveryFileExistsAfterWrite ??
      persistedSamplerStatus?.recoveryFileExistsAfterWrite ??
      null,
  };
}

function mapNativeRecoveryEvent(
  event: AutoTrackerV2NativeRecoveryState["events"][number],
): TfAutoTrackerV2DevPersistedEvent {
  return {
    id: event.id,
    kind: event.kind,
    timestampMs: event.timestampMs,
    platform: event.platform,
    appName: event.appName,
    bundleId: event.bundleId,
    bundlePath: event.bundlePath,
    windowTitle: event.windowTitle,
    isIdle: event.isIdle,
    browserTitle: event.browserTitle,
    browserUrl: event.browserUrl,
    browserTabError: event.browserTabError,
    error: event.error,
  };
}

function selectPreferredRecoverySamplerStatus(
  localStatus: TfAutoTrackerV2DevPersistedSamplerStatus | null,
  nativeStatus: AutoTrackerV2NativeRecoveryState["samplerStatus"] | null,
): TfAutoTrackerV2DevPersistedSamplerStatus | null {
  if (!localStatus && !nativeStatus) {
    return null;
  }

  const mappedNativeStatus = nativeStatus ? mapNativeRecoverySamplerStatus(nativeStatus) : null;
  if (!localStatus) {
    return mappedNativeStatus;
  }
  if (!mappedNativeStatus) {
    return localStatus;
  }

  const localRecency = samplerStatusRecency(localStatus);
  const nativeRecency = samplerStatusRecency(mappedNativeStatus);
  if (nativeRecency > localRecency) {
    return mappedNativeStatus;
  }
  if (localRecency > nativeRecency) {
    return localStatus;
  }
  if (mappedNativeStatus.tickCount > localStatus.tickCount) {
    return mappedNativeStatus;
  }
  if (localStatus.tickCount > mappedNativeStatus.tickCount) {
    return localStatus;
  }
  if (mappedNativeStatus.bufferCount > localStatus.bufferCount) {
    return mappedNativeStatus;
  }
  if (localStatus.bufferCount > mappedNativeStatus.bufferCount) {
    return localStatus;
  }
  if (mappedNativeStatus.running && !localStatus.running) {
    return mappedNativeStatus;
  }
  return localStatus;
}

function mapNativeRecoverySamplerStatus(
  status: AutoTrackerV2NativeRecoveryState["samplerStatus"],
): TfAutoTrackerV2DevPersistedSamplerStatus {
  return {
    running: status.running,
    intervalMs: status.intervalMs,
    tickCount: status.tickCount,
    lastTickStartedAtMs: status.lastTickStartedAtMs,
    lastTickCompletedAtMs: status.lastTickCompletedAtMs,
    lastAppendedCount: status.lastAppendedCount,
    lastError: status.lastError,
    lastObservedAppName: status.lastObservedAppName,
    lastObservedBundleId: status.lastObservedBundleId,
    bufferCount: status.bufferCount,
  };
}

function samplerStatusRecency(
  status: Pick<
    TfAutoTrackerV2DevPersistedSamplerStatus,
    "lastTickCompletedAtMs" | "tickCount"
  >,
): number {
  return status.lastTickCompletedAtMs ?? status.tickCount ?? 0;
}

function pickPreferredPositiveNumber(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }

  return 0;
}

function pickPreferredNullableNumber(
  ...values: Array<number | null | undefined>
): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

export function mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
  previewSession: TfAutotrackerV2FinalizedPreviewSession,
  sessionLogId: string,
): TfSessionLog {
  if (!Number.isFinite(previewSession.startedAtMs) || !Number.isFinite(previewSession.endedAtMs)) {
    throw new RangeError("Preview session timestamps must be finite.");
  }

  if (previewSession.endedAtMs <= previewSession.startedAtMs) {
    throw new RangeError("Preview session endedAtMs must be greater than startedAtMs.");
  }

  if (previewSession.classification === "unclassified") {
    throw new RangeError("Unclassified preview sessions cannot be written.");
  }

  const startISO = new Date(previewSession.startedAtMs).toISOString();
  const endISO = new Date(previewSession.endedAtMs).toISOString();
  const resourceDisplayName = deriveAutoTrackerV2PreviewSessionDisplayName(previewSession);
  const method = `${resourceDisplayName} [Auto]`;
  const methodKey = methodKeyFromLabel(`[AUTO V2 PREVIEW] ${resourceDisplayName}`);

  return {
    id: sessionLogId,
    date: startISO.slice(0, 10),
    method,
    methodKey,
    hours: roundHours(previewSession.durationMs / 3_600_000),
    startISO,
    endISO,
    notes: "",
    isDistraction: previewSession.isDistraction,
    isLive: false,
  };
}

export function selectAutoTrackerV2ContinuousWritePreviewSessions({
  finalizedPreviewSessions,
  state,
  writtenPreviewSessionIds,
}: {
  finalizedPreviewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  state: AutoTrackerV2SessionMachineState;
  writtenPreviewSessionIds: Iterable<string>;
}): TfAutotrackerV2ContinuousWriteSelection {
  const writtenIds = new Set(writtenPreviewSessionIds);
  const seenPreviewSessionIds = new Set<string>();
  const activeTargetStableId = getOpenPreviewTargetStableId(state);
  const previewSessions: TfAutotrackerV2FinalizedPreviewSession[] = [];
  let skippedDuplicateCount = 0;

  for (const previewSession of finalizedPreviewSessions) {
    if (previewSession.classification === "unclassified") {
      continue;
    }

    if (seenPreviewSessionIds.has(previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      continue;
    }
    seenPreviewSessionIds.add(previewSession.previewSessionId);

    if (writtenIds.has(previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      continue;
    }

    if (
      activeTargetStableId &&
      previewSession.sourceTargetStableId === activeTargetStableId
    ) {
      continue;
    }

    previewSessions.push(previewSession);
  }

  return {
    previewSessions,
    skippedDuplicateCount,
    names: previewSessions.map((previewSession) =>
      deriveAutoTrackerV2PreviewSessionDisplayName(previewSession),
    ),
  };
}

export function selectAutoTrackerV2StopSavePreviewSessions({
  finalizedPreviewSessions,
  previewSpans,
  state,
  nowMs,
  writtenPreviewSessionIds,
}: {
  finalizedPreviewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  previewSpans: TfAutotrackerV2PreviewSpan[];
  state: AutoTrackerV2SessionMachineState;
  nowMs: number;
  writtenPreviewSessionIds: Iterable<string>;
}): TfAutotrackerV2StopSaveSelection {
  const context = buildAutoTrackerV2ReducerPreviewContext(previewSpans);
  const writtenIds = new Set(writtenPreviewSessionIds);
  const previewSessionMap = new Map<string, TfAutotrackerV2FinalizedPreviewSession>();
  let skippedDuplicateCount = 0;
  let sawWrittenCandidate = false;

  for (const previewSession of finalizedPreviewSessions) {
    if (previewSession.classification === "unclassified") {
      continue;
    }

    if (previewSessionMap.has(previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      continue;
    }

    if (writtenIds.has(previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      sawWrittenCandidate = true;
      continue;
    }

    previewSessionMap.set(previewSession.previewSessionId, previewSession);
  }

  const stateSelection =
    state.status !== "idle"
      ? finalizePreviewSessionAtStopTime(context.activePreviewSession, state.session, nowMs)
      : null;

  if (stateSelection) {
    if (previewSessionMap.has(stateSelection.previewSessionId)) {
      skippedDuplicateCount += 1;
    } else if (writtenIds.has(stateSelection.previewSessionId)) {
      skippedDuplicateCount += 1;
      sawWrittenCandidate = true;
    } else {
      previewSessionMap.set(stateSelection.previewSessionId, stateSelection);
    }
  }

  const activeSelection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state,
    nowMs,
    writtenPreviewSessionIds,
  });

  if (activeSelection.previewSession) {
    if (previewSessionMap.has(activeSelection.previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      sawWrittenCandidate = sawWrittenCandidate || activeSelection.reason === "alreadyWritten";
    } else if (writtenIds.has(activeSelection.previewSession.previewSessionId)) {
      skippedDuplicateCount += 1;
      sawWrittenCandidate = true;
    } else {
      previewSessionMap.set(
        activeSelection.previewSession.previewSessionId,
        activeSelection.previewSession,
      );
    }
  } else if (activeSelection.reason === "alreadyWritten") {
    sawWrittenCandidate = true;
  }

  const previewSessions = [...previewSessionMap.values()].sort((a, b) => {
    const startedDelta = a.startedAtMs - b.startedAtMs;
    if (startedDelta !== 0) {
      return startedDelta;
    }

    const endedDelta = a.endedAtMs - b.endedAtMs;
    if (endedDelta !== 0) {
      return endedDelta;
    }

    return a.previewSessionId.localeCompare(b.previewSessionId);
  });

  return {
    previewSessions,
    skippedDuplicateCount,
    names: previewSessions.map((previewSession) =>
      deriveAutoTrackerV2PreviewSessionDisplayName(previewSession),
    ),
    reason:
      previewSessions.length > 0
        ? "eligible"
        : sawWrittenCandidate
          ? "alreadyWritten"
          : "noEligibleSession",
  };
}

function finalizePreviewSessionAtStopTime(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  session: AutoTrackerV2OpenSession | undefined,
  nowMs: number,
): TfAutotrackerV2FinalizedPreviewSession | null {
  if (!activePreviewSession || !session) {
    return null;
  }

  return finalizePreviewSession(activePreviewSession, {
    sessionId: session.sessionId,
    target: session.target,
    startedAtMs: session.startedAtMs,
    endedAtMs: nowMs,
    pauseIntervals: [...session.pauseIntervals],
    finalizedAtMs: nowMs,
    finalizedBy: "manualStop",
  });
}

function selectAutoTrackerV2StopFinalizePreviewSpanCandidates(
  sortedSpans: TfAutotrackerV2PreviewSpan[],
  preferredTargetStableId: string | null,
): TfAutotrackerV2PreviewSpan[] {
  const openEligibleSpans = sortedSpans
    .filter(isEligibleStopFinalizePreviewSpan)
    .slice()
    .reverse();

  if (!preferredTargetStableId) {
    return openEligibleSpans;
  }

  const preferredSpans: TfAutotrackerV2PreviewSpan[] = [];
  const fallbackSpans: TfAutotrackerV2PreviewSpan[] = [];

  for (const span of openEligibleSpans) {
    if (getPreviewSpanTargetStableId(span) === preferredTargetStableId) {
      preferredSpans.push(span);
    } else {
      fallbackSpans.push(span);
    }
  }

  return [...preferredSpans, ...fallbackSpans];
}

function selectLatestEligibleStopFinalizePreviewSpan(
  sortedSpans: TfAutotrackerV2PreviewSpan[],
): TfAutotrackerV2PreviewSpan | null {
  for (let index = sortedSpans.length - 1; index >= 0; index -= 1) {
    const span = sortedSpans[index];
    if (span.classification === "tracked" || span.classification === "distraction") {
      return span;
    }
  }

  return null;
}

function createManualStopTrackedPreviewSession(
  span: TfAutotrackerV2PreviewSpan,
  nowMs: number,
): TfAutotrackerV2FinalizedPreviewSession | null {
  if (
    span.classification !== "tracked" ||
    !Number.isFinite(nowMs) ||
    nowMs <= span.startedAtMs
  ) {
    return null;
  }

  const target = buildReducerTarget(span);
  const sourceTargetStableId = getPreviewSpanTargetStableId(span);

  return {
    previewSessionId: `${target.kind}:${sourceTargetStableId}:${span.startedAtMs}`,
    startedAtMs: span.startedAtMs,
    endedAtMs: nowMs,
    durationMs: Math.max(0, nowMs - span.startedAtMs),
    targetLabel: getPreviewSpanTargetLabel(span),
    matchedRuleName: span.matchedRuleName,
    matchedRuleTarget: span.matchedRuleTarget,
    sourceTargetStableId,
    sourceSpanIds: [span.id],
    sourceEventIds: [...span.sourceEventIds],
    appName: span.appName,
    bundleId: span.bundleId,
    browserTitle: span.browserTitle,
    browserUrl: span.browserUrl,
    classificationReason: span.classificationReason,
    classification: "tracked",
    finalizedBy: "manualStop",
    isDistraction: false,
  };
}

function isEligibleStopFinalizePreviewSpan(span: TfAutotrackerV2PreviewSpan): boolean {
  return isOpenPreviewSpan(span) && (span.classification === "tracked" || span.classification === "distraction");
}

function deriveAutoTrackerV2PreviewSessionDisplayName(
  previewSession: Pick<
    TfAutotrackerV2FinalizedPreviewSession,
    | "appName"
    | "browserTitle"
    | "browserUrl"
    | "bundleId"
    | "matchedRuleName"
    | "sourceTargetStableId"
    | "targetLabel"
  >,
): string {
  const matchedRuleName = previewSession.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  const explicitLabel = previewSession.targetLabel.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  const browserTitle = previewSession.browserTitle?.trim();
  if (browserTitle) {
    const compactTitle = compactAutoTrackerV2Title(browserTitle);
    if (compactTitle) {
      return compactTitle;
    }
  }

  const appName = previewSession.appName?.trim();
  if (appName) {
    return appName;
  }

  const bundleName = deriveAppNameFromBundleId(previewSession.bundleId);
  if (bundleName) {
    return bundleName;
  }

  const browserLabel = deriveWebsiteLabelFromUrl(previewSession.browserUrl);
  if (browserLabel) {
    return browserLabel;
  }

  const stableIdLabel = normalizeStableIdSegment(previewSession.sourceTargetStableId);
  return stableIdLabel || "Auto-Tracked";
}

function getOpenPreviewTargetStableId(
  state: AutoTrackerV2SessionMachineState,
): string | null {
  if (state.status === "focused") {
    return state.target.stableId;
  }

  if (state.status === "awayPending" || state.status === "recoverableOpen") {
    return state.session.target.stableId;
  }

  return null;
}

function compactAutoTrackerV2Title(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  const separators = [" | ", " - ", " — ", " – ", " · ", " : "];
  for (const separator of separators) {
    const index = normalized.indexOf(separator);
    if (index > 0) {
      return normalized.slice(0, index).trim();
    }
  }

  return normalized;
}

function deriveAppNameFromBundleId(bundleId?: string): string {
  const trimmed = bundleId?.trim();
  if (!trimmed) {
    return "";
  }

  const lastSegment = trimmed.split("/").filter((part) => part.length > 0).pop();
  if (!lastSegment) {
    return "";
  }

  if (lastSegment.toLowerCase().endsWith(".app")) {
    return lastSegment.slice(0, -4);
  }

  return "";
}

function deriveWebsiteLabelFromUrl(browserUrl?: string): string {
  const trimmed = browserUrl?.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.trim();
    if (!host) {
      return "";
    }

    return host.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

function createTargetFocusedEvent(
  span: TfAutotrackerV2PreviewSpan,
): ReducerEventInput & { type: "targetFocused"; target: AutoTrackerV2Target } {
  return {
    type: "targetFocused",
    nowMs: span.startedAtMs,
    target: buildReducerTarget(span),
  };
}

function createUntrackedFocusedEvent(span: TfAutotrackerV2PreviewSpan): ReducerEventInput {
  return {
    type: "untrackedFocused",
    nowMs: span.startedAtMs,
  };
}

function formatReducerEvent(
  span: TfAutotrackerV2PreviewSpan,
  event: ReducerEventInput,
): TfAutotrackerV2ReducerPreviewEvent {
  if (event.type === "targetFocused") {
    return {
      timestampMs: event.nowMs,
      kind: event.type,
      label: `Focus ${event.target.label ?? event.target.stableId}`,
      sourceSpanId: span.id,
      targetStableId: event.target.stableId,
    };
  }

  if (event.type === "untrackedFocused") {
    return {
      timestampMs: event.nowMs,
      kind: event.type,
      label: `Away via ${span.classification} span ${span.label}`,
      sourceSpanId: span.id,
    };
  }

  return {
    timestampMs: event.nowMs,
    kind: event.type,
    label: "Away grace checkpoint",
    sourceSpanId: span.id,
  };
}

function buildReducerTarget(span: TfAutotrackerV2PreviewSpan): AutoTrackerV2Target {
  if (span.kind === "website") {
    return {
      kind: "website",
      stableId: getWebsiteStableId(span),
      label: getWebsiteLabel(span),
    };
  }

  return {
    kind: "app",
    stableId: getAppStableId(span),
    label: getAppLabel(span),
  };
}

function updateActivePreviewSessionForSpan(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  previousState: AutoTrackerV2SessionMachineState,
  nextState: AutoTrackerV2SessionMachineState,
  span: TfAutotrackerV2PreviewSpan,
  finalizedSessions: AutoTrackerV2FinalizedSession[],
): ActiveFinalizedPreviewSession | null {
  const isTracked = span.classification === "tracked";

  if (!isTracked) {
    if (previousState.status === "focused" || previousState.status === "awayPending") {
      return appendSourceSpan(activePreviewSession, span);
    }
    return activePreviewSession;
  }

  const target = buildReducerTarget(span);

  if (previousState.status === "focused" && areAutoTrackerV2TargetsEqual(previousState.target, target)) {
    return appendTrackedSourceSpan(activePreviewSession, span, target);
  }

  if (
    previousState.status === "awayPending" &&
    nextState.status === "focused" &&
    finalizedSessions.length === 0 &&
    areAutoTrackerV2TargetsEqual(previousState.previousTarget, target)
  ) {
    return appendTrackedSourceSpan(activePreviewSession, span, target);
  }

  return activePreviewSession;
}

function updateActivePreviewSessionForTick(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  _previousState: AutoTrackerV2SessionMachineState,
  _nextState: AutoTrackerV2SessionMachineState,
  _span: TfAutotrackerV2PreviewSpan,
): ActiveFinalizedPreviewSession | null {
  return activePreviewSession;
}

function startPreviewSessionIfNeeded(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  state: AutoTrackerV2SessionMachineState,
  span: TfAutotrackerV2PreviewSpan,
  isTracked: boolean,
): ActiveFinalizedPreviewSession | null {
  if (!isTracked || state.status !== "focused" || state.session.startedAtMs !== span.startedAtMs) {
    return activePreviewSession;
  }

  if (activePreviewSession?.previewSessionId === state.session.sessionId) {
    return activePreviewSession;
  }

  return createActivePreviewSession(state.session.sessionId, state.target, span);
}

function createActivePreviewSession(
  previewSessionId: string,
  target: AutoTrackerV2Target,
  span: TfAutotrackerV2PreviewSpan,
): ActiveFinalizedPreviewSession {
  return {
    previewSessionId,
    targetLabel: span.matchedRuleName?.trim() || target.label || span.label,
    matchedRuleName: span.matchedRuleName,
    matchedRuleTarget: span.matchedRuleTarget,
    sourceTargetStableId: target.stableId,
    sourceSpanIds: [span.id],
    sourceEventIds: [...span.sourceEventIds],
    appName: span.appName,
    bundleId: span.bundleId,
    browserTitle: span.browserTitle,
    browserUrl: span.browserUrl,
    classificationReason: span.classificationReason,
  };
}

function appendTrackedSourceSpan(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  span: TfAutotrackerV2PreviewSpan,
  target: AutoTrackerV2Target,
): ActiveFinalizedPreviewSession | null {
  if (!activePreviewSession) {
    return createActivePreviewSession(
      `${target.kind}:${target.stableId}:${span.startedAtMs}`,
      target,
      span,
    );
  }

  const appendedPreviewSession = appendSourceSpan(activePreviewSession, span);
  if (!appendedPreviewSession) {
    return null;
  }

  return {
    ...appendedPreviewSession,
    targetLabel:
      span.matchedRuleName?.trim() ||
      span.browserTitle?.trim() ||
      span.appName?.trim() ||
      span.label.trim() ||
      appendedPreviewSession.targetLabel,
    classificationReason: appendedPreviewSession.classificationReason || span.classificationReason,
    matchedRuleName: span.matchedRuleName ?? appendedPreviewSession.matchedRuleName,
    matchedRuleTarget: span.matchedRuleTarget ?? appendedPreviewSession.matchedRuleTarget,
    appName: span.appName ?? appendedPreviewSession.appName,
    bundleId: span.bundleId ?? appendedPreviewSession.bundleId,
    browserTitle: span.browserTitle ?? appendedPreviewSession.browserTitle,
    browserUrl: span.browserUrl ?? appendedPreviewSession.browserUrl,
  };
}

function appendSourceSpan(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  span: TfAutotrackerV2PreviewSpan,
): ActiveFinalizedPreviewSession | null {
  if (!activePreviewSession) {
    return null;
  }

  return {
    ...activePreviewSession,
    sourceSpanIds: appendUnique(activePreviewSession.sourceSpanIds, span.id),
    sourceEventIds: appendAllUnique(activePreviewSession.sourceEventIds, span.sourceEventIds),
  };
}

function createRecoveredPreviewSessionSummary(
  previewSession: TfAutotrackerV2FinalizedPreviewSession,
  lastSeenAtMs: number,
): TfAutoTrackerV2DevPersistedOpenPreviewSession {
  return {
    previewSessionId: previewSession.previewSessionId,
    startedAtMs: previewSession.startedAtMs,
    lastSeenAtMs,
    targetLabel: previewSession.targetLabel,
    matchedRuleName: previewSession.matchedRuleName,
    matchedRuleTarget: previewSession.matchedRuleTarget,
    sourceTargetStableId: previewSession.sourceTargetStableId,
    sourceSpanIds: [...previewSession.sourceSpanIds],
    sourceEventIds: [...previewSession.sourceEventIds],
    appName: previewSession.appName,
    bundleId: previewSession.bundleId,
    browserTitle: previewSession.browserTitle,
    browserUrl: previewSession.browserUrl,
    classificationReason: previewSession.classificationReason,
    classification: previewSession.classification,
    isDistraction: previewSession.isDistraction,
  };
}

function finalizePreviewSession(
  activePreviewSession: ActiveFinalizedPreviewSession | null,
  finalizedSession: AutoTrackerV2FinalizedSession,
): TfAutotrackerV2FinalizedPreviewSession | null {
  if (!activePreviewSession || activePreviewSession.previewSessionId !== finalizedSession.sessionId) {
    return null;
  }

  return {
    previewSessionId: activePreviewSession.previewSessionId,
    startedAtMs: finalizedSession.startedAtMs,
    endedAtMs: finalizedSession.endedAtMs,
    durationMs: Math.max(0, finalizedSession.endedAtMs - finalizedSession.startedAtMs),
    targetLabel: activePreviewSession.targetLabel || finalizedSession.target.label || finalizedSession.target.stableId,
    matchedRuleName: activePreviewSession.matchedRuleName,
    matchedRuleTarget: activePreviewSession.matchedRuleTarget,
    sourceTargetStableId: activePreviewSession.sourceTargetStableId || finalizedSession.target.stableId,
    sourceSpanIds: [...activePreviewSession.sourceSpanIds],
    sourceEventIds: [...activePreviewSession.sourceEventIds],
    appName: activePreviewSession.appName,
    bundleId: activePreviewSession.bundleId,
    browserTitle: activePreviewSession.browserTitle,
    browserUrl: activePreviewSession.browserUrl,
    classificationReason: activePreviewSession.classificationReason,
    classification: "tracked",
    finalizedBy: finalizedSession.finalizedBy,
    isDistraction: false,
  };
}

function createDistractionPreviewSession(
  span: TfAutotrackerV2PreviewSpan,
): TfAutotrackerV2FinalizedPreviewSession {
  const sourceTargetStableId = getPreviewSpanTargetStableId(span);

  return {
    previewSessionId: `${span.kind}:${sourceTargetStableId}:${span.startedAtMs}`,
    startedAtMs: span.startedAtMs,
    endedAtMs: span.endedAtMs ?? span.startedAtMs,
    durationMs: Math.max(0, span.durationMs ?? 0),
    targetLabel: getPreviewSpanTargetLabel(span),
    matchedRuleName: span.matchedRuleName,
    matchedRuleTarget: span.matchedRuleTarget,
    sourceTargetStableId,
    sourceSpanIds: [span.id],
    sourceEventIds: [...span.sourceEventIds],
    appName: span.appName,
    bundleId: span.bundleId,
    browserTitle: span.browserTitle,
    browserUrl: span.browserUrl,
    classificationReason: span.classificationReason,
    classification: "distraction",
    finalizedBy: "manualStop",
    isDistraction: true,
  };
}

function createManualStopDistractionPreviewSession(
  span: TfAutotrackerV2PreviewSpan,
  nowMs: number,
): TfAutotrackerV2FinalizedPreviewSession | null {
  if (span.classification !== "distraction" || !Number.isFinite(nowMs) || nowMs <= span.startedAtMs) {
    return null;
  }

  const sourceTargetStableId = getPreviewSpanTargetStableId(span);
  return {
    previewSessionId: `${span.kind}:${sourceTargetStableId}:${span.startedAtMs}`,
    startedAtMs: span.startedAtMs,
    endedAtMs: nowMs,
    durationMs: Math.max(0, nowMs - span.startedAtMs),
    targetLabel: getPreviewSpanTargetLabel(span),
    matchedRuleName: span.matchedRuleName,
    matchedRuleTarget: span.matchedRuleTarget,
    sourceTargetStableId,
    sourceSpanIds: [span.id],
    sourceEventIds: [...span.sourceEventIds],
    appName: span.appName,
    bundleId: span.bundleId,
    browserTitle: span.browserTitle,
    browserUrl: span.browserUrl,
    classificationReason: span.classificationReason,
    classification: "distraction",
    finalizedBy: "manualStop",
    isDistraction: true,
  };
}

function isFinalizedPreviewSpan(span: TfAutotrackerV2PreviewSpan): boolean {
  return (
    Number.isFinite(span.startedAtMs) &&
    Number.isFinite(span.endedAtMs) &&
    Number.isFinite(span.durationMs) &&
    (span.durationMs ?? 0) > 0 &&
    (span.endedAtMs ?? 0) > span.startedAtMs
  );
}

function isOpenPreviewSpan(span: TfAutotrackerV2PreviewSpan): boolean {
  return (
    Number.isFinite(span.startedAtMs) &&
    (span.endedAtMs === null || span.durationMs === null)
  );
}

function getPreviewSpanTargetLabel(span: TfAutotrackerV2PreviewSpan): string {
  if (span.kind === "website") {
    return getWebsiteLabel(span);
  }

  return getAppLabel(span);
}

function getPreviewSpanTargetStableId(span: TfAutotrackerV2PreviewSpan): string {
  if (span.kind === "website") {
    return getWebsiteStableId(span);
  }

  return getAppStableId(span);
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function appendAllUnique(values: string[], additions: string[]): string[] {
  let next = values;

  for (const addition of additions) {
    next = appendUnique(next, addition);
  }

  return next;
}

function getWebsiteStableId(span: TfAutotrackerV2PreviewSpan): string {
  if (typeof span.browserUrl === "string" && span.browserUrl.trim().length > 0) {
    try {
      const url = new URL(span.browserUrl);
      const hostname = normalizeStableIdSegment(url.hostname);
      const pathSegment = url.pathname.split("/").filter((part) => part.length > 0)[0];
      if (pathSegment) {
        return `${hostname}/${pathSegment}`;
      }
      return hostname;
    } catch {
      // Fall through to the label-based fallback below.
    }
  }

  return normalizeStableIdSegment(span.label) || "unknown-website";
}

function getWebsiteLabel(span: TfAutotrackerV2PreviewSpan): string {
  const matchedRuleName = span.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  const title = span.browserTitle?.trim();
  if (title) {
    return title;
  }

  return span.label?.trim() || "Unknown website";
}

function getAppStableId(span: TfAutotrackerV2PreviewSpan): string {
  const bundleId = span.bundleId?.trim();
  if (bundleId) {
    return bundleId;
  }

  const appName = span.appName?.trim();
  if (appName) {
    return appName;
  }

  return span.label?.trim() || "unknown-app";
}

function getAppLabel(span: TfAutotrackerV2PreviewSpan): string {
  const matchedRuleName = span.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  const appName = span.appName?.trim();
  if (appName) {
    return appName;
  }

  return span.label?.trim() || "Unknown app";
}

function normalizeStableIdSegment(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
