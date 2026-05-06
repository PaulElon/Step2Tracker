import type {
  TfAppState,
  TfSessionLog,
  TfSummaryPayload,
  TfTrackerPrefs,
  TfAccountState,
  TfAutoTrackerV2DevContinuousWriteStatus,
  TfAutoTrackerV2DevRecoveryStatus,
  TfAutoTrackerV2DevPersistedEvent,
  TfAutoTrackerV2DevPersistedOpenPreviewSession,
  TfAutoTrackerV2DevPersistedSamplerStatus,
  TfAutoTrackerV2DevPersistedState,
  TfTrackerRule,
  TfTrackerRuleInput,
  TfTrackerRuleKind,
} from "../types/models";
import {
  loadNativeTfState,
  saveNativeTfState,
  resetNativeTfState,
} from "./native-persistence";

export const TF_STATE_VERSION = 1;
export const TF_STORAGE_KEY = "timefolio-tracker:state";
export const TF_AUTOTRACKER_V2_DEV_STATE_STORAGE_KEY =
  "timefolio-tracker:autotracker-v2-dev-preview";
export const TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION = 1;
export const TF_AUTOTRACKER_V2_DEV_EVENT_LIMIT = 2_000;
export const TF_AUTOTRACKER_V2_DEV_WRITTEN_ID_LIMIT = 2_000;

export interface QueuedTfStateSaveResult {
  saved: TfAppState;
  isLatest: boolean;
  requestId: number;
}

