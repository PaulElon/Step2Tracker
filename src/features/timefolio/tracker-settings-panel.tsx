import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  probeNativeAutoTrackerBootstrap,
  type NativeAutoTrackerBootstrapProbe,
} from "../../lib/native-persistence";
import { FF } from "../../lib/feature-flags";
import {
  captureAutoTrackerV2NativeOnce,
  clearAutoTrackerV2NativeBuffer,
  probeAutoTrackerV2Native,
  snapshotAutoTrackerV2Native,
  type AutoTrackerV2NativeCaptureResult,
  type AutoTrackerV2NativeSnapshot,
  type AutoTrackerV2NativeStatus,
} from "../../lib/tf-autotracker-v2-native-events";
import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../lib/tf-autotracker-v2-preview-spans";
import { buildAutoTrackerV2ReducerPreview } from "../../lib/tf-autotracker-v2-reducer-preview";
import type { NativeTrackerSpanInput } from "../../lib/tf-native-span-reconciler";
import { normalizeTfAppState } from "../../lib/tf-storage";
import { useTimeFolioStore } from "../../state/tf-store";
import type { TfAppState, TfTrackerPrefs } from "../../types/models";

type TrackerListKey = keyof TfTrackerPrefs;
const RESET_CONFIRMATION_TOKEN = "RESET";

type PendingImportPreview = {
  fileName: string;
  nextState: TfAppState;
  sessionCount: number;
  summaryCount: number;
  trackerRuleCount: number;
  hasAccount: boolean;
};

const TRACKER_LISTS: Array<{
  key: TrackerListKey;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: "customAutoApps",
    title: "Auto-tracked apps",
    description: "Apps you want TimeFolio to treat as study or focus-friendly activity.",
    placeholder: "e.g. Notion",
  },
  {
    key: "customAutoWebsites",
    title: "Auto-tracked websites",
    description: "Websites you want to count as productive by default.",
    placeholder: "e.g. docs.example.com",
  },
  {
    key: "customDistractionApps",
    title: "Distraction apps",
    description: "Apps you want to flag as distractions in your local TimeFolio view.",
    placeholder: "e.g. Discord",
  },
  {
    key: "customDistractionWebsites",
    title: "Distraction websites",
    description: "Websites you want to classify as distractions.",
    placeholder: "e.g. youtube.com",
  },
];

function cloneTrackerPrefs(prefs: TfTrackerPrefs): TfTrackerPrefs {
  return {
    customAutoApps: [...prefs.customAutoApps],
    customAutoWebsites: [...prefs.customAutoWebsites],
    customDistractionApps: [...prefs.customDistractionApps],
    customDistractionWebsites: [...prefs.customDistractionWebsites],
  };
}

function getEmptyTrackerPrefs(): TfTrackerPrefs {
  return {
    customAutoApps: [],
    customAutoWebsites: [],
    customDistractionApps: [],
    customDistractionWebsites: [],
  };
}

function sanitizeItems(items: string[]): string[] {
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

function listsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => item === b[index]);
}

function countTrackerRules(prefs: TfTrackerPrefs): number {
  return (
    prefs.customAutoApps.length +
    prefs.customAutoWebsites.length +
    prefs.customDistractionApps.length +
    prefs.customDistractionWebsites.length
  );
}

function getAccountSummary(account: TfAppState["account"]): { value: string; detail: string } {
  if (!account) {
    return {
      value: "No account",
      detail: "TimeFolio data is local only.",
    };
  }

  const tier = account.planTier === "pro" ? "Pro" : "Free";
  const identity = account.username ?? account.email ?? account.userId ?? "linked account";
  const verification = account.emailVerified ? "verified email" : "email not verified";

  return {
    value: "Connected",
    detail: `${tier} account · ${verification} · ${identity}`,
  };
}

function formatBackupDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA").format(date);
}

function getBackupFileName(date = new Date()): string {
  return `timefolio-tracker-backup-${formatBackupDate(date)}.json`;
}

function cloneTfStateSnapshot(state: TfAppState): TfAppState {
  return normalizeTfAppState(state);
}

function isLikelyTfBackupPayload(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  const raw = payload as Record<string, unknown>;
  return (
    "tfVersion" in raw ||
    "sessionLogs" in raw ||
    "summaries" in raw ||
    "trackerPrefs" in raw ||
    "account" in raw
  );
}

function buildImportPreview(fileName: string, input: unknown): PendingImportPreview {
  const nextState = normalizeTfAppState(input);
  return {
    fileName,
    nextState,
    sessionCount: nextState.sessionLogs.length,
    summaryCount: nextState.summaries.length,
    trackerRuleCount: countTrackerRules(nextState.trackerPrefs),
    hasAccount: nextState.account !== null,
  };
}

function formatStatusValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function formatLastChecked(value: string | null | undefined): string {
  if (!value) {
    return "Not checked yet";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

async function getLatestAutoTrackerSpansPlaceholder(): Promise<NativeTrackerSpanInput[]> {
  return [];
}

function DataStatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-400">{detail}</div>
    </div>
  );
}

