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
import type { TfAutotrackerV2PreviewSpan } from "./tf-autotracker-v2-preview-spans.js";
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
  sourceTargetStableId: string;
  sourceSpanIds: string[];
  sourceEventIds: string[];
  appName?: string;
  bundleId?: string;
  browserTitle?: string;
  browserUrl?: string;
  classificationReason: string;
  finalizedBy: AutoTrackerV2FinalizedBy;
};

export type TfAutotrackerV2ReducerPreview = {
  state: AutoTrackerV2SessionMachineState;
  reducerEvents: TfAutotrackerV2ReducerPreviewEvent[];
  finalizedCount: number;
  finalizedPreviewSessions: TfAutotrackerV2FinalizedPreviewSession[];
  ignoredSpans: TfAutotrackerV2ReducerPreviewIgnoredSpan[];
};

type ActiveFinalizedPreviewSession = {
  previewSessionId: string;
  targetLabel: string;
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

export function buildAutoTrackerV2ReducerPreview(
  spans: TfAutotrackerV2PreviewSpan[],
): TfAutotrackerV2ReducerPreview {
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

    if (!isTracked && state.status === "idle") {
      const classification =
        span.classification === "distraction" ? "distraction" : "unclassified";
      ignoredSpans.push({
        spanId: span.id,
        label: span.label,
        classification,
        reason: "no tracked reducer session was open",
      });
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
  }

  return {
    state,
    reducerEvents,
    finalizedCount: finalizedSessions.length,
    finalizedPreviewSessions,
    ignoredSpans,
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

  const startISO = new Date(previewSession.startedAtMs).toISOString();
  const endISO = new Date(previewSession.endedAtMs).toISOString();
  const methodBase = previewSession.targetLabel.trim() || previewSession.sourceTargetStableId.trim() || "Auto-Tracked";
  const method = `[AUTO V2 PREVIEW] ${methodBase}`;
  const notes = [
    `[AUTO V2 PREVIEW] previewSessionId=${previewSession.previewSessionId}`,
    `stableId=${previewSession.sourceTargetStableId}`,
    `reason=${previewSession.classificationReason}`,
    `finalizedBy=${previewSession.finalizedBy}`,
    `sourceSpanIds=${previewSession.sourceSpanIds.join(",")}`,
    `sourceEventIds=${previewSession.sourceEventIds.join(",")}`,
    previewSession.appName ? `appName=${previewSession.appName}` : null,
    previewSession.bundleId ? `bundleId=${previewSession.bundleId}` : null,
    previewSession.browserTitle ? `browserTitle=${previewSession.browserTitle}` : null,
    previewSession.browserUrl ? `browserUrl=${previewSession.browserUrl}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" | ");

  return {
    id: sessionLogId,
    date: startISO.slice(0, 10),
    method,
    methodKey: methodKeyFromLabel(method),
    hours: roundHours(previewSession.durationMs / 3_600_000),
    startISO,
    endISO,
    notes,
    isDistraction: false,
    isLive: false,
  };
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
    targetLabel: target.label ?? span.label,
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
      span.browserTitle?.trim() ||
      span.appName?.trim() ||
      span.label.trim() ||
      appendedPreviewSession.targetLabel,
    classificationReason: appendedPreviewSession.classificationReason || span.classificationReason,
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
    sourceTargetStableId: activePreviewSession.sourceTargetStableId || finalizedSession.target.stableId,
    sourceSpanIds: [...activePreviewSession.sourceSpanIds],
    sourceEventIds: [...activePreviewSession.sourceEventIds],
    appName: activePreviewSession.appName,
    bundleId: activePreviewSession.bundleId,
    browserTitle: activePreviewSession.browserTitle,
    browserUrl: activePreviewSession.browserUrl,
    classificationReason: activePreviewSession.classificationReason,
    finalizedBy: finalizedSession.finalizedBy,
  };
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
  const appName = span.appName?.trim();
  if (appName) {
    return appName;
  }

  return span.label?.trim() || "Unknown app";
}

function normalizeStableIdSegment(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}
