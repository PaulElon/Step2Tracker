// Auto-Tracker V2 preview span mapper.
//
// Shadow/diagnostic only. Converts buffered native events into read-only
// "would track" preview spans. Never writes any state, never creates sessions.

import type { AutoTrackerV2NativeEvent } from "./tf-autotracker-v2-native-events.js";
import { deriveTfTrackerRuleName } from "./tf-storage.js";
import type { TfTrackerRuleInput, TfTrackerRuleKind } from "../types/models";

export type TfAutotrackerV2PreviewClassification = "tracked" | "distraction" | "unclassified";

export type TfAutotrackerV2ClassificationSettings = {
  autoApps: TfTrackerRuleInput[];
  autoWebsites: TfTrackerRuleInput[];
  distractionApps: TfTrackerRuleInput[];
  distractionWebsites: TfTrackerRuleInput[];
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
  matchedRuleName?: string;
  matchedRuleTarget?: string;
};

type NormalizedTrackerRule = {
  name: string;
  target: string;
  kind: TfTrackerRuleKind;
};

type TfAutotrackerV2RuleMatch = {
  matchedRuleName: string;
  matchedRuleTarget: string;
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

function normalizeWebsiteHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/u, "").replace(/^www\./u, "");
}

function normalizeWebsitePath(pathname: string): string {
  let normalized = pathname.trim();
  if (!normalized) {
    return "/";
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/\/+$/u, "");
  return normalized.length > 0 ? normalized : "/";
}

type ParsedWebsiteRule = {
  raw: string;
  host: string;
  path: string;
};

function normalizeTrackerRuleInput(
  ruleInput: TfTrackerRuleInput,
  kind: TfTrackerRuleKind,
): NormalizedTrackerRule | null {
  if (typeof ruleInput === "string") {
    const target = ruleInput.trim();
    if (!target) {
      return null;
    }

    return {
      name: deriveTfTrackerRuleName(target, kind),
      target,
      kind,
    };
  }

  if (!ruleInput || typeof ruleInput !== "object") {
    return null;
  }

  const target = typeof ruleInput.target === "string" ? ruleInput.target.trim() : "";
  if (!target) {
    return null;
  }

  return {
    name:
      (typeof ruleInput.name === "string" && ruleInput.name.trim()) ||
      deriveTfTrackerRuleName(target, kind),
    target,
    kind,
  };
}