function PanelStatus({
  tone,
  title,
  message,
  actionLabel,
  onAction,
}: {
  tone: "loading" | "error";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const wrapper =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
      : "border-slate-700 bg-slate-900/80 text-slate-100";

  return (
    <div className="p-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">{message}</p>
          </div>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700/80"
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
        <div className={`rounded-xl border px-4 py-3 text-sm ${wrapper}`}>
          {tone === "loading" ? "Loading local TimeFolio tracker preferences…" : "Unable to load tracker preferences from the local store."}
        </div>
      </div>
    </div>
  );
}

function TrackerListCard({
  title,
  description,
  placeholder,
  items,
  onItemsChange,
  onSave,
  isSaving,
  isDisabled,
  isDirty,
}: {
  title: string;
  description: string;
  placeholder: string;
  items: string[];
  onItemsChange: (nextItems: string[]) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDisabled: boolean;
  isDirty: boolean;
}) {
  const [newItem, setNewItem] = useState("");

  function addItem() {
    const value = newItem.trim();
    if (!value) {
      return;
    }
    onItemsChange([...items, value]);
    setNewItem("");
  }

  function updateItem(index: number, value: string) {
    const next = [...items];
    next[index] = value;
    onItemsChange(next);
  }

  function removeItem(index: number) {
    onItemsChange(items.filter((_, currentIndex) => currentIndex !== index));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem();
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/70 p-5 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-5 text-sm text-slate-500">
          No items yet. Add the first entry below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item, index) => (
            <div key={`${title}-${index}-${item}`} className="flex gap-2">
              <input
                type="text"
                value={item}
                onChange={(event) => updateItem(index, event.target.value)}
                disabled={isSaving || isDisabled}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={isSaving || isDisabled}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-60"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={newItem}
          onChange={(event) => setNewItem(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving || isDisabled}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={addItem}
          disabled={isSaving || isDisabled || newItem.trim().length === 0}
          className="rounded-lg border border-indigo-500/40 bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add item
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-slate-500">
          {isDirty ? "Unsaved local edits" : "Up to date with TimeFolio store"}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || isDisabled || !isDirty}
          className="rounded-lg border border-slate-700 bg-slate-800/90 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </section>
  );
}

export function TrackerSettingsPanel() {
  const { state, isLoading, error, reload, reset, saveState, importNativeSpans } = useTimeFolioStore();
  const [draftPrefs, setDraftPrefs] = useState<TfTrackerPrefs>(() => cloneTrackerPrefs(state.trackerPrefs));
  const [savingKey, setSavingKey] = useState<TrackerListKey | null>(null);
  const [dataMessage, setDataMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [isDataBusy, setIsDataBusy] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [resetConfirmationToken, setResetConfirmationToken] = useState("");
  const [pendingImportPreview, setPendingImportPreview] = useState<PendingImportPreview | null>(null);
  const [rollbackSnapshot, setRollbackSnapshot] = useState<TfAppState | null>(null);
  const [autoTrackerImportMessage, setAutoTrackerImportMessage] = useState<string | null>(null);
  const [isAutoTrackerImporting, setIsAutoTrackerImporting] = useState(false);
  const [autoTrackerStatus, setAutoTrackerStatus] = useState<NativeAutoTrackerBootstrapProbe | null>(null);
  const [isAutoTrackerRefreshing, setIsAutoTrackerRefreshing] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // V2 native inspector state (shadow/diagnostic only — never wired to reducer)
  const [v2ProbeStatus, setV2ProbeStatus] = useState<AutoTrackerV2NativeStatus | null>(null);
  const [v2Snapshot, setV2Snapshot] = useState<AutoTrackerV2NativeSnapshot | null>(null);
  const [v2InspectorError, setV2InspectorError] = useState<string | null>(null);
  const [v2IsBusy, setV2IsBusy] = useState(false);
  const [v2DelayCountdown, setV2DelayCountdown] = useState<number | null>(null);
  const [v2IsSampling, setV2IsSampling] = useState(false);
  const [v2SamplingSecondsLeft, setV2SamplingSecondsLeft] = useState<number | null>(null);
  const [v2LastCaptureInfo, setV2LastCaptureInfo] = useState<{
    appendedCount: number;
    captureErrors: string[];
    capturedAtMs: number;
  } | null>(null);

  const v2DelayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const v2SamplingCaptureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const v2SamplingCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDraftPrefs(cloneTrackerPrefs(state.trackerPrefs));
  }, [state.trackerPrefs]);

  useEffect(() => {
    void handleRefreshAutoTrackerStatus();
  }, []);

  useEffect(() => {
    return () => {
      if (v2DelayIntervalRef.current !== null) {
        clearInterval(v2DelayIntervalRef.current);
      }
      if (v2SamplingCaptureIntervalRef.current !== null) {
        clearInterval(v2SamplingCaptureIntervalRef.current);
      }
      if (v2SamplingCountdownIntervalRef.current !== null) {
        clearInterval(v2SamplingCountdownIntervalRef.current);
      }
    };
  }, []);

  if (isLoading) {
    return (
      <PanelStatus
        tone="loading"
        title="Tracker Settings"
        message="Manage the local app and website labels that TimeFolio uses for tracking."
      />
    );
  }

  if (error && dataMessage?.tone !== "error") {
    return (
      <PanelStatus
        tone="error"
        title="Tracker Settings"
        message={error}
        actionLabel="Retry"
        onAction={reload}
      />
    );
  }

  async function handleSave(key: TrackerListKey) {
    const nextTrackerPrefs = {
      ...draftPrefs,
      [key]: sanitizeItems(draftPrefs[key]),
    } as TfTrackerPrefs;

    setSavingKey(key);
    try {
      await saveState({
        ...state,
        trackerPrefs: nextTrackerPrefs,
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function handleExportData() {
    const fileName = getBackupFileName();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);

    setDataMessage({ tone: "success", text: `Downloaded ${fileName}.` });
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setDataMessage(null);
    setPendingImportPreview(null);

    try {
      const text = await file.text();
      const parsedState = JSON.parse(text) as unknown;
      if (!isLikelyTfBackupPayload(parsedState)) {
        throw new Error(
          "Invalid TimeFolio backup format. Expected an object with TimeFolio state fields (sessionLogs, summaries, trackerPrefs, or account)."
        );
      }
      const preview = buildImportPreview(file.name, parsedState);
      setPendingImportPreview(preview);
    } catch (err) {
      setDataMessage({
        tone: "error",
        text: err instanceof Error && err.message ? err.message : "Unable to import the selected TimeFolio backup.",
      });
    }
  }

  async function handleConfirmImportData() {
    if (!pendingImportPreview) {
      return;
    }

    const snapshot = cloneTfStateSnapshot(state);
    setDataMessage(null);
    setIsDataBusy(true);

    try {
      await saveState(pendingImportPreview.nextState);
      setRollbackSnapshot(snapshot);
      setPendingImportPreview(null);
      setDataMessage({ tone: "success", text: "TimeFolio data imported." });
    } catch (err) {
      setDataMessage({
        tone: "error",
        text: err instanceof Error && err.message ? err.message : "Unable to import the selected TimeFolio backup.",
      });
    } finally {
      setIsDataBusy(false);
    }
  }

  function handleCancelImportData() {
    if (isDataBusy) {
      return;
    }
    setPendingImportPreview(null);
  }

  function handleResetData() {
    setDataMessage(null);
    setResetConfirmationToken("");
    setIsConfirmingReset(true);
  }

  function handleCancelResetData() {
    if (isDataBusy) {
      return;
    }

    setResetConfirmationToken("");
    setIsConfirmingReset(false);
  }

  function handleResetConfirmationKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    if (resetConfirmationToken === RESET_CONFIRMATION_TOKEN && !isDataBusy) {
      void handleConfirmResetData();
    }
  }

  async function handleConfirmResetData() {
    if (resetConfirmationToken !== RESET_CONFIRMATION_TOKEN) {
      setDataMessage({
        tone: "error",
        text: `Type ${RESET_CONFIRMATION_TOKEN} to confirm reset.`,
      });
      return;
    }

    const snapshot = cloneTfStateSnapshot(state);
    setDataMessage(null);
    setIsDataBusy(true);

    try {
      await reset();
      setRollbackSnapshot(snapshot);
      setDraftPrefs(getEmptyTrackerPrefs());
      setDataMessage({ tone: "success", text: "TimeFolio data reset." });
    } catch (err) {
      setDataMessage({
        tone: "error",
        text: err instanceof Error && err.message ? err.message : "Unable to reset TimeFolio data.",
      });
    } finally {
      setIsDataBusy(false);
      setResetConfirmationToken("");
      setIsConfirmingReset(false);
    }
  }

  async function handleRestorePreviousState() {
    if (!rollbackSnapshot) {
      return;
    }

    setDataMessage(null);
    setIsDataBusy(true);
    try {
      await saveState(rollbackSnapshot);
      setRollbackSnapshot(null);
      setPendingImportPreview(null);
      setResetConfirmationToken("");
      setIsConfirmingReset(false);
      setDataMessage({ tone: "success", text: "Previous TimeFolio state restored." });
    } catch (err) {
      setDataMessage({
        tone: "error",
        text: err instanceof Error && err.message ? err.message : "Unable to restore the previous TimeFolio state.",
      });
    } finally {
      setIsDataBusy(false);
    }
  }

  function recordCaptureInfo(result: AutoTrackerV2NativeCaptureResult) {
    const captureErrors = result.appended
      .filter((e) => e.kind === "error" && e.error)
      .map((e) => e.error as string);
    setV2LastCaptureInfo({
      appendedCount: result.appended.length,
      captureErrors,
      capturedAtMs: Date.now(),
    });
  }

  async function handleV2Probe() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const status = await probeAutoTrackerV2Native();
      setV2ProbeStatus(status);
    } catch (err) {
      setV2InspectorError(err instanceof Error && err.message ? err.message : "Probe failed.");
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2RefreshSnapshot() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const snap = await snapshotAutoTrackerV2Native();
      setV2Snapshot(snap);
      setV2ProbeStatus(snap.status);
    } catch (err) {
      setV2InspectorError(err instanceof Error && err.message ? err.message : "Snapshot failed.");
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2CaptureOnce() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const result: AutoTrackerV2NativeCaptureResult = await captureAutoTrackerV2NativeOnce();
      setV2ProbeStatus(result.status);
      recordCaptureInfo(result);
      const snap = await snapshotAutoTrackerV2Native();
      setV2Snapshot(snap);
      setV2ProbeStatus(snap.status);
    } catch (err) {
      setV2InspectorError(err instanceof Error && err.message ? err.message : "Capture failed.");
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2ClearBuffer() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const status = await clearAutoTrackerV2NativeBuffer();
      setV2ProbeStatus(status);
      setV2Snapshot((prev: AutoTrackerV2NativeSnapshot | null) =>
        prev ? { ...prev, status, events: [] } : null,
      );
      setV2LastCaptureInfo(null);
    } catch (err) {
      setV2InspectorError(
        err instanceof Error && err.message ? err.message : "Clear buffer failed.",
      );
    } finally {
      setV2IsBusy(false);
    }
  }

  function handleV2CaptureDelayed() {
    if (v2DelayIntervalRef.current !== null) {
      return;
    }
    setV2InspectorError(null);
    setV2DelayCountdown(5);
    let remaining = 5;
    v2DelayIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (v2DelayIntervalRef.current !== null) {
          clearInterval(v2DelayIntervalRef.current);
          v2DelayIntervalRef.current = null;
        }
        setV2DelayCountdown(null);
        setV2IsBusy(true);
        captureAutoTrackerV2NativeOnce()
          .then((result) => {
            setV2ProbeStatus(result.status);
            recordCaptureInfo(result);
            return snapshotAutoTrackerV2Native();
          })
          .then((snap) => {
            setV2Snapshot(snap);
            setV2ProbeStatus(snap.status);
          })
          .catch((err: unknown) => {
            setV2InspectorError(
              err instanceof Error && err.message ? err.message : "Delayed capture failed.",
            );
          })
          .finally(() => {
            setV2IsBusy(false);
          });
      } else {
        setV2DelayCountdown(remaining);
      }
    }, 1000);
  }

  function handleV2StopSampling() {
    if (v2SamplingCaptureIntervalRef.current !== null) {
      clearInterval(v2SamplingCaptureIntervalRef.current);
      v2SamplingCaptureIntervalRef.current = null;
    }
    if (v2SamplingCountdownIntervalRef.current !== null) {
      clearInterval(v2SamplingCountdownIntervalRef.current);
      v2SamplingCountdownIntervalRef.current = null;
    }
    setV2IsSampling(false);
    setV2SamplingSecondsLeft(null);
    snapshotAutoTrackerV2Native()
      .then((snap) => {
        setV2Snapshot(snap);
        setV2ProbeStatus(snap.status);
      })
      .catch((err: unknown) => {
        setV2InspectorError(
          err instanceof Error && err.message ? err.message : "Snapshot after sampling failed.",
        );
      });
  }

  function handleV2StartSampling() {
    setV2InspectorError(null);
    setV2IsSampling(true);
    let secondsLeft = 30;
    setV2SamplingSecondsLeft(secondsLeft);

    v2SamplingCaptureIntervalRef.current = setInterval(() => {
      captureAutoTrackerV2NativeOnce()
        .then((result) => {
          setV2ProbeStatus(result.status);
          recordCaptureInfo(result);
        })
        .catch((err: unknown) => {
          setV2InspectorError(
            err instanceof Error && err.message ? err.message : "Sampling capture failed.",
          );
        });
    }, 2000);

    v2SamplingCountdownIntervalRef.current = setInterval(() => {
      secondsLeft -= 1;
      setV2SamplingSecondsLeft(secondsLeft);
      if (secondsLeft <= 0) {
        handleV2StopSampling();
      }
    }, 1000);
  }

  async function handleRefreshAutoTrackerStatus() {
    setIsAutoTrackerRefreshing(true);
    try {
      const status = await probeNativeAutoTrackerBootstrap();
      setAutoTrackerStatus(status);
    } catch (err) {
      setAutoTrackerStatus({
        detected: false,
        installed: false,
        paired: false,
        platform: null,
        streamPort: null,
        basePath: null,
        appVersion: null,
        deviceId: null,
        pendingUserCode: null,
        pendingVerificationUrl: null,
        pendingTransferDeviceId: null,
        pendingReplaceDeviceId: null,
        lastPairingError: null,
        accessibility: null,
        browserAutomation: null,
        closedSpanCount: 0,
        hasOpenSpan: false,
        lastCheckedISO: new Date().toISOString(),
        error: err instanceof Error && err.message ? err.message : "Unable to probe Auto-Tracker status.",
      });
    } finally {
      setIsAutoTrackerRefreshing(false);
    }
  }

  async function handleImportLatestAutoTrackerSpans() {
    setAutoTrackerImportMessage(null);
    setIsAutoTrackerImporting(true);
    try {
      const spans = await getLatestAutoTrackerSpansPlaceholder();
      await importNativeSpans(spans);
      setAutoTrackerImportMessage(
        "No Auto-Tracker ingestion is connected yet. No spans were imported. Future ingestion will need an explicit later implementation."
      );
    } catch (err) {
      setAutoTrackerImportMessage(
        err instanceof Error && err.message ? err.message : "Unable to import auto-tracker spans."
      );
    } finally {
      setIsAutoTrackerImporting(false);
    }
  }

  const accountSummary = getAccountSummary(state.account);
  const trackerRuleCount = countTrackerRules(state.trackerPrefs);
  const sessionCount = state.sessionLogs.length;
  const summaryCount = state.summaries.length;
  const canConfirmReset = resetConfirmationToken === RESET_CONFIRMATION_TOKEN;

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 shadow-lg shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-300">
              Local only
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">Tracker Settings</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Manage the app and website labels that TimeFolio stores on this device for tracker classification.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-xs leading-5 text-slate-400">
            Changes are saved into the TimeFolio store state only.
          </div>
        </div>
      </div>

      <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/15">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
              TimeFolio data
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Backup, import, or reset local TimeFolio data</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                These controls only touch the quarantined TimeFolio store used by tracker settings.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataStatCard
            label="Session count"
            value={String(sessionCount)}
            detail="Tracked session logs stored in TimeFolio."
          />
          <DataStatCard
            label="Summary count"
            value={String(summaryCount)}
            detail="Generated summary cards available locally."
          />
          <DataStatCard
            label="Tracker rule count"
            value={String(trackerRuleCount)}
            detail="All auto-track and distraction rules combined."
          />
          <DataStatCard label="Account status" value={accountSummary.value} detail={accountSummary.detail} />
        </div>

        {dataMessage ? (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              dataMessage.tone === "error"
                ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {dataMessage.text}
          </div>
        ) : null}

        {rollbackSnapshot ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <div>A rollback snapshot is available for this session.</div>
            <button
              type="button"
              onClick={handleRestorePreviousState}
              disabled={isDataBusy}
              className="rounded-lg border border-amber-400/30 bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Restore previous TimeFolio state
            </button>
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
            <div className="text-sm font-medium text-slate-100">Import JSON</div>
            <p className="text-xs leading-5 text-slate-400">
              Select a `.json` backup to replace only the TimeFolio store state. Existing study storage is untouched.
            </p>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFileChange}
              disabled={isDataBusy}
              className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 file:mr-4 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {pendingImportPreview ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-300">
                <div className="font-medium text-slate-100">Ready to import: {pendingImportPreview.fileName}</div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  <div>Session count: {pendingImportPreview.sessionCount}</div>
                  <div>Summary count: {pendingImportPreview.summaryCount}</div>
                  <div>Tracker rule count: {pendingImportPreview.trackerRuleCount}</div>
                  <div>Account: {pendingImportPreview.hasAccount ? "present" : "absent"}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmImportData}
                    disabled={isDataBusy}
                    className="rounded-lg border border-cyan-500/30 bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Confirm import
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelImportData}
                    disabled={isDataBusy}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleExportData}
              disabled={isDataBusy}
              className="rounded-lg border border-cyan-500/30 bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleResetData}
              disabled={isDataBusy}
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset TimeFolio Data
            </button>
            {isConfirmingReset ? (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                <p className="font-medium">This clears only TimeFolio data. Study Tracker data is untouched.</p>
                <p className="mt-2 text-xs text-rose-100/90">
                  This action is irreversible once confirmed. Type {RESET_CONFIRMATION_TOKEN} to continue.
                </p>
                <input
                  type="text"
                  value={resetConfirmationToken}
                  onChange={(event) => setResetConfirmationToken(event.target.value)}
                  onKeyDown={handleResetConfirmationKeyDown}
                  disabled={isDataBusy}
                  placeholder={`Type ${RESET_CONFIRMATION_TOKEN}`}
                  className="mt-3 block w-full rounded-lg border border-rose-400/40 bg-rose-950/20 px-3 py-2 text-sm text-rose-100 placeholder:text-rose-200/70 outline-none transition-colors focus:border-rose-300 focus:ring-2 focus:ring-rose-400/30 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmResetData}
                    disabled={isDataBusy || !canConfirmReset}
                    className="rounded-lg border border-rose-400/40 bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Confirm reset
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelResetData}
                    disabled={isDataBusy}
                    className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/15">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="inline-flex w-fit rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-teal-300">
              Read-only
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Auto-Tracker Status</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                Read-only scaffold/placeholder for Auto-Tracker status. This card does not perform live ingestion or write any data.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleRefreshAutoTrackerStatus}
              disabled={isAutoTrackerRefreshing}
              className="rounded-lg border border-teal-500/30 bg-teal-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAutoTrackerRefreshing ? "Refreshing…" : "Refresh status"}
            </button>
            <button
              type="button"
              onClick={handleImportLatestAutoTrackerSpans}
              disabled={isAutoTrackerImporting}
              className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAutoTrackerImporting ? "Previewing…" : "Preview placeholder auto-tracker import"}
            </button>
          </div>
        </div>

        {autoTrackerImportMessage ? (
          <div className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
            {autoTrackerImportMessage}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataStatCard
            label="Tracker service"
            value={autoTrackerStatus?.detected ? "Detected" : "Offline"}
            detail={autoTrackerStatus?.error ? autoTrackerStatus.error : "Bootstrap endpoint probe result."}
          />
          <DataStatCard
            label="Installed"
            value={formatStatusValue(autoTrackerStatus?.installed)}
            detail="Auto-Tracker installation state."
          />
          <DataStatCard label="Paired" value={formatStatusValue(autoTrackerStatus?.paired)} detail="Device pairing state." />
          <DataStatCard
            label="Platform"
            value={formatStatusValue(autoTrackerStatus?.platform)}
            detail={`Stream port: ${formatStatusValue(autoTrackerStatus?.streamPort)}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DataStatCard
            label="Version"
            value={formatStatusValue(autoTrackerStatus?.appVersion)}
            detail={`Device ID: ${formatStatusValue(autoTrackerStatus?.deviceId)}`}
          />
          <DataStatCard
            label="Accessibility"
            value={formatStatusValue(autoTrackerStatus?.accessibility)}
            detail={`Browser automation: ${formatStatusValue(autoTrackerStatus?.browserAutomation)}`}
          />
          <DataStatCard
            label="Span state"
            value={`${autoTrackerStatus?.closedSpanCount ?? 0} closed`}
            detail={`Open span: ${formatStatusValue(autoTrackerStatus?.hasOpenSpan)}`}
          />
        </div>

        {autoTrackerStatus?.pendingUserCode ||
        autoTrackerStatus?.pendingVerificationUrl ||
        autoTrackerStatus?.pendingTransferDeviceId ||
        autoTrackerStatus?.pendingReplaceDeviceId ||
        autoTrackerStatus?.lastPairingError ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {autoTrackerStatus?.pendingUserCode ? (
              <DataStatCard
                label="Pending user code"
                value={autoTrackerStatus.pendingUserCode}
                detail="Complete pairing with this user code."
              />
            ) : null}
            {autoTrackerStatus?.pendingVerificationUrl ? (
              <DataStatCard
                label="Verification URL"
                value={autoTrackerStatus.pendingVerificationUrl}
                detail="Pending browser verification URL."
              />
            ) : null}
            {autoTrackerStatus?.pendingTransferDeviceId ? (
              <DataStatCard
                label="Transfer device"
                value={autoTrackerStatus.pendingTransferDeviceId}
                detail="Pending transfer target device ID."
              />
            ) : null}
            {autoTrackerStatus?.pendingReplaceDeviceId ? (
              <DataStatCard
                label="Replace device"
                value={autoTrackerStatus.pendingReplaceDeviceId}
                detail="Pending replacement device ID."
              />
            ) : null}
            {autoTrackerStatus?.lastPairingError ? (
              <DataStatCard
                label="Last pairing error"
                value={autoTrackerStatus.lastPairingError}
                detail="Most recent pairing error from bootstrap."
              />
            ) : null}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
          Last checked: {formatLastChecked(autoTrackerStatus?.lastCheckedISO)}
          {autoTrackerStatus?.basePath ? ` · Base path: ${autoTrackerStatus.basePath}` : ""}
        </div>
      </section>

      {FF.autotrackerV2NativeInspector ? (() => {
        const lastAppEvent = v2Snapshot
          ? [...v2Snapshot.events]
              .reverse()
              .find((e) => (e.kind === "targetFocused" || e.kind === "untrackedFocused") && e.appName)
          : undefined;

        const isDelayPending = v2DelayCountdown !== null;
        const anyBusy = v2IsBusy || isDelayPending;
        const classificationSettings: TfAutotrackerV2ClassificationSettings = {
          autoApps: state.trackerPrefs.customAutoApps,
          autoWebsites: state.trackerPrefs.customAutoWebsites,
          distractionApps: state.trackerPrefs.customDistractionApps,
          distractionWebsites: state.trackerPrefs.customDistractionWebsites,
        };
        const previewSpans = buildAutoTrackerV2PreviewSpans(v2Snapshot?.events ?? [], classificationSettings);
        const reducerPreview = buildAutoTrackerV2ReducerPreview(previewSpans);
        const reducerPreviewActiveTarget =
          reducerPreview.state.status === "focused"
            ? reducerPreview.state.target
            : reducerPreview.state.status === "awayPending"
              ? reducerPreview.state.session.target
              : reducerPreview.state.status === "recoverableOpen"
                ? reducerPreview.state.session.target
                : null;

        return (
          <section className="flex flex-col gap-5 rounded-2xl border border-violet-500/20 bg-slate-900/80 p-6 shadow-lg shadow-black/15">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="inline-flex w-fit rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-violet-300">
                  Shadow · Diagnostic only
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100">Auto-Tracker V2 Native Inspector</h3>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                    Read-only diagnostic view of the V2 native event buffer. Not wired to the reducer or session creation.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleV2Probe}
                  disabled={anyBusy || v2IsSampling}
                  className="rounded-lg border border-violet-500/30 bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {v2IsBusy ? "…" : "Probe"}
                </button>
                <button
                  type="button"
                  onClick={handleV2CaptureOnce}
                  disabled={anyBusy || v2IsSampling}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Capture once
                </button>
                <button
                  type="button"
                  onClick={handleV2CaptureDelayed}
                  disabled={isDelayPending || v2IsBusy || v2IsSampling}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDelayPending ? `Capturing in ${v2DelayCountdown}s… switch now` : "Capture in 5s"}
                </button>
                <button
                  type="button"
                  onClick={v2IsSampling ? handleV2StopSampling : handleV2StartSampling}
                  disabled={anyBusy}
                  className={
                    v2IsSampling
                      ? "rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      : "rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  }
                >
                  {v2IsSampling
                    ? `Stop sampling (${v2SamplingSecondsLeft ?? 0}s left)`
                    : "Sample 30s"}
                </button>
                <button
                  type="button"
                  onClick={handleV2RefreshSnapshot}
                  disabled={anyBusy || v2IsSampling}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refresh snapshot
                </button>
                <button
                  type="button"
                  onClick={handleV2ClearBuffer}
                  disabled={anyBusy || v2IsSampling}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear buffer
                </button>
              </div>
            </div>

            {v2InspectorError ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {v2InspectorError}
              </div>
            ) : null}

            {v2LastCaptureInfo ? (
              <div
                className={`rounded-xl border px-4 py-3 text-xs ${
                  v2LastCaptureInfo.captureErrors.length > 0
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                <span className="font-medium">
                  Last capture: {v2LastCaptureInfo.appendedCount} event
                  {v2LastCaptureInfo.appendedCount !== 1 ? "s" : ""} appended
                </span>
                {v2LastCaptureInfo.captureErrors.length > 0 ? (
                  <span className="ml-2 text-amber-200">
                    · Probe errors: {v2LastCaptureInfo.captureErrors.join(" · ")}
                  </span>
                ) : null}
                <span className="ml-2 text-current opacity-60">
                  at{" "}
                  {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
                    new Date(v2LastCaptureInfo.capturedAtMs),
                  )}
                </span>
              </div>
            ) : null}

            {v2ProbeStatus ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DataStatCard
                  label="Native support"
                  value={v2ProbeStatus.supported ? "Supported" : "Unsupported"}
                  detail={v2ProbeStatus.note}
                />
                <DataStatCard
                  label="Probe capabilities"
                  value={
                    v2ProbeStatus.foregroundProbeAvailable && v2ProbeStatus.idleProbeAvailable
                      ? "Full"
                      : v2ProbeStatus.foregroundProbeAvailable
                        ? "Foreground only"
                        : "Unavailable"
                  }
                  detail={`Foreground detection: ${v2ProbeStatus.foregroundProbeAvailable ? "Available" : "Unavailable"} · Idle detection: ${v2ProbeStatus.idleProbeAvailable ? "Available" : "Unavailable"}`}
                />
                <DataStatCard
                  label="Buffer"
                  value={`${v2ProbeStatus.bufferLen} / ${v2ProbeStatus.bufferCapacity}`}
                  detail="Buffered events / capacity"
                />
                <DataStatCard
                  label="Last sampled"
                  value={
                    v2ProbeStatus.lastSampledAtMs
                      ? new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
                          new Date(v2ProbeStatus.lastSampledAtMs),
                        )
                      : "Never"
                  }
                  detail={`Platform: ${v2ProbeStatus.platform}`}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-5 text-sm text-slate-500">
                Click Probe or Capture once to load V2 native status.
              </div>
            )}

            <div className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Last detected app</div>
              {lastAppEvent ? (
                <div className="mt-1.5 flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-semibold text-slate-100">{lastAppEvent.appName}</span>
                    {lastAppEvent.bundleId ? (
                      <span className="font-mono text-xs text-slate-400">{lastAppEvent.bundleId}</span>
                    ) : null}
                    <span className="text-xs text-slate-500">
                      · {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(lastAppEvent.timestampMs))}
                    </span>
                  </div>
                  {lastAppEvent.browserTitle ? (
                    <div className="text-xs text-slate-200 truncate">{lastAppEvent.browserTitle}</div>
                  ) : null}
                  {lastAppEvent.browserUrl ? (
                    <div className="font-mono text-xs text-violet-300 truncate">{lastAppEvent.browserUrl}</div>
                  ) : null}
                  {lastAppEvent.browserTabError ? (
                    <div className="text-xs text-amber-300">tab read: {lastAppEvent.browserTabError}</div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-500">No app captured yet.</div>
              )}
            </div>

            {v2Snapshot && v2Snapshot.events.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Last {Math.min(v2Snapshot.events.length, 10)} of {v2Snapshot.events.length} buffered events
                </div>
                <div className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-950/50 overflow-hidden">
                  {v2Snapshot.events.slice(-10).map((ev) => (
                    <div key={ev.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
                      <span className="font-mono text-slate-500 tabular-nums shrink-0">
                        {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(ev.timestampMs))}
                      </span>
                      <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300 shrink-0">
                        {ev.kind}
                      </span>
                      {ev.appName ? (
                        <span className="text-slate-200 truncate">{ev.appName}</span>
                      ) : null}
                      {ev.bundleId ? (
                        <span className="font-mono text-slate-400 truncate">{ev.bundleId}</span>
                      ) : null}
                      {ev.isIdle !== undefined ? (
                        <span className={ev.isIdle ? "text-amber-300" : "text-emerald-300"}>
                          {ev.isIdle ? "idle" : "active"}
                        </span>
                      ) : null}
                      {ev.browserTitle ? (
                        <span className="text-slate-200 truncate">{ev.browserTitle}</span>
                      ) : null}
                      {ev.browserUrl ? (
                        <span className="font-mono text-violet-300 truncate">{ev.browserUrl}</span>
                      ) : null}
                      {ev.browserTabError ? (
                        <span className="text-amber-300 truncate">tab: {ev.browserTabError}</span>
                      ) : null}
                      {ev.error ? (
                        <span className="text-rose-300 truncate">{ev.error}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : v2Snapshot && v2Snapshot.events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-4 text-sm text-slate-500">
                Buffer is empty.
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Preview spans (read-only)
                </div>
                <span className="text-[10px] text-slate-600">Preview only — no sessions written.</span>
                <span className="text-[10px] text-slate-600">
                  Classification uses saved tracker rules. Click Save changes after editing rules.
                </span>
              </div>
              {previewSpans.length > 0 ? (() => {
                const trackedCount = previewSpans.filter((s) => s.classification === "tracked").length;
                const distractionCount = previewSpans.filter((s) => s.classification === "distraction").length;
                const unclassifiedCount = previewSpans.filter((s) => s.classification === "unclassified").length;
                return (
                  <div className="flex flex-wrap gap-3 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                    <span>
                      <span className="font-medium text-emerald-400">{trackedCount}</span>
                      {" tracked"}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>
                      <span className="font-medium text-rose-400">{distractionCount}</span>
                      {" distractions"}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>
                      <span className="font-medium text-slate-300">{unclassifiedCount}</span>
                      {" unclassified"}
                    </span>
                  </div>
                );
              })() : null}
              {previewSpans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-4 text-sm text-slate-500">
                  No preview spans yet.
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-950/50 overflow-hidden">
                  {previewSpans.slice(-5).map((span) => (
                    <div key={span.id} className="flex flex-col gap-0.5 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-slate-100 truncate">{span.label}</span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                            span.kind === "website"
                              ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
                              : "border-violet-500/20 bg-violet-500/10 text-violet-300"
                          }`}
                        >
                          {span.kind}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                            span.classification === "tracked"
                              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                              : span.classification === "distraction"
                                ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
                                : "border-slate-600 bg-slate-800 text-slate-400"
                          }`}
                        >
                          {span.classification}
                        </span>
                        {span.appName ? (
                          <span className="text-slate-400 truncate">{span.appName}</span>
                        ) : null}
                        {span.bundleId ? (
                          <span className="font-mono text-slate-500 truncate">{span.bundleId}</span>
                        ) : null}
                      </div>
                      <div className="text-slate-600 truncate">{span.classificationReason}</div>
                      {span.browserTitle ? (
                        <div className="text-slate-300 truncate">{span.browserTitle}</div>
                      ) : null}
                      {span.browserUrl ? (
                        <div className="font-mono text-violet-300 truncate">{span.browserUrl}</div>
                      ) : null}
                      <div className="flex gap-2 text-slate-500">
                        <span className="tabular-nums">
                          {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
                            new Date(span.startedAtMs),
                          )}
                        </span>
                        <span>·</span>
                        <span className={span.endedAtMs === null ? "font-medium text-emerald-400" : ""}>
                          {span.endedAtMs === null
                            ? "Open"
                            : `${Math.round(Math.max(0, span.durationMs ?? 0) / 1000)}s`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    Reducer preview (read-only)
                  </div>
                  <span className="text-[10px] text-slate-600">In-memory only — no sessions written.</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                  <span>
                    <span className="font-medium text-slate-200">State:</span>{" "}
                    <span className="text-emerald-300">{reducerPreview.state.status}</span>
                  </span>
                  {reducerPreviewActiveTarget ? (
                    <span className="truncate">
                      <span className="font-medium text-slate-200">Active target:</span>{" "}
                      <span className="text-slate-100">{reducerPreviewActiveTarget.label ?? reducerPreviewActiveTarget.stableId}</span>
                    </span>
                  ) : null}
                  <span>
                    <span className="font-medium text-slate-200">Finalized:</span>{" "}
                    <span className="text-slate-100">{reducerPreview.finalizedCount}</span>
                  </span>
                  <span>
                    <span className="font-medium text-slate-200">Ignored:</span>{" "}
                    <span className="text-slate-100">{reducerPreview.ignoredSpans.length}</span>
                  </span>
                </div>
                {reducerPreview.reducerEvents.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Last reducer events
                    </div>
                    <div className="flex flex-col divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
                      {reducerPreview.reducerEvents.slice(-4).map((event) => (
                        <div key={`${event.sourceSpanId}-${event.kind}-${event.timestampMs}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-xs">
                          <span className="font-mono tabular-nums text-slate-500">
                            {new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(
                              new Date(event.timestampMs),
                            )}
                          </span>
                          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">
                            {event.kind}
                          </span>
                          <span className="truncate text-slate-200">{event.label}</span>
                          <span className="font-mono text-slate-500">#{event.sourceSpanId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">No reducer events were generated.</div>
                )}
                {reducerPreview.ignoredSpans.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Ignored spans
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      {reducerPreview.ignoredSpans.slice(-4).map((span) => (
                        <span
                          key={span.spanId}
                          className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-1"
                        >
                          <span className="font-medium text-slate-200">{span.label}</span>
                          <span className="text-slate-500"> · </span>
                          <span className="text-slate-400">{span.reason}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })() : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {TRACKER_LISTS.map((config) => {
          const items = draftPrefs[config.key];
          const originalItems = state.trackerPrefs[config.key];
          const sanitizedDraft = sanitizeItems(items);
          const isDirty = !listsMatch(sanitizedDraft, sanitizeItems(originalItems));

          return (
            <TrackerListCard
              key={config.key}
              title={config.title}
              description={config.description}
              placeholder={config.placeholder}
              items={items}
              onItemsChange={(nextItems) =>
                setDraftPrefs((prev) => ({
                  ...prev,
                  [config.key]: nextItems,
                }))
              }
              onSave={() => handleSave(config.key)}
              isSaving={savingKey === config.key}
              isDisabled={isDataBusy}
              isDirty={isDirty}
            />
          );
        })}
      </div>
    </div>
  );
}
