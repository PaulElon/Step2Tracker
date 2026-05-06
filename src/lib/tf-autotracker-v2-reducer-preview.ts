import {
  areAutoTrackerV2TargetsEqual,
  createAutoTrackerV2InitialState,
  reduceAutoTrackerV2Session,
  type AutoTrackerV2FinalizedBy,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2SessionMachineState,
  type AutoTrackerV2Target,
} from "./tf-autotracker-v2-session-machine.js";
import { methodKeyFromLabel, roundHours } from "./tf-session-adapters.js";
import type {
  TfAutotrackerV2PreviewClassification,
  TfAutotrackerV2PreviewSpan,
} from "./tf-autotracker-v2-preview-spans.js";
import type { TfSessionLog } from "../types/models";

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

export type TfAutotrackerV2StopFinalizeSelection = {
  previewSession: TfAutotrackerV2FinalizedPreviewSession | null;
  reason:
    | "eligible"
    | "alreadyWritten"
    | "noActiveSession"
    | "unclassifiedActiveSession";
};

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