function parseWebsiteRule(value: string): ParsedWebsiteRule | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed, `https://${trimmed}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      return {
        raw: trimmed,
        host: normalizeWebsiteHost(url.hostname),
        path: normalizeWebsitePath(url.pathname),
      };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function parseWebsiteTarget(value: string): ParsedWebsiteRule | null {
  try {
    const url = new URL(value);
    return {
      raw: value,
      host: normalizeWebsiteHost(url.hostname),
      path: normalizeWebsitePath(url.pathname),
    };
  } catch {
    return null;
  }
}

function websiteHostsMatch(targetHost: string, ruleHost: string): boolean {
  if (!targetHost || !ruleHost) {
    return false;
  }

  return targetHost === ruleHost || targetHost.endsWith(`.${ruleHost}`);
}

function websitePathsMatch(targetPath: string, rulePath: string): boolean {
  if (rulePath === "/") {
    return true;
  }

  return targetPath === rulePath || targetPath.startsWith(`${rulePath}/`);
}

function matchWebsiteRule(
  browserUrl: string,
  ruleInput: TfTrackerRuleInput,
  reasonPrefix: "matched website rule" | "matched distraction website rule" = "matched website rule",
): TfAutotrackerV2RuleMatch | null {
  const target = parseWebsiteTarget(browserUrl);
  if (!target) {
    return null;
  }

  const rule = normalizeTrackerRuleInput(ruleInput, "website");
  if (!rule) {
    return null;
  }

  const parsedRule = parseWebsiteRule(rule.target);
  if (!parsedRule) {
    return null;
  }

  if (!websiteHostsMatch(target.host, parsedRule.host)) {
    return null;
  }

  if (!websitePathsMatch(target.path, parsedRule.path)) {
    return null;
  }

  const pathReason = parsedRule.path === "/" ? "" : ` and path prefix ${parsedRule.path}`;
  return {
    matchedRuleName: rule.name,
    matchedRuleTarget: rule.target,
    classificationReason: `${reasonPrefix} "${rule.name}" (${rule.target}) by host ${parsedRule.host}${pathReason}`,
  };
}

function normalizeAppValue(value: string): string {
  return value.trim().toLowerCase();
}

function extractAppNameCandidate(rule: string): string | null {
  const trimmed = rule.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed.split(/[?#]/u)[0].replace(/\/+$/u, "");
  const lastSegment = cleaned.split("/").filter((part) => part.length > 0).pop();
  if (!lastSegment) {
    return null;
  }

  if (lastSegment.toLowerCase().endsWith(".app")) {
    return lastSegment.slice(0, -4);
  }

  return null;
}

function containsWithBoundary(haystack: string, needle: string): boolean {
  if (!needle || needle.length < 3) {
    return false;
  }

  const index = haystack.indexOf(needle);
  if (index === -1) {
    return false;
  }

  const before = index === 0 ? "" : haystack[index - 1];
  const afterIndex = index + needle.length;
  const after = afterIndex >= haystack.length ? "" : haystack[afterIndex];
  const isBoundary = (character: string): boolean =>
    character === "" || !/[a-z0-9]/iu.test(character);

  return isBoundary(before) && isBoundary(after);
}

function matchesAppRule(
  bundleId: string | undefined,
  appName: string | undefined,
  ruleInput: TfTrackerRuleInput,
  reasonPrefix: "matched app rule" | "matched distraction app rule" = "matched app rule",
): TfAutotrackerV2RuleMatch | null {
  const rule = normalizeTrackerRuleInput(ruleInput, "app");
  if (!rule) {
    return null;
  }

  const appNameCandidate = extractAppNameCandidate(rule.target);
  const ruleCandidates = [rule.target, appNameCandidate].filter(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0,
  );

  const normalizedBundleId = bundleId ? normalizeAppValue(bundleId) : "";
  const normalizedAppName = appName ? normalizeAppValue(appName) : "";

  for (const candidate of ruleCandidates) {
    const normalizedCandidate = normalizeAppValue(candidate);
    if (normalizedBundleId && normalizedBundleId === normalizedCandidate) {
      return {
        matchedRuleName: rule.name,
        matchedRuleTarget: rule.target,
        classificationReason: `${reasonPrefix} "${rule.name}" (${rule.target}) by bundle id ${bundleId?.trim() ?? normalizedCandidate}`,
      };
    }
  }

  for (const candidate of ruleCandidates) {
    const normalizedCandidate = normalizeAppValue(candidate);
    if (normalizedAppName && normalizedAppName === normalizedCandidate) {
      return {
        matchedRuleName: rule.name,
        matchedRuleTarget: rule.target,
        classificationReason: `${reasonPrefix} "${rule.name}" (${rule.target}) by app name ${appName?.trim() ?? normalizedCandidate}`,
      };
    }
  }

  for (const candidate of ruleCandidates) {
    const normalizedCandidate = normalizeAppValue(candidate);
    if (
      normalizedAppName &&
      (containsWithBoundary(normalizedAppName, normalizedCandidate) ||
        containsWithBoundary(normalizedCandidate, normalizedAppName))
    ) {
      return {
        matchedRuleName: rule.name,
        matchedRuleTarget: rule.target,
        classificationReason: `${reasonPrefix} "${rule.name}" (${rule.target}) by app name ${appName?.trim() ?? normalizedCandidate}`,
      };
    }
  }

  return null;
}

function classifyPreviewSpan(
  kind: "app" | "website",
  bundleId: string | undefined,
  appName: string | undefined,
  browserUrl: string | undefined,
  settings: TfAutotrackerV2ClassificationSettings,
): {
  classification: TfAutotrackerV2PreviewClassification;
  classificationReason: string;
  matchedRuleName?: string;
  matchedRuleTarget?: string;
} {
  if (kind === "website" && browserUrl) {
    for (const rule of settings.autoWebsites) {
      const matchReason = matchWebsiteRule(browserUrl, rule);
      if (matchReason) {
        for (const distractionRule of settings.distractionWebsites) {
          const distractionMatchReason = matchWebsiteRule(
            browserUrl,
            distractionRule,
            "matched distraction website rule",
          );
          if (distractionMatchReason) {
            return {
              classification: "distraction",
              classificationReason: distractionMatchReason.classificationReason,
              matchedRuleName: distractionMatchReason.matchedRuleName,
              matchedRuleTarget: distractionMatchReason.matchedRuleTarget,
            };
          }
        }
        return {
          classification: "tracked",
          classificationReason: matchReason.classificationReason,
          matchedRuleName: matchReason.matchedRuleName,
          matchedRuleTarget: matchReason.matchedRuleTarget,
        };
      }
    }

    for (const rule of settings.distractionWebsites) {
      const matchReason = matchWebsiteRule(browserUrl, rule, "matched distraction website rule");
      if (matchReason) {
        return {
          classification: "distraction",
          classificationReason: matchReason.classificationReason,
          matchedRuleName: matchReason.matchedRuleName,
          matchedRuleTarget: matchReason.matchedRuleTarget,
        };
      }
    }

    try {
      new URL(browserUrl);
    } catch {
      return { classification: "unclassified", classificationReason: "invalid URL" };
    }

    return { classification: "unclassified", classificationReason: "no matching rule" };
  }

  if (kind === "app") {
    for (const rule of settings.autoApps) {
      const matchReason = matchesAppRule(bundleId, appName, rule);
      if (matchReason) {
        for (const distractionRule of settings.distractionApps) {
          const distractionMatchReason = matchesAppRule(
            bundleId,
            appName,
            distractionRule,
            "matched distraction app rule",
          );
          if (distractionMatchReason) {
            return {
              classification: "distraction",
              classificationReason: distractionMatchReason.classificationReason,
              matchedRuleName: distractionMatchReason.matchedRuleName,
              matchedRuleTarget: distractionMatchReason.matchedRuleTarget,
            };
          }
        }
        return {
          classification: "tracked",
          classificationReason: matchReason.classificationReason,
          matchedRuleName: matchReason.matchedRuleName,
          matchedRuleTarget: matchReason.matchedRuleTarget,
        };
      }
    }

    for (const rule of settings.distractionApps) {
      const matchReason = matchesAppRule(bundleId, appName, rule, "matched distraction app rule");
      if (matchReason) {
        return {
          classification: "distraction",
          classificationReason: matchReason.classificationReason,
          matchedRuleName: matchReason.matchedRuleName,
          matchedRuleTarget: matchReason.matchedRuleTarget,
        };
      }
    }

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
    const { classification, classificationReason, matchedRuleName, matchedRuleTarget } = classifyPreviewSpan(
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
      matchedRuleName,
      matchedRuleTarget,
    };
    spans.push(newSpan);
    currentIdentity = identity;
  }

  return spans;
}
