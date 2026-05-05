import {
  createAutoTrackerV2InitialState,
  reduceAutoTrackerV2Session,
  type AutoTrackerV2FinalizedSession,
  type AutoTrackerV2SessionMachineState,
  type AutoTrackerV2Target,
} from "./tf-autotracker-v2-session-machine.js";
import type { TfAutotrackerV2PreviewSpan } from "./tf-autotracker-v2-preview-spans.js";

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

export type TfAutotrackerV2ReducerPreview = {
  state: AutoTrackerV2SessionMachineState;
  reducerEvents: TfAutotrackerV2ReducerPreviewEvent[];
  finalizedCount: number;
  ignoredSpans: TfAutotrackerV2ReducerPreviewIgnoredSpan[];
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
    const result = reduceAutoTrackerV2Session(state, reducerEvent);
    state = result.state;
    finalizedSessions.push(...result.finalizedSessions);
    reducerEvents.push(formatReducerEvent(span, reducerEvent));

    const isLastSpan = index === sortedSpans.length - 1;
    if (
      !isTracked &&
      isLastSpan &&
      state.status !== "idle" &&
      span.endedAtMs !== null &&
      span.endedAtMs > span.startedAtMs
    ) {
      const tickEvent: ReducerEventInput = { type: "tick", nowMs: span.endedAtMs };
      const tickResult = reduceAutoTrackerV2Session(state, tickEvent);
      state = tickResult.state;
      finalizedSessions.push(...tickResult.finalizedSessions);
      reducerEvents.push(formatReducerEvent(span, tickEvent));
    }
  }

  return {
    state,
    reducerEvents,
    finalizedCount: finalizedSessions.length,
    ignoredSpans,
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