export function createQueuedTfStateSaver(
  save: (state: TfAppState) => Promise<TfAppState>,
): {
  enqueue(state: TfAppState): Promise<QueuedTfStateSaveResult>;
} {
  let queue = Promise.resolve<void>(undefined);
  let latestRequestId = 0;

  return {
    enqueue(state: TfAppState) {
      const requestId = ++latestRequestId;
      const pending = queue.then(() => save(state));
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending.then((saved) => ({
        saved,
        isLatest: requestId === latestRequestId,
        requestId,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Empty / default state
// ---------------------------------------------------------------------------

export function getEmptyTfAppState(): TfAppState {
  return {
    tfVersion: TF_STATE_VERSION,
    sessionLogs: [],
    summaries: [],
    trackerPrefs: {
      customAutoApps: [],
      customAutoWebsites: [],
      customDistractionApps: [],
      customDistractionWebsites: [],
    },
    account: null,
  };
}

// ---------------------------------------------------------------------------
// Normalization helpers (private)
// ---------------------------------------------------------------------------

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function safeNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function safeNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function safeNullableNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const TRACKER_RULE_NAME_OVERRIDES: Record<string, string> = {
  amboss: "AMBOSS",
  anki: "Anki",
  chatgpt: "ChatGPT",
  reddit: "Reddit",
  uworld: "UWorld",
};

const GENERIC_HOST_SEGMENTS = new Set([
  "app",
  "apps",
  "beta",
  "docs",
  "help",
  "learn",
  "m",
  "portal",
  "support",
  "web",
  "www",
]);

function titleizeTrackerRuleSegment(value: string): string {
  const normalized = value.trim().replace(/[-_]+/gu, " ");
  if (!normalized) {
    return "";
  }

  const override = TRACKER_RULE_NAME_OVERRIDES[normalized.toLowerCase()];
  if (override) {
    return override;
  }

  return normalized
    .split(/\s+/u)
    .filter((part) => part.length > 0)
    .map((part) => {
      const partOverride = TRACKER_RULE_NAME_OVERRIDES[part.toLowerCase()];
      if (partOverride) {
        return partOverride;
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function extractAppNameFromTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }

  const withoutQuery = trimmed.split(/[?#]/u)[0].replace(/\/+$/u, "");
  const lastSegment = withoutQuery.split("/").filter((part) => part.length > 0).pop() ?? withoutQuery;
  if (!lastSegment) {
    return "";
  }

  if (lastSegment.toLowerCase().endsWith(".app")) {
    return lastSegment.slice(0, -4);
  }

  return titleizeTrackerRuleSegment(lastSegment.replace(/\.[a-z0-9]+$/iu, ""));
}

function extractWebsiteNameFromTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    return "";
  }

  const candidates = [trimmed, `https://${trimmed}`];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const hostParts = url.hostname
        .trim()
        .toLowerCase()
        .replace(/\.+$/u, "")
        .split(".")
        .filter((part) => part.length > 0);
      if (hostParts.length === 0) {
        continue;
      }

      const nonTldParts = hostParts.length > 1 ? hostParts.slice(0, -1) : hostParts;
      const preferredPart =
        [...nonTldParts].reverse().find((part) => !GENERIC_HOST_SEGMENTS.has(part)) ??
        nonTldParts[nonTldParts.length - 1] ??
        hostParts[0];
      const titled = titleizeTrackerRuleSegment(preferredPart);
      if (titled) {
        return titled;
      }

      return url.hostname.replace(/^www\./u, "");
    } catch {
      // Try the next candidate.
    }
  }

  return titleizeTrackerRuleSegment(trimmed);
}

function buildTrackerRuleId(kind: TfTrackerRuleKind, index: number, target: string): string {
  const normalizedTarget =
    target
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48) || "rule";
  return `tf-rule-${kind}-${index}-${normalizedTarget}`;
}

export function deriveTfTrackerRuleName(target: string, kind: TfTrackerRuleKind): string {
  const derived =
    kind === "app" ? extractAppNameFromTarget(target) : extractWebsiteNameFromTarget(target);
  return derived || target.trim() || (kind === "app" ? "App" : "Website");
}

function normalizeTrackerRule(
  value: TfTrackerRuleInput | unknown,
  kind: TfTrackerRuleKind,
  index: number,
): TfTrackerRule | null {
  if (typeof value === "string") {
    const target = value.trim();
    if (!target) {
      return null;
    }

    return {
      id: buildTrackerRuleId(kind, index, target),
      name: deriveTfTrackerRuleName(target, kind),
      target,
      kind,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const target = safeString(raw.target).trim();
  if (!target) {
    return null;
  }

  const id = safeString(raw.id).trim() || buildTrackerRuleId(kind, index, target);
  const name = safeString(raw.name).trim() || deriveTfTrackerRuleName(target, kind);

  return {
    id,
    name,
    target,
    kind,
  };
}

function normalizeTrackerRuleArray(value: unknown, kind: TfTrackerRuleKind): TfTrackerRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => normalizeTrackerRule(entry as TfTrackerRuleInput | unknown, kind, index))
    .filter((entry): entry is TfTrackerRule => entry !== null);
}

function normalizeSession(entry: unknown): TfSessionLog | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const id = safeString(e.id);
  if (!id) return null;
  return {
    id,
    date: safeString(e.date),
    method: safeString(e.method),
    methodKey: safeString(e.methodKey),
    hours: safeNumber(e.hours, 0),
    startISO: safeString(e.startISO),
    endISO: safeString(e.endISO),
    notes: safeString(e.notes),
    isDistraction: safeBoolean(e.isDistraction),
    isLive: safeBoolean(e.isLive),
  };
}

function normalizeSummary(entry: unknown): TfSummaryPayload | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const id = safeString(e.id);
  if (!id) return null;
  const kind = e.kind === "daily" || e.kind === "weekly" || e.kind === "monthly" ? e.kind : "daily";
  const rawMetrics = e.metrics && typeof e.metrics === "object" ? (e.metrics as Record<string, unknown>) : {};
  return {
    id,
    kind,
    label: safeString(e.label),
    generatedAtISO: safeString(e.generatedAtISO),
    voice: safeString(e.voice),
    text: safeString(e.text),
    caption: safeString(e.caption),
    metrics: {
      streak: safeNumber(rawMetrics.streak, 0),
      studyHours: safeNumber(rawMetrics.studyHours, 0),
      focusRate: safeNumber(rawMetrics.focusRate, 0),
      topMethod: safeString(rawMetrics.topMethod),
    },
  };
}

function normalizeTrackerPrefs(v: unknown): TfTrackerPrefs {
  const p = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    customAutoApps: normalizeTrackerRuleArray(p.customAutoApps, "app"),
    customAutoWebsites: normalizeTrackerRuleArray(p.customAutoWebsites, "website"),
    customDistractionApps: normalizeTrackerRuleArray(p.customDistractionApps, "app"),
    customDistractionWebsites: normalizeTrackerRuleArray(p.customDistractionWebsites, "website"),
  };
}

function normalizeAccount(v: unknown): TfAccountState | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  return {
    userId: typeof a.userId === "string" ? a.userId : null,
    email: typeof a.email === "string" ? a.email : null,
    username: typeof a.username === "string" ? a.username : null,
    emailVerified: safeBoolean(a.emailVerified),
    syncId: typeof a.syncId === "string" ? a.syncId : null,
    planTier: a.planTier === "pro" ? "pro" : "free",
    themeUnlocks: safeStringArray(a.themeUnlocks),
    billingCustomerId: typeof a.billingCustomerId === "string" ? a.billingCustomerId : null,
  };
}

// ---------------------------------------------------------------------------
// Public normalization
// ---------------------------------------------------------------------------

export function normalizeTfAppState(input: unknown): TfAppState {
  try {
    const empty = getEmptyTfAppState();
    if (!input || typeof input !== "object") return empty;
    const raw = input as Record<string, unknown>;

    const sessionLogs: TfSessionLog[] = Array.isArray(raw.sessionLogs)
      ? raw.sessionLogs.map(normalizeSession).filter((x): x is TfSessionLog => x !== null)
      : [];

    const summaries: TfSummaryPayload[] = Array.isArray(raw.summaries)
      ? raw.summaries.map(normalizeSummary).filter((x): x is TfSummaryPayload => x !== null)
      : [];

    return {
      tfVersion: safeNumber(raw.tfVersion, TF_STATE_VERSION),
      sessionLogs,
      summaries,
      trackerPrefs: normalizeTrackerPrefs(raw.trackerPrefs),
      account: normalizeAccount(raw.account),
    };
  } catch {
    return getEmptyTfAppState();
  }
}

function normalizeTfAutoTrackerV2DevEvent(
  value: unknown,
): TfAutoTrackerV2DevPersistedEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const id = safeString(raw.id).trim();
  const timestampMs = safeNullableNumber(raw.timestampMs);
  if (!id || timestampMs === null) {
    return null;
  }

  const kind = safeString(raw.kind).trim();
  if (
    kind !== "targetFocused" &&
    kind !== "untrackedFocused" &&
    kind !== "idleChanged" &&
    kind !== "appShutdown" &&
    kind !== "permissionStatus" &&
    kind !== "error"
  ) {
    return null;
  }

  return {
    id,
    kind,
    timestampMs,
    platform: "macos",
    appName: safeString(raw.appName).trim() || undefined,
    bundleId: safeString(raw.bundleId).trim() || undefined,
    windowTitle: safeString(raw.windowTitle).trim() || undefined,
    isIdle: typeof raw.isIdle === "boolean" ? raw.isIdle : undefined,
    browserTitle: safeString(raw.browserTitle).trim() || undefined,
    browserUrl: safeString(raw.browserUrl).trim() || undefined,
    browserTabError: safeString(raw.browserTabError).trim() || undefined,
    error: safeString(raw.error).trim() || undefined,
  };
}

