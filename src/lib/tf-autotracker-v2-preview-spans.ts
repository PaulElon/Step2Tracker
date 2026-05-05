// Auto-Tracker V2 preview span mapper.
//
// Shadow/diagnostic only. Converts buffered native events into read-only
// "would track" preview spans. Never writes any state, never creates sessions.

import type { AutoTrackerV2NativeEvent } from "./tf-autotracker-v2-native-events.js";

export type TfAutotrackerV2PreviewSpan = {
  id: string;
  label: string;
  kind: "app" | "website";
  appName?: string;
  bundleId?: string;
  browserTitle?: string;
  browserUrl?: string;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  sourceEventIds: string[];
};

function getWebsiteIdentity(browserUrl: string): string {
  try {
    const url = new URL(browserUrl);
    const hostname = url.hostname;
    const segments = url.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length > 0) {
      return `${hostname}/${segments[0]}`;
    }
    return hostname || browserUrl;
  } catch {
    return browserUrl;
  }
}

function getWebsiteLabel(
  browserUrl: string,
  browserTitle?: string,
  appName?: string,
): string {
  try {
    const url = new URL(browserUrl);
    if (url.hostname) return url.hostname;
  } catch {
    // URL parse failed — fall through to next candidates
  }
  if (browserTitle) return browserTitle;
  if (appName) return appName;
  return "Unknown website";
}

function getAppIdentity(event: AutoTrackerV2NativeEvent): string {
  if (typeof event.bundleId === "string" && event.bundleId) return event.bundleId;
  if (typeof event.appName === "string" && event.appName) return event.appName;
  return "unknown-app";
}

function getAppLabel(event: AutoTrackerV2NativeEvent): string {
  if (typeof event.appName === "string" && event.appName) return event.appName;
  if (typeof event.bundleId === "string" && event.bundleId) return event.bundleId;
  return "Unknown app";
}

export function buildAutoTrackerV2PreviewSpans(
  events: AutoTrackerV2NativeEvent[],
): TfAutotrackerV2PreviewSpan[] {
  const focused = [...events]
    .filter(
      (e) =>
        (e.kind === "targetFocused" || e.kind === "untrackedFocused") &&
        typeof e.timestampMs === "number" &&
        Number.isFinite(e.timestampMs),
    )
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const spans: TfAutotrackerV2PreviewSpan[] = [];
  let currentIdentity: string | null = null;

  for (const ev of focused) {
    const evId = typeof ev.id === "string" && ev.id ? ev.id : `gen-${ev.timestampMs}`;
    const hasUrl = typeof ev.browserUrl === "string" && ev.browserUrl.length > 0;
    const identity = hasUrl ? getWebsiteIdentity(ev.browserUrl!) : getAppIdentity(ev);

    if (currentIdentity === identity && spans.length > 0) {
      // Same identity — merge into existing open span
      spans[spans.length - 1].sourceEventIds.push(evId);
      continue;
    }

    // Close the previous open span
    if (spans.length > 0) {
      const prev = spans[spans.length - 1];
      if (prev.endedAtMs === null) {
        const endMs = Math.max(ev.timestampMs, prev.startedAtMs);
        prev.endedAtMs = endMs;
        prev.durationMs = endMs - prev.startedAtMs;
      }
    }

    // Start a new span
    const newSpan: TfAutotrackerV2PreviewSpan = {
      id: `v2pspan-${spans.length}-${evId}`,
      label: hasUrl
        ? getWebsiteLabel(ev.browserUrl!, ev.browserTitle, ev.appName)
        : getAppLabel(ev),
      kind: hasUrl ? "website" : "app",
      appName: ev.appName,
      bundleId: ev.bundleId,
      browserTitle: ev.browserTitle,
      browserUrl: ev.browserUrl,
      startedAtMs: ev.timestampMs,
      endedAtMs: null,
      durationMs: null,
      sourceEventIds: [evId],
    };
    spans.push(newSpan);
    currentIdentity = identity;
  }

  return spans;
}
