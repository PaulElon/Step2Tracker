// Auto-Tracker V2 preview span mapper.
//
// Shadow/diagnostic only. Converts buffered native events into read-only
// "would track" preview spans. Never writes any state, never creates sessions.

import type { AutoTrackerV2NativeEvent } from "./tf-autotracker-v2-native-events.js";

export type TfAutotrackerV2PreviewClassification = "tracked" | "distraction" | "unclassified";

export type TfAutotrackerV2ClassificationSettings = {
  autoApps: string[];
  autoWebsites: string[];
  distractionApps: string[];
  distractionWebsites: string[];
};

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
  classification: TfAutotrackerV2PreviewClassification;
  classificationReason: string;
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

// Returns true if hostname matches a domain rule, supporting exact and subdomain.
// e.g. rule "uworld.com" matches "uworld.com" and "apps.uworld.com" but NOT "notuworld.com".
function matchesDomainRule(hostname: string, rule: string): boolean {
  const h = hostname.toLowerCase();
  const r = rule.toLowerCase().trim();
  if (!r) return false;
  if (h === r) return true;
  if (h.endsWith(`.${r}`)) return true;
  return false;
}

// Returns true if bundleId or appName matches an app rule (exact case-insensitive, plus
// conservative contains fallback for appName).
function matchesAppRule(
  bundleId: string | undefined,
  appName: string | undefined,
  rule: string,
): boolean {
  const r = rule.toLowerCase().trim();
  if (!r) return false;
  if (bundleId && bundleId.toLowerCase() === r) return true;
  if (appName && appName.toLowerCase() === r) return true;
  if (appName && appName.toLowerCase().includes(r)) return true;
  return false;
}

function classifyPreviewSpan(
  kind: "app" | "website",
  bundleId: string | undefined,
  appName: string | undefined,
  browserUrl: string | undefined,
  settings: TfAutotrackerV2ClassificationSettings,
): { classification: TfAutotrackerV2PreviewClassification; classificationReason: string } {
  if (kind === "website" && browserUrl) {
    let hostname: string;
    try {
      hostname = new URL(browserUrl).hostname.toLowerCase();
    } catch {
      return { classification: "unclassified", classificationReason: "invalid URL" };
    }

    let isTracked = false;
    let trackedReason = "";
    let isDistraction = false;
    let distractionReason = "";

    for (const rule of settings.autoWebsites) {
      if (matchesDomainRule(hostname, rule)) {
        isTracked = true;
        trackedReason = `matched website rule "${rule}"`;
        break;
      }
    }

    for (const rule of settings.distractionWebsites) {
      if (matchesDomainRule(hostname, rule)) {
        isDistraction = true;
        distractionReason = `matched distraction website rule "${rule}"`;
        break;
      }
    }

    if (isDistraction) return { classification: "distraction", classificationReason: distractionReason };
    if (isTracked) return { classification: "tracked", classificationReason: trackedReason };
    return { classification: "unclassified", classificationReason: "no matching rule" };
  }

  if (kind === "app") {
    let isTracked = false;
    let trackedReason = "";
    let isDistraction = false;
    let distractionReason = "";

    for (const rule of settings.autoApps) {
      if (matchesAppRule(bundleId, appName, rule)) {
        isTracked = true;
        trackedReason = `matched app rule "${rule}"`;
        break;
      }
    }

    for (const rule of settings.distractionApps) {
      if (matchesAppRule(bundleId, appName, rule)) {
        isDistraction = true;
        distractionReason = `matched distraction app rule "${rule}"`;
        break;
      }
    }

    if (isDistraction) return { classification: "distraction", classificationReason: distractionReason };
    if (isTracked) return { classification: "tracked", classificationReason: trackedReason };
    return { classification: "unclassified", classificationReason: "no matching rule" };
  }

  return { classification: "unclassified", classificationReason: "no matching rule" };
}

const EMPTY_SETTINGS: TfAutotrackerV2ClassificationSettings = {
  autoApps: [],
  autoWebsites: [],
  distractionApps: [],
  distractionWebsites: [],
};

export function buildAutoTrackerV2PreviewSpans(
  events: AutoTrackerV2NativeEvent[],
  settings?: TfAutotrackerV2ClassificationSettings,
): TfAutotrackerV2PreviewSpan[] {
  const effectiveSettings = settings ?? EMPTY_SETTINGS;

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
    const kind: "app" | "website" = hasUrl ? "website" : "app";
    const { classification, classificationReason } = classifyPreviewSpan(
      kind,
      ev.bundleId,
      ev.appName,
      ev.browserUrl,
      effectiveSettings,
    );

    const newSpan: TfAutotrackerV2PreviewSpan = {
      id: `v2pspan-${spans.length}-${evId}`,
      label: hasUrl
        ? getWebsiteLabel(ev.browserUrl!, ev.browserTitle, ev.appName)
        : getAppLabel(ev),
      kind,
      appName: ev.appName,
      bundleId: ev.bundleId,
      browserTitle: ev.browserTitle,
      browserUrl: ev.browserUrl,
      startedAtMs: ev.timestampMs,
      endedAtMs: null,
      durationMs: null,
      sourceEventIds: [evId],
      classification,
      classificationReason,
    };
    spans.push(newSpan);
    currentIdentity = identity;
  }

  return spans;
}