function normalizeTfAutoTrackerV2DevSamplerStatus(
  value: unknown,
): TfAutoTrackerV2DevPersistedSamplerStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  return {
    running: safeBoolean(raw.running),
    intervalMs: Math.max(0, safeNumber(raw.intervalMs, 0)),
    tickCount: Math.max(0, safeNumber(raw.tickCount, 0)),
    lastTickStartedAtMs: safeNullableNumber(raw.lastTickStartedAtMs),
    lastTickCompletedAtMs: safeNullableNumber(raw.lastTickCompletedAtMs),
    lastAppendedCount: Math.max(0, safeNumber(raw.lastAppendedCount, 0)),
    lastError: safeNullableString(raw.lastError),
    lastObservedAppName: safeNullableString(raw.lastObservedAppName),
    lastObservedBundleId: safeNullableString(raw.lastObservedBundleId),
    bufferCount: Math.max(0, safeNumber(raw.bufferCount, 0)),
  };
}

function normalizeTfAutoTrackerV2DevContinuousWriteStatus(
  value: unknown,
): TfAutoTrackerV2DevContinuousWriteStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  return {
    writtenCount: Math.max(0, safeNumber(raw.writtenCount, 0)),
    names: safeStringArray(raw.names),
    skippedDuplicateCount: Math.max(0, safeNumber(raw.skippedDuplicateCount, 0)),
    error: safeNullableString(raw.error),
  };
}

function normalizeTfAutoTrackerV2DevRecoveryStatus(
  value: unknown,
): TfAutoTrackerV2DevRecoveryStatus {
  return value === "recoverable" ||
    value === "finalizable" ||
    value === "finalized" ||
    value === "ignored" ||
    value === "noEligibleSession"
    ? value
    : "noEligibleSession";
}

