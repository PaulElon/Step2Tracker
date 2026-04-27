import type {
  TfAppState,
  TfSessionLog,
  TfSummaryPayload,
  TfTrackerPrefs,
  TfAccountState,
} from "../types/models";

export const TF_STATE_VERSION = 1;
export const TF_STORAGE_KEY = "timefolio-tracker:state";

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
    customAutoApps: safeStringArray(p.customAutoApps),
    customAutoWebsites: safeStringArray(p.customAutoWebsites),
    customDistractionApps: safeStringArray(p.customDistractionApps),
    customDistractionWebsites: safeStringArray(p.customDistractionWebsites),
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

// ---------------------------------------------------------------------------
// Browser / localStorage persistence
// ---------------------------------------------------------------------------

export async function loadTfState(): Promise<TfAppState> {
  try {
    const raw = window.localStorage.getItem(TF_STORAGE_KEY);
    if (!raw) return getEmptyTfAppState();
    const parsed: unknown = JSON.parse(raw);
    return normalizeTfAppState(parsed);
  } catch {
    return getEmptyTfAppState();
  }
}

export async function saveTfState(state: TfAppState): Promise<TfAppState> {
  const normalized = normalizeTfAppState(state);
  window.localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function resetTfState(): Promise<TfAppState> {
  const empty = getEmptyTfAppState();
  window.localStorage.setItem(TF_STORAGE_KEY, JSON.stringify(empty));
  return empty;
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