function normalizeTfAutoTrackerV2DevPersistedOpenPreviewSession(
  value: unknown,
): TfAutoTrackerV2DevPersistedOpenPreviewSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const previewSessionId = safeString(raw.previewSessionId).trim();
  const sourceTargetStableId = safeString(raw.sourceTargetStableId).trim();
  const targetLabel = safeString(raw.targetLabel).trim();
  const classificationReason = safeString(raw.classificationReason).trim();
  const startedAtMs = safeNullableNumber(raw.startedAtMs);
  const lastSeenAtMs = safeNullableNumber(raw.lastSeenAtMs);
  const classification =
    raw.classification === "tracked" ||
    raw.classification === "distraction" ||
    raw.classification === "unclassified"
      ? raw.classification
      : null;

  if (
    !previewSessionId ||
    !sourceTargetStableId ||
    !targetLabel ||
    !classificationReason ||
    startedAtMs === null ||
    lastSeenAtMs === null ||
    classification === null
  ) {
    return null;
  }

  return {
    previewSessionId,
    startedAtMs,
    lastSeenAtMs,
    targetLabel,
    matchedRuleName: safeString(raw.matchedRuleName).trim() || undefined,
    matchedRuleTarget: safeString(raw.matchedRuleTarget).trim() || undefined,
    sourceTargetStableId,
    sourceSpanIds: safeStringArray(raw.sourceSpanIds),
    sourceEventIds: safeStringArray(raw.sourceEventIds),
    appName: safeString(raw.appName).trim() || undefined,
    bundleId: safeString(raw.bundleId).trim() || undefined,
    browserTitle: safeString(raw.browserTitle).trim() || undefined,
    browserUrl: safeString(raw.browserUrl).trim() || undefined,
    classificationReason,
    classification,
    isDistraction: safeBoolean(raw.isDistraction, classification === "distraction"),
  };
}

function normalizeTfAutoTrackerV2DevWrittenPreviewSessionIds(value: unknown): string[] {
  const seen = new Set<string>();
  const ids = safeStringArray(value)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .filter((entry) => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
  return ids.slice(-TF_AUTOTRACKER_V2_DEV_WRITTEN_ID_LIMIT);
}

export function normalizeTfAutoTrackerV2DevPersistedState(
  input: unknown,
): TfAutoTrackerV2DevPersistedState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const schemaVersion = safeNumber(
    raw.schemaVersion,
    TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION,
  );
  if (schemaVersion !== TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION) {
    return null;
  }

  const events = Array.isArray(raw.events)
    ? raw.events
        .map((entry) => normalizeTfAutoTrackerV2DevEvent(entry))
        .filter((entry): entry is TfAutoTrackerV2DevPersistedEvent => entry !== null)
        .slice(-TF_AUTOTRACKER_V2_DEV_EVENT_LIMIT)
    : [];
  const samplerStatus = normalizeTfAutoTrackerV2DevSamplerStatus(raw.samplerStatus);

  return {
    schemaVersion: TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION,
    lastPersistedAtMs: Math.max(
      0,
      safeNumber(raw.lastPersistedAtMs ?? raw.savedAtMs, 0),
    ),
    events,
    writtenPreviewSessionIds: normalizeTfAutoTrackerV2DevWrittenPreviewSessionIds(
      raw.writtenPreviewSessionIds,
    ),
    samplerStatus,
    continuousWriteStatus: normalizeTfAutoTrackerV2DevContinuousWriteStatus(
      raw.continuousWriteStatus,
    ),
    lastSamplerRunning: safeBoolean(raw.lastSamplerRunning, samplerStatus?.running ?? false),
    lastSamplerTickCompletedAtMs:
      safeNullableNumber(raw.lastSamplerTickCompletedAtMs) ??
      samplerStatus?.lastTickCompletedAtMs ??
      null,
    lastEligibleOpenPreviewSession: normalizeTfAutoTrackerV2DevPersistedOpenPreviewSession(
      raw.lastEligibleOpenPreviewSession,
    ),
    recoveryStatus: normalizeTfAutoTrackerV2DevRecoveryStatus(raw.recoveryStatus),
    lastRecoveryMessage: safeNullableString(raw.lastRecoveryMessage),
  };
}

function hasTfAutoTrackerV2DevPersistedStateData(
  state: TfAutoTrackerV2DevPersistedState,
): boolean {
  return (
    state.events.length > 0 ||
    state.writtenPreviewSessionIds.length > 0 ||
    state.samplerStatus !== null ||
    state.continuousWriteStatus !== null ||
    state.lastSamplerRunning ||
    state.lastSamplerTickCompletedAtMs !== null ||
    state.lastEligibleOpenPreviewSession !== null ||
    state.recoveryStatus !== "noEligibleSession" ||
    state.lastRecoveryMessage !== null
  );
}

export function loadTfAutoTrackerV2DevPersistedState(): TfAutoTrackerV2DevPersistedState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(TF_AUTOTRACKER_V2_DEV_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeTfAutoTrackerV2DevPersistedState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveTfAutoTrackerV2DevPersistedState(
  state: TfAutoTrackerV2DevPersistedState,
): TfAutoTrackerV2DevPersistedState | null {
  const normalized = normalizeTfAutoTrackerV2DevPersistedState(state);
  if (typeof window === "undefined" || normalized === null) {
    return normalized;
  }

  if (!hasTfAutoTrackerV2DevPersistedStateData(normalized)) {
    window.localStorage.removeItem(TF_AUTOTRACKER_V2_DEV_STATE_STORAGE_KEY);
    return null;
  }

  window.localStorage.setItem(
    TF_AUTOTRACKER_V2_DEV_STATE_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

export function clearTfAutoTrackerV2DevPersistedState(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(TF_AUTOTRACKER_V2_DEV_STATE_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Browser / localStorage persistence
// ---------------------------------------------------------------------------

function isNativeTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";
}

function loadTfStateFromLocalStorage(): TfAppState {
  try {
    const raw = window.localStorage.getItem(TF_STORAGE_KEY);
    if (!raw) return getEmptyTfAppState();
    const parsed: unknown = JSON.parse(raw);
    return normalizeTfAppState(parsed);
  } catch {
    return getEmptyTfAppState();
  }
}

function saveTfStateToLocalStorage(state: TfAppState): TfAppState {
  const normalized = normalizeTfAppState(state);
  window.localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function resetTfStateToLocalStorage(): TfAppState {
  const empty = getEmptyTfAppState();
  window.localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(empty));
  return empty;
}

export async function loadTfState(): Promise<TfAppState> {
  if (isNativeTauriRuntime()) {
    try {
      const nativeState = await loadNativeTfState();
      const normalized = normalizeTfAppState(nativeState);
      saveTfStateToLocalStorage(normalized);
      return normalized;
    } catch {
      return loadTfStateFromLocalStorage();
    }
  }

  return loadTfStateFromLocalStorage();
}

export async function saveTfState(state: TfAppState): Promise<TfAppState> {
  if (isNativeTauriRuntime()) {
    try {
      const nativeState = await saveNativeTfState(state);
      const normalized = normalizeTfAppState(nativeState);
      saveTfStateToLocalStorage(normalized);
      return normalized;
    } catch {
      return saveTfStateToLocalStorage(state);
    }
  }

  return saveTfStateToLocalStorage(state);
}

export async function resetTfState(): Promise<TfAppState> {
  const empty = getEmptyTfAppState();

  if (isNativeTauriRuntime()) {
    try {
      const nativeState = await resetNativeTfState();
      const normalized = normalizeTfAppState(nativeState);
      saveTfStateToLocalStorage(normalized);
      return normalized;
    } catch {
      try {
        const savedEmpty = await saveNativeTfState(empty);
        const normalized = normalizeTfAppState(savedEmpty);
        saveTfStateToLocalStorage(normalized);
        return normalized;
      } catch {
        return resetTfStateToLocalStorage();
      }
    }
  }

  return resetTfStateToLocalStorage();
}

// ---------------------------------------------------------------------------
// Session helpers (pure)
// ---------------------------------------------------------------------------

function sortSessionsNewestFirst(sessions: TfSessionLog[]): TfSessionLog[] {
  return [...sessions].sort((a, b) => {
    const ka = a.startISO || a.date;
    const kb = b.startISO || b.date;
    return kb.localeCompare(ka);
  });
}

export function upsertTfSessionLog(state: TfAppState, session: TfSessionLog): TfAppState {
  const existing = state.sessionLogs.findIndex((s) => s.id === session.id);
  const updated =
    existing >= 0
      ? state.sessionLogs.map((s, i) => (i === existing ? session : s))
      : [...state.sessionLogs, session];
  return normalizeTfAppState({
    ...state,
    sessionLogs: sortSessionsNewestFirst(updated),
  });
}

export function deleteTfSessionLog(state: TfAppState, id: string): TfAppState {
  return normalizeTfAppState({
    ...state,
    sessionLogs: state.sessionLogs.filter((s) => s.id !== id),
  });
}
