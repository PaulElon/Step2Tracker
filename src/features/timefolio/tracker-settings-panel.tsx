import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Check, Globe, Monitor, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  probeNativeAutoTrackerBootstrap,
  type NativeAutoTrackerBootstrapProbe,
} from "../../lib/native-persistence";
import { FF } from "../../lib/feature-flags";
import {
  captureAutoTrackerV2NativeOnce,
  clearAutoTrackerV2NativeBuffer,
  clearAutoTrackerV2NativeRecovery,
  debugWriteAutoTrackerV2NativeRecoveryNow,
  getAutoTrackerV2NativeSamplerStatus,
  probeAutoTrackerV2Native,
  readAutoTrackerV2NativeRecovery,
  readAutoTrackerV2NativeRecoveryDiagnostics,
  snapshotAutoTrackerV2Native,
  startAutoTrackerV2NativeSampler,
  stopAutoTrackerV2NativeSampler,
  type AutoTrackerV2NativeCaptureResult,
  type AutoTrackerV2NativeRecoveryDiagnostics,
  type AutoTrackerV2NativeRecoveryDebugWriteResult,
  type AutoTrackerV2NativeSamplerStatus,
  type AutoTrackerV2NativeSnapshot,
  type AutoTrackerV2NativeStatus,
} from "../../lib/tf-autotracker-v2-native-events";
import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../lib/tf-autotracker-v2-preview-spans";
import { themeAwareWarmAccent } from "../../lib/ui";
import {
  assessAutoTrackerV2RecoveredPreviewSession,
  buildAutoTrackerV2ReducerPreview,
  deriveAutoTrackerV2RecoveryHydration,
  finalizeAutoTrackerV2RecoveredPreviewSession,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2RecoveredPreviewSession,
  selectAutoTrackerV2ContinuousWritePreviewSessions,
  selectAutoTrackerV2StopSavePreviewSessions,
  shouldStartAutoTrackerV2StartupRecoveryHydration,
  type TfAutotrackerV2FinalizedPreviewSession,
} from "../../lib/tf-autotracker-v2-reducer-preview";
import type { NativeTrackerSpanInput } from "../../lib/tf-native-span-reconciler";
import {
  TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION,
  TF_AUTOTRACKER_V2_DEV_WRITTEN_ID_LIMIT,
  clearTfAutoTrackerV2DevPersistedState,
  deriveTfTrackerRuleName,
  loadTfAutoTrackerV2DevPersistedState,
  normalizeTfAppState,
  saveTfAutoTrackerV2DevPersistedState,
} from "../../lib/tf-storage";
import { cn, fieldClassName, iconButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import { useTimeFolioStore } from "../../state/tf-store";
import type {
  TfAppState,
  TfAutoTrackerV2DevContinuousWriteStatus,
  TfAutoTrackerV2DevPersistedOpenPreviewSession,
  TfAutoTrackerV2DevRecoveryStatus,
  TfTrackerPrefs,
  TfTrackerRule,
  TfTrackerRuleKind,
  ThemeId,
} from "../../types/models";

type TrackerListKey = keyof TfTrackerPrefs;
type TrackerGroupKey = "allowed" | "distractions";
const RESET_CONFIRMATION_TOKEN = "RESET";

type PendingImportPreview = {
  fileName: string;
  nextState: TfAppState;
  sessionCount: number;
  summaryCount: number;
  trackerRuleCount: number;
  hasAccount: boolean;
};

const TRACKER_GROUPS: Array<{
  key: TrackerGroupKey;
  title: string;
  description: string;
  listKeys: Record<TfTrackerRuleKind, TrackerListKey>;
  namePlaceholder: string;
  targetPlaceholders: Record<TfTrackerRuleKind, string>;
}> = [
  {
    key: "allowed",
    title: "Allowed",
    description: "Resources TimeFolio should count as study/focus activity.",
    listKeys: {
      app: "customAutoApps",
      website: "customAutoWebsites",
    },
    namePlaceholder: "e.g. UWorld or Anki",
    targetPlaceholders: {
      app: "Anki.app",
      website: "https://apps.uworld.com",
    },
  },
  {
    key: "distractions",
    title: "Distractions",
    description: "Resources TimeFolio should flag as distractions.",
    listKeys: {
      app: "customDistractionApps",
      website: "customDistractionWebsites",
    },
    namePlaceholder: "e.g. Reddit or ChatGPT",
    targetPlaceholders: {
      app: "ChatGPT.app",
      website: "https://www.reddit.com",
    },
  },
];

function cloneTrackerPrefs(prefs: TfTrackerPrefs): TfTrackerPrefs {
  return {
    customAutoApps: prefs.customAutoApps.map((rule) => ({ ...rule })),
    customAutoWebsites: prefs.customAutoWebsites.map((rule) => ({ ...rule })),
    customDistractionApps: prefs.customDistractionApps.map((rule) => ({ ...rule })),
    customDistractionWebsites: prefs.customDistractionWebsites.map((rule) => ({ ...rule })),
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

function generateTrackerRuleId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tf-rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeTrackerRules(
  rules: TfTrackerRule[],
  kind: TfTrackerRuleKind,
): TfTrackerRule[] {
  return rules
    .map((rule) => {
      const target = rule.target.trim();
      if (!target) {
        return null;
      }

      return {
        id: rule.id.trim() || generateTrackerRuleId(),
        name: rule.name.trim() || deriveTfTrackerRuleName(target, kind),
        target,
        kind,
      };
    })
    .filter((rule): rule is TfTrackerRule => rule !== null);
}

function trackerRuleListsMatch(a: TfTrackerRule[], b: TfTrackerRule[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((rule, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      rule.id === other.id &&
      rule.name === other.name &&
      rule.target === other.target &&
      rule.kind === other.kind
    );
  });
}

function countTrackerRules(prefs: TfTrackerPrefs): number {
  return (
    prefs.customAutoApps.length +
    prefs.customAutoWebsites.length +
    prefs.customDistractionApps.length +
    prefs.customDistractionWebsites.length
  );
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

function formatPreviewDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatTimeOfDayFromMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(new Date(value));
}

function formatDateTimeFromMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTrackerRuleTargetDisplay(target: string, kind: TfTrackerRuleKind): string {
  const trimmed = target.trim();

  if (kind !== "app") {
    return trimmed;
  }

  if (!trimmed) {
    return "App target";
  }

  if (trimmed.includes("/") || trimmed.toLowerCase().endsWith(".app")) {
    return deriveTfTrackerRuleName(trimmed, "app");
  }

  if (/^[a-z0-9.-]+$/iu.test(trimmed) && trimmed.includes(".")) {
    return "App identifier";
  }

  return deriveTfTrackerRuleName(trimmed, "app");
}

function formatFileSize(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }

  return `${(kib / 1024).toFixed(1)} MB`;
}

function formatRecoveryStatus(status: TfAutoTrackerV2DevRecoveryStatus): string {
  switch (status) {
    case "recoverable":
      return "Recoverable";
    case "finalizable":
      return "Finalizable";
    case "finalized":
      return "Finalized";
    case "ignored":
      return "Ignored";
    case "noEligibleSession":
    default:
      return "No eligible session";
  }
}

function makeAutoTrackerV2PreviewSessionLogId(previewSessionId: string): string {
  const normalizedPreviewId =
    previewSessionId
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60) || "preview-session";
  const uniqueSuffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return `tf-auto-v2-preview-${normalizedPreviewId}-${uniqueSuffix}`;
}

function appendWrittenPreviewSessionId(
  current: Set<string>,
  previewSessionId: string,
): Set<string> {
  if (current.has(previewSessionId)) {
    return current;
  }

  const next = new Set(current);
  next.add(previewSessionId);

  while (next.size > TF_AUTOTRACKER_V2_DEV_WRITTEN_ID_LIMIT) {
    const oldest = next.values().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    next.delete(oldest);
  }

  return next;
}

function getLatestAutoTrackerSpansPlaceholder(): Promise<NativeTrackerSpanInput[]> {
  return Promise.resolve([]);
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
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
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

type TrackerRuleRow = {
  rule: TfTrackerRule;
  kind: TfTrackerRuleKind;
  listKey: TrackerListKey;
};

function RuleKindPill({ kind }: { kind: TfTrackerRuleKind }) {
  const isWebsite = kind === "website";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em]",
        isWebsite
          ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-200"
          : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
      )}
    >
      {isWebsite ? <Globe className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
      {isWebsite ? "Website" : "App"}
    </span>
  );
}

function TrackerGroupCard({
  title,
  description,
  listKeys,
  namePlaceholder,
  targetPlaceholders,
  rulesByKind,
  onRulesChange,
  onSave,
  isSaving,
  isDisabled,
  isDirty,
}: {
  title: string;
  description: string;
  listKeys: Record<TfTrackerRuleKind, TrackerListKey>;
  namePlaceholder: string;
  targetPlaceholders: Record<TfTrackerRuleKind, string>;
  rulesByKind: Record<TfTrackerRuleKind, TfTrackerRule[]>;
  onRulesChange: (kind: TfTrackerRuleKind, nextRules: TfTrackerRule[]) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  isDisabled: boolean;
  isDirty: boolean;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [pendingKind, setPendingKind] = useState<TfTrackerRuleKind>("website");
  const [pendingTarget, setPendingTarget] = useState("");
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [modalInput, setModalInput] = useState("");
  const [showSavedBanner, setShowSavedBanner] = useState(false);
  const savedBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; });

  useEffect(() => {
    if (!isDirty || isSaving || isDisabled) return;
    const timerId = setTimeout(() => {
      void onSaveRef.current().then(() => {
        setShowSavedBanner(true);
        if (savedBannerTimerRef.current) clearTimeout(savedBannerTimerRef.current);
        savedBannerTimerRef.current = setTimeout(() => setShowSavedBanner(false), 2000);
      }).catch(() => {});
    }, 500);
    return () => clearTimeout(timerId);
  }, [isDirty, isSaving, isDisabled]);

  const combinedRules: TrackerRuleRow[] = [
    ...rulesByKind.website.map((rule) => ({
      rule,
      kind: "website" as const,
      listKey: listKeys.website,
    })),
    ...rulesByKind.app.map((rule) => ({
      rule,
      kind: "app" as const,
      listKey: listKeys.app,
    })),
  ];
  const canAdd = newName.trim().length > 0 && pendingTarget.trim().length > 0;

  function makeRowKey(kind: TfTrackerRuleKind, id: string) {
    return `${kind}:${id}`;
  }

  function beginEdit(row: TrackerRuleRow) {
    setEditingKey(makeRowKey(row.kind, row.rule.id));
    setEditName(row.rule.name);
    setEditTarget(row.rule.target);
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditName("");
    setEditTarget("");
  }

  function commitEdit(row: TrackerRuleRow) {
    const target = editTarget.trim();
    if (!target) {
      cancelEdit();
      return;
    }

    onRulesChange(
      row.kind,
      rulesByKind[row.kind].map((rule) =>
        rule.id === row.rule.id
          ? {
              ...rule,
              name: editName.trim() || deriveTfTrackerRuleName(target, row.kind),
              target,
              kind: row.kind,
            }
          : rule,
      ),
    );
    cancelEdit();
  }

  function handleAdd() {
    const target = pendingTarget.trim();
    if (!target) {
      return;
    }

    onRulesChange(pendingKind, [
      ...rulesByKind[pendingKind],
      {
        id: generateTrackerRuleId(),
        name: newName.trim() || deriveTfTrackerRuleName(target, pendingKind),
        target,
        kind: pendingKind,
      },
    ]);
    setNewName("");
    setPendingTarget("");
  }

  function handleDelete(row: TrackerRuleRow) {
    onRulesChange(
      row.kind,
      rulesByKind[row.kind].filter((rule) => rule.id !== row.rule.id),
    );
  }

  function handleTargetDone() {
    const target = modalInput.trim();
    if (!target) {
      return;
    }

    setPendingTarget(target);
    setModalInput("");
    setShowTargetModal(false);
  }

  function openTargetModal(kind: TfTrackerRuleKind) {
    setPendingKind(kind);
    setModalInput(pendingTarget);
    setShowTargetModal(true);
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/70 p-5 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
          {combinedRules.length}
        </span>
      </div>

      {combinedRules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-5 text-sm text-slate-500">
          No rules yet. Add the first entry below.
        </div>
      ) : (
        <div className="space-y-2">
          {combinedRules.map((row) => {
            const rowKey = makeRowKey(row.kind, row.rule.id);
            const isEditing = editingKey === rowKey;

            return (
              <div
                key={rowKey}
                className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-slate-950/35 px-3 py-2"
              >
                <RuleKindPill kind={row.kind} />
                {isEditing ? (
                  <>
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder="Name"
                      disabled={isSaving || isDisabled}
                      className={`${fieldClassName} flex-1`}
                    />
                    <input
                      value={editTarget}
                      onChange={(event) => setEditTarget(event.target.value)}
                      placeholder={targetPlaceholders[row.kind]}
                      disabled={isSaving || isDisabled}
                      className={`${fieldClassName} flex-1`}
                    />
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => commitEdit(row)}
                      disabled={isSaving || isDisabled}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel"
                      className={iconButtonClassName}
                      onClick={cancelEdit}
                      disabled={isSaving || isDisabled}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{row.rule.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {formatTrackerRuleTargetDisplay(row.rule.target, row.kind)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Edit ${row.rule.name}`}
                      className={iconButtonClassName}
                      onClick={() => beginEdit(row)}
                      disabled={isSaving || isDisabled}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${row.rule.name}`}
                      className={iconButtonClassName}
                      onClick={() => handleDelete(row)}
                      disabled={isSaving || isDisabled}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-[16px] border border-dashed border-white/10 bg-slate-950/20 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={isSaving || isDisabled}
            placeholder={namePlaceholder}
            className={`${fieldClassName} min-w-[180px] flex-1`}
          />
          <button
            type="button"
            className={cn(
              secondaryButtonClassName,
              pendingKind === "website"
                ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                : "opacity-70",
            )}
            disabled={isSaving || isDisabled}
            aria-pressed={pendingKind === "website"}
            onClick={() => openTargetModal("website")}
          >
            <Globe className="h-4 w-4" />
            Website{pendingKind === "website" ? " ✓" : ""}
          </button>
          <button
            type="button"
            className={cn(
              secondaryButtonClassName,
              pendingKind === "app"
                ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-200"
                : "opacity-70",
            )}
            disabled={isSaving || isDisabled}
            aria-pressed={pendingKind === "app"}
            onClick={() => openTargetModal("app")}
          >
            <Monitor className="h-4 w-4" />
            App{pendingKind === "app" ? " ✓" : ""}
          </button>
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={handleAdd}
            disabled={isSaving || isDisabled || !canAdd}
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
        {pendingTarget ? (
          <p className="truncate px-1 pt-2 text-xs text-slate-400">
            {formatTrackerRuleTargetDisplay(pendingTarget, pendingKind)}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs font-medium text-slate-400">
          {isSaving ? "Saving…" : "Tracker rules are saved locally"}
        </span>
        {showSavedBanner ? (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
            <Check className="h-3 w-3" />
            Saved Changes
          </span>
        ) : null}
      </div>

      {showTargetModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowTargetModal(false)}
        >
          <div
            className="glass-panel mx-4 w-full max-w-md"
            onClick={(event) => event.stopPropagation()}
          >
            {pendingKind === "app" ? (
              <>
                <p className="text-sm text-slate-200">Steps to add app (in order):</p>
                <p className="mt-2 text-sm text-slate-200">1. Open Finder.</p>
                <p className="mt-1 text-sm text-slate-200">2. Open Applications and find the app.</p>
                <p className="mt-1 text-sm text-slate-200">3. Right click the app and hold the option key.</p>
                <p className="mt-1 text-sm text-slate-200">4. Copy the app as a path, then paste it below.</p>
              </>
            ) : (
              <h3 className="text-base font-semibold text-white">
                Paste the URL for {newName.trim() || "this website"}
              </h3>
            )}
            <input
              autoFocus
              value={modalInput}
              onChange={(event) => setModalInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleTargetDone();
                }
                if (event.key === "Escape") {
                  setShowTargetModal(false);
                }
              }}
              placeholder={targetPlaceholders[pendingKind]}
              className={`${fieldClassName} mt-4 placeholder:opacity-30`}
            />
            <div className="mt-4 flex justify-end">
              <button type="button" className={secondaryButtonClassName} onClick={handleTargetDone}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function TrackerSettingsPanel({
  embedded = false,
  themeId,
}: {
  embedded?: boolean;
  themeId?: ThemeId;
}) {
  const store = useTimeFolioStore();
  const { state, isLoading, error } = store;
  const reload = (...args: Parameters<typeof store.reload>) => store.reload(...args);
  const reset = (...args: Parameters<typeof store.reset>) => store.reset(...args);
  const saveState = (...args: Parameters<typeof store.saveState>) => store.saveState(...args);
  const importNativeSpans = (...args: Parameters<typeof store.importNativeSpans>) =>
    store.importNativeSpans(...args);
  const upsertSessionLog = (...args: Parameters<typeof store.upsertSessionLog>) =>
    store.upsertSessionLog(...args);
  const [draftPrefs, setDraftPrefs] = useState<TfTrackerPrefs>(() => cloneTrackerPrefs(state.trackerPrefs));
  const [savingKey, setSavingKey] = useState<TrackerGroupKey | null>(null);
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
  const [v2SamplerActionBusy, setV2SamplerActionBusy] = useState(false);
  const [v2DelayCountdown, setV2DelayCountdown] = useState<number | null>(null);
  const [v2SamplerStatus, setV2SamplerStatus] = useState<AutoTrackerV2NativeSamplerStatus | null>(
    null,
  );
  const [v2LastCaptureInfo, setV2LastCaptureInfo] = useState<{
    appendedCount: number;
    captureErrors: string[];
    capturedAtMs: number;
  } | null>(null);
  const [v2ManualWriteSelectionId, setV2ManualWriteSelectionId] = useState("");
  const [v2WrittenPreviewSessionIds, setV2WrittenPreviewSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [v2ManualWriteMessage, setV2ManualWriteMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [v2ContinuousWriteStatus, setV2ContinuousWriteStatus] =
    useState<TfAutoTrackerV2DevContinuousWriteStatus | null>(null);
  const [v2IsWritingSelectedSession, setV2IsWritingSelectedSession] = useState(false);
  const [v2StopFinalizeMessage, setV2StopFinalizeMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [v2RecoveryFinalizeMessage, setV2RecoveryFinalizeMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [v2RecoveryDebugWriteResult, setV2RecoveryDebugWriteResult] =
    useState<AutoTrackerV2NativeRecoveryDebugWriteResult | null>(null);
  const [v2RecoveryDebugMessage, setV2RecoveryDebugMessage] = useState<{
    tone: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [v2IsStopFinalizing, setV2IsStopFinalizing] = useState(false);
  const [v2IsRecoveryFinalizing, setV2IsRecoveryFinalizing] = useState(false);
  const [v2LastPersistedAtMs, setV2LastPersistedAtMs] = useState<number | null>(null);
  const [v2PersistenceError, setV2PersistenceError] = useState<string | null>(null);
  const [v2RecoveredStateSummary, setV2RecoveredStateSummary] = useState<{
    eventsCount: number;
    writtenPreviewSessionIdCount: number;
    lastSamplerRunning: boolean;
    lastSamplerTickCompletedAtMs: number | null;
  } | null>(null);
  const [v2RecoveryDiagnostics, setV2RecoveryDiagnostics] =
    useState<AutoTrackerV2NativeRecoveryDiagnostics | null>(null);
  const [v2PersistedOpenPreviewSession, setV2PersistedOpenPreviewSession] =
    useState<TfAutoTrackerV2DevPersistedOpenPreviewSession | null>(null);
  const [v2PersistedRecoveryStatus, setV2PersistedRecoveryStatus] =
    useState<TfAutoTrackerV2DevRecoveryStatus>("noEligibleSession");
  const [v2PersistedRecoveryMessage, setV2PersistedRecoveryMessage] = useState<string | null>(null);
  const [v2HasLoadedPersistedState, setV2HasLoadedPersistedState] = useState(false);

  const v2DelayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const v2WritingPreviewSessionIdsRef = useRef<Set<string>>(new Set());
  const v2DidHydratePersistedStateRef = useRef(false);
  const isV2SamplerStatusEnabled = FF.autotrackerV2NativeSampler || FF.autotrackerV2UserMode;

  useEffect(() => {
    setDraftPrefs(cloneTrackerPrefs(state.trackerPrefs));
  }, [state.trackerPrefs]);

  useEffect(() => {
    if (FF.autotrackerV2UserMode) {
      return;
    }

    void handleRefreshAutoTrackerStatus();
  }, []);

  useEffect(() => {
    return () => {
      if (v2DelayIntervalRef.current !== null) {
        clearInterval(v2DelayIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !shouldStartAutoTrackerV2StartupRecoveryHydration({
        hasAppliedHydration: v2DidHydratePersistedStateRef.current,
        nativeInspectorEnabled: FF.autotrackerV2NativeInspector,
        nativeSamplerEnabled: FF.autotrackerV2NativeSampler,
        userModeEnabled: FF.autotrackerV2UserMode,
      })
    ) {
      return;
    }

    let cancelled = false;

    void hydrateV2RecoveryFromPersistence(() => cancelled).then(() => {
      if (!cancelled) {
        v2DidHydratePersistedStateRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const classificationSettings: TfAutotrackerV2ClassificationSettings = {
    autoApps: state.trackerPrefs.customAutoApps,
    autoWebsites: state.trackerPrefs.customAutoWebsites,
    distractionApps: state.trackerPrefs.customDistractionApps,
    distractionWebsites: state.trackerPrefs.customDistractionWebsites,
  };
  const previewSpans = buildAutoTrackerV2PreviewSpans(v2Snapshot?.events ?? [], classificationSettings);
  const reducerPreview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const finalizedPreviewSessions = reducerPreview.finalizedPreviewSessions;
  const selectedFinalizedPreviewSession =
    finalizedPreviewSessions.find((session) => session.previewSessionId === v2ManualWriteSelectionId) ??
    null;
  const selectedFinalizedPreviewSessionAlreadyWritten =
    selectedFinalizedPreviewSession !== null &&
    v2WrittenPreviewSessionIds.has(selectedFinalizedPreviewSession.previewSessionId);
  const reducerPreviewActiveTarget =
    reducerPreview.state.status === "focused"
      ? reducerPreview.state.target
      : reducerPreview.state.status === "awayPending"
        ? reducerPreview.state.session.target
        : reducerPreview.state.status === "recoverableOpen"
          ? reducerPreview.state.session.target
          : null;
  const finalizedPreviewSessionIdsKey = finalizedPreviewSessions
    .map((session) => session.previewSessionId)
    .join("|");
  const reducerPreviewStateKey = `${reducerPreview.state.status}:${reducerPreviewActiveTarget?.stableId ?? ""}`;
  const writtenPreviewSessionIdsKey = Array.from(v2WrittenPreviewSessionIds).sort().join("|");
  const isSamplerRunning = v2SamplerStatus?.running === true;
  const currentLastSeenAtMs =
    reducerPreview.state.status === "awayPending"
      ? reducerPreview.state.leftAtMs
      : reducerPreview.state.status === "recoverableOpen" &&
          reducerPreview.state.openStateBeforeShutdown.status === "awayPending"
        ? reducerPreview.state.openStateBeforeShutdown.leftAtMs
        : v2SamplerStatus?.lastTickCompletedAtMs ??
          v2Snapshot?.status.lastSampledAtMs ??
          reducerPreview.state.lastEventMs;
  const currentPersistedOpenPreviewSession = selectAutoTrackerV2RecoveredPreviewSession({
    previewSpans,
    state: reducerPreview.state,
    lastSeenAtMs: currentLastSeenAtMs,
  });
  const currentPersistedRecoveryAssessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: currentPersistedOpenPreviewSession,
    nowMs: Date.now(),
    writtenPreviewSessionIds: v2WrittenPreviewSessionIds,
  });
  const recoveredPreviewAssessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: v2PersistedOpenPreviewSession,
    nowMs: Date.now(),
    writtenPreviewSessionIds: new Set([
      ...v2WrittenPreviewSessionIds,
      ...v2WritingPreviewSessionIdsRef.current,
    ]),
  });
  function persistAutoTrackerV2DevState(updateUi = true): void {
    if (!v2HasLoadedPersistedState) {
      return;
    }

    if (!FF.autotrackerV2NativeInspector && !isV2SamplerStatusEnabled) {
      return;
    }

    try {
      const lastPersistedAtMs = Date.now();
      const saved = saveTfAutoTrackerV2DevPersistedState({
        schemaVersion: TF_AUTOTRACKER_V2_DEV_STATE_SCHEMA_VERSION,
        lastPersistedAtMs,
        events: v2Snapshot?.events ?? [],
        writtenPreviewSessionIds: Array.from(v2WrittenPreviewSessionIds),
        samplerStatus: v2SamplerStatus,
        continuousWriteStatus: v2ContinuousWriteStatus,
        lastSamplerRunning: v2SamplerStatus?.running === true,
        lastSamplerTickCompletedAtMs: v2SamplerStatus?.lastTickCompletedAtMs ?? null,
        lastEligibleOpenPreviewSession: currentPersistedOpenPreviewSession,
        recoveryStatus: currentPersistedRecoveryAssessment.status,
        lastRecoveryMessage: currentPersistedRecoveryAssessment.message,
      });

      if (!updateUi) {
        return;
      }

      setV2LastPersistedAtMs(saved?.lastPersistedAtMs ?? null);
      setV2PersistedOpenPreviewSession(saved?.lastEligibleOpenPreviewSession ?? null);
      setV2PersistedRecoveryStatus(saved?.recoveryStatus ?? "noEligibleSession");
      setV2PersistedRecoveryMessage(saved?.lastRecoveryMessage ?? null);
      setV2PersistenceError(null);
    } catch (err) {
      if (!updateUi) {
        return;
      }
      setV2PersistenceError(
        err instanceof Error && err.message
          ? `Dev Auto-Tracker preview persistence failed: ${err.message}`
          : "Dev Auto-Tracker preview persistence failed.",
      );
    }
  }

  useEffect(() => {
    if (!v2HasLoadedPersistedState) {
      return;
    }

    if (!FF.autotrackerV2NativeInspector && !isV2SamplerStatusEnabled) {
      return;
    }

    persistAutoTrackerV2DevState();
  }, [
    FF.autotrackerV2NativeInspector,
    isV2SamplerStatusEnabled,
    v2ContinuousWriteStatus,
    v2SamplerStatus,
    v2HasLoadedPersistedState,
    v2Snapshot,
    writtenPreviewSessionIdsKey,
    reducerPreviewStateKey,
  ]);

  useEffect(() => {
    if (!v2HasLoadedPersistedState) {
      return;
    }

    if (!FF.autotrackerV2NativeInspector && !isV2SamplerStatusEnabled) {
      return;
    }

    const handlePersistOnExit = () => {
      persistAutoTrackerV2DevState(false);
    };

    window.addEventListener("beforeunload", handlePersistOnExit);
    window.addEventListener("pagehide", handlePersistOnExit);

    return () => {
      handlePersistOnExit();
      window.removeEventListener("beforeunload", handlePersistOnExit);
      window.removeEventListener("pagehide", handlePersistOnExit);
    };
  }, [
    FF.autotrackerV2NativeInspector,
    isV2SamplerStatusEnabled,
    v2ContinuousWriteStatus,
    v2SamplerStatus,
    v2HasLoadedPersistedState,
    v2Snapshot,
    writtenPreviewSessionIdsKey,
    reducerPreviewStateKey,
  ]);

  useEffect(() => {
    if (!FF.autotrackerV2ContinuousWrite) {
      return;
    }

    if ((v2Snapshot?.events.length ?? 0) === 0) {
      return;
    }

    const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
      finalizedPreviewSessions,
      state: reducerPreview.state,
      writtenPreviewSessionIds: v2WrittenPreviewSessionIds,
    });
    const previewSessionsToWrite = selection.previewSessions.filter(
      (session) => !v2WritingPreviewSessionIdsRef.current.has(session.previewSessionId),
    );

    if (previewSessionsToWrite.length === 0) {
      return;
    }

    let isActive = true;
    for (const previewSession of previewSessionsToWrite) {
      v2WritingPreviewSessionIdsRef.current.add(previewSession.previewSessionId);
    }

    void (async () => {
      const names: string[] = [];
      let writtenCount = 0;

      try {
        for (const previewSession of previewSessionsToWrite) {
          const method = await writeAutoTrackerV2PreviewSession(previewSession);
          names.push(method);
          writtenCount += 1;
        }

        if (isActive) {
          setV2ContinuousWriteStatus({
            writtenCount,
            names,
            skippedDuplicateCount: selection.skippedDuplicateCount,
            error: null,
          });
        }
      } catch (err) {
        if (isActive) {
          setV2ContinuousWriteStatus({
            writtenCount,
            names,
            skippedDuplicateCount: selection.skippedDuplicateCount,
            error:
              err instanceof Error && err.message
                ? err.message
                : "Unable to write finalized preview sessions automatically.",
          });
        }
      } finally {
        for (const previewSession of previewSessionsToWrite) {
          v2WritingPreviewSessionIdsRef.current.delete(previewSession.previewSessionId);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, [
    FF.autotrackerV2ContinuousWrite,
    finalizedPreviewSessionIdsKey,
    reducerPreviewStateKey,
    upsertSessionLog,
    v2Snapshot?.events.length,
    writtenPreviewSessionIdsKey,
  ]);

  useEffect(() => {
    if (!isV2SamplerStatusEnabled || !isSamplerRunning) {
      return;
    }

    let cancelled = false;

    const refresh = () => {
      void Promise.all([
        getAutoTrackerV2NativeSamplerStatus(),
        snapshotAutoTrackerV2Native(),
      ])
        .then(([samplerStatus, snapshot]) => {
          if (cancelled) {
            return;
          }
          setV2SamplerStatus(samplerStatus);
          setV2Snapshot(snapshot);
          setV2ProbeStatus(snapshot.status);
        })
        .catch((err: unknown) => {
          if (cancelled) {
            return;
          }
          setV2InspectorError(
            err instanceof Error && err.message ? err.message : "Sampler refresh failed.",
          );
        });
    };

    refresh();
    const intervalId = window.setInterval(refresh, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isSamplerRunning]);

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
        onAction={() => {
          void reload();
        }}
      />
    );
  }

  async function handleSave(groupKey: TrackerGroupKey) {
    const groupConfig = TRACKER_GROUPS.find((config) => config.key === groupKey);
    if (!groupConfig) {
      return;
    }

    const nextTrackerPrefs = {
      ...draftPrefs,
      [groupConfig.listKeys.website]: sanitizeTrackerRules(
        draftPrefs[groupConfig.listKeys.website],
        "website",
      ),
      [groupConfig.listKeys.app]: sanitizeTrackerRules(draftPrefs[groupConfig.listKeys.app], "app"),
    };

    setSavingKey(groupKey);
    try {
      await saveState({
        ...state,
        trackerPrefs: nextTrackerPrefs,
      });
    } finally {
      setSavingKey(null);
    }
  }

  function handleExportData() {
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

  async function loadV2NativeRecoveryBundle(): Promise<{
    diagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
    nativeRecoveryState: Awaited<ReturnType<typeof readAutoTrackerV2NativeRecovery>>;
    liveSamplerStatus: AutoTrackerV2NativeSamplerStatus | null;
    recoveryError: string | null;
  }> {
    let diagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null = null;
    let nativeRecoveryState: Awaited<ReturnType<typeof readAutoTrackerV2NativeRecovery>> = null;
    let liveSamplerStatus: AutoTrackerV2NativeSamplerStatus | null = null;
    let recoveryError: string | null = null;

    const [diagnosticsResult, recoveryResult, samplerStatusResult] = await Promise.allSettled([
      readAutoTrackerV2NativeRecoveryDiagnostics(),
      readAutoTrackerV2NativeRecovery(),
      isV2SamplerStatusEnabled ? getAutoTrackerV2NativeSamplerStatus() : Promise.resolve(null),
    ]);

    if (diagnosticsResult.status === "fulfilled") {
      diagnostics = diagnosticsResult.value;
      recoveryError = diagnosticsResult.value.readError;
    } else {
      recoveryError =
        diagnosticsResult.reason instanceof Error && diagnosticsResult.reason.message
          ? `Native dev Auto-Tracker recovery diagnostics failed: ${diagnosticsResult.reason.message}`
          : "Native dev Auto-Tracker recovery diagnostics failed.";
    }

    if (recoveryResult.status === "fulfilled") {
      nativeRecoveryState = recoveryResult.value;
    } else if (!recoveryError) {
      recoveryError =
        recoveryResult.reason instanceof Error && recoveryResult.reason.message
          ? `Native dev Auto-Tracker recovery read failed: ${recoveryResult.reason.message}`
          : "Native dev Auto-Tracker recovery read failed.";
    }

    if (samplerStatusResult.status === "fulfilled") {
      liveSamplerStatus = samplerStatusResult.value;
    }

    return { diagnostics, nativeRecoveryState, liveSamplerStatus, recoveryError };
  }

  async function hydrateV2RecoveryFromPersistence(
    isCancelled?: () => boolean,
  ): Promise<void> {
    const localPersistedState = loadTfAutoTrackerV2DevPersistedState();
    const { diagnostics, nativeRecoveryState, liveSamplerStatus, recoveryError } =
      await loadV2NativeRecoveryBundle();

    if (isCancelled?.()) {
      return;
    }

    applyHydratedV2RecoveryState({
      localPersistedState,
      diagnostics,
      nativeRecoveryState,
      liveSamplerStatus,
      recoveryError,
    });
  }

  function applyHydratedV2RecoveryState({
    localPersistedState,
    diagnostics,
    nativeRecoveryState,
    liveSamplerStatus,
    recoveryError,
  }: {
    localPersistedState: ReturnType<typeof loadTfAutoTrackerV2DevPersistedState>;
    diagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
    nativeRecoveryState: Awaited<ReturnType<typeof readAutoTrackerV2NativeRecovery>>;
    liveSamplerStatus: AutoTrackerV2NativeSamplerStatus | null;
    recoveryError: string | null;
  }): void {
    const hydration = deriveAutoTrackerV2RecoveryHydration({
      localPersistedState,
      liveSamplerStatus,
      recoveryDiagnostics: diagnostics,
      recoveryState: nativeRecoveryState,
    });
    const restored = hydration.restoredState;

    setV2RecoveryDiagnostics(hydration.recoveryDiagnostics);
    setV2SamplerStatus(hydration.samplerStatus);
    setV2Snapshot(hydration.snapshot);
    if (hydration.snapshot) {
      setV2ProbeStatus(hydration.snapshot.status);
    }

    if (!restored) {
      setV2ContinuousWriteStatus(null);
      setV2WrittenPreviewSessionIds(new Set());
      setV2RecoveredStateSummary(null);
      setV2PersistedOpenPreviewSession(null);
      setV2PersistedRecoveryStatus("noEligibleSession");
      setV2PersistedRecoveryMessage(null);
      setV2LastPersistedAtMs(null);
      setV2PersistenceError(recoveryError);
      setV2HasLoadedPersistedState(true);
      return;
    }

    if (restored.continuousWriteStatus) {
      setV2ContinuousWriteStatus(restored.continuousWriteStatus);
    } else {
      setV2ContinuousWriteStatus(null);
    }

    setV2WrittenPreviewSessionIds(new Set(restored.writtenPreviewSessionIds));

    const restoredPreviewSpans = buildAutoTrackerV2PreviewSpans(
      restored.events,
      classificationSettings,
    );
    const restoredReducerPreview = buildAutoTrackerV2ReducerPreview(restoredPreviewSpans);
    const restoredLastSeenAtMs =
      restored.lastSamplerTickCompletedAtMs ??
      restored.samplerStatus?.lastTickCompletedAtMs ??
      restored.events.at(-1)?.timestampMs ??
      restoredReducerPreview.state.lastEventMs;
    const restoredOpenPreviewSession =
      restored.events.length > 0
        ? selectAutoTrackerV2RecoveredPreviewSession({
            previewSpans: restoredPreviewSpans,
            state: restoredReducerPreview.state,
            lastSeenAtMs: restoredLastSeenAtMs,
          }) ?? restored.lastEligibleOpenPreviewSession
        : restored.lastEligibleOpenPreviewSession;
    const restoredRecoveryAssessment = assessAutoTrackerV2RecoveredPreviewSession({
      recoveredPreviewSession: restoredOpenPreviewSession,
      nowMs: Date.now(),
      writtenPreviewSessionIds: restored.writtenPreviewSessionIds,
    });

    setV2LastPersistedAtMs(restored.lastPersistedAtMs);
    setV2RecoveredStateSummary({
      eventsCount: restored.events.length,
      writtenPreviewSessionIdCount: restored.writtenPreviewSessionIds.length,
      lastSamplerRunning: restored.lastSamplerRunning,
      lastSamplerTickCompletedAtMs: restored.lastSamplerTickCompletedAtMs,
    });
    setV2PersistedOpenPreviewSession(restoredOpenPreviewSession);
    setV2PersistedRecoveryStatus(restoredRecoveryAssessment.status);
    setV2PersistedRecoveryMessage(
      restoredOpenPreviewSession
        ? restoredRecoveryAssessment.message
        : restored.lastRecoveryMessage ?? restoredRecoveryAssessment.message,
    );
    setV2PersistenceError(recoveryError);
    setV2HasLoadedPersistedState(true);
  }

  async function refreshV2SnapshotAndSamplerStatus(): Promise<{
    snapshot: AutoTrackerV2NativeSnapshot;
    samplerStatus: AutoTrackerV2NativeSamplerStatus | null;
    recoveryDiagnostics: AutoTrackerV2NativeRecoveryDiagnostics | null;
  }> {
    const [snapshot, samplerStatus, recoveryDiagnostics] = await Promise.all([
      snapshotAutoTrackerV2Native(),
      isV2SamplerStatusEnabled ? getAutoTrackerV2NativeSamplerStatus() : Promise.resolve(null),
      readAutoTrackerV2NativeRecoveryDiagnostics().catch(() => null),
    ]);

    setV2Snapshot(snapshot);
    setV2ProbeStatus(snapshot.status);
    if (samplerStatus) {
      setV2SamplerStatus(samplerStatus);
    }
    setV2RecoveryDiagnostics(recoveryDiagnostics);

    return {
      snapshot,
      samplerStatus,
      recoveryDiagnostics,
    };
  }

  async function handleV2Probe() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const [status, samplerStatus, recoveryDiagnostics] = await Promise.all([
        probeAutoTrackerV2Native(),
        isV2SamplerStatusEnabled ? getAutoTrackerV2NativeSamplerStatus() : Promise.resolve(null),
        readAutoTrackerV2NativeRecoveryDiagnostics().catch(() => null),
      ]);
      setV2ProbeStatus(status);
      if (samplerStatus) {
        setV2SamplerStatus(samplerStatus);
      }
      setV2RecoveryDiagnostics(recoveryDiagnostics);
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
      await refreshV2SnapshotAndSamplerStatus();
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
      await refreshV2SnapshotAndSamplerStatus();
    } catch (err) {
      setV2InspectorError(err instanceof Error && err.message ? err.message : "Capture failed.");
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2ReloadNativeRecoveryFile() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      await hydrateV2RecoveryFromPersistence();
    } catch (err) {
      setV2InspectorError(
        err instanceof Error && err.message
          ? err.message
          : "Native recovery reload failed.",
      );
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2DebugWriteRecoveryNow() {
    setV2InspectorError(null);
    setV2RecoveryDebugMessage(null);
    setV2IsBusy(true);
    try {
      const result = await debugWriteAutoTrackerV2NativeRecoveryNow();
      const [samplerStatus, recoveryDiagnostics] = await Promise.all([
        isV2SamplerStatusEnabled ? getAutoTrackerV2NativeSamplerStatus() : Promise.resolve(null),
        readAutoTrackerV2NativeRecoveryDiagnostics().catch(() => null),
      ]);
      setV2RecoveryDebugWriteResult(result);
      if (samplerStatus) {
        setV2SamplerStatus(samplerStatus);
      }
      setV2RecoveryDiagnostics(recoveryDiagnostics);
      setV2RecoveryDebugMessage({
        tone: result.writeOk ? "success" : "error",
        text: result.writeOk
          ? `Debug recovery write/read complete. Bytes: ${formatFileSize(result.bytesWritten)}. Readback events: ${result.readbackEventsCount ?? 0}. Exists: ${result.exists ? "Yes" : "No"}.`
          : `Debug recovery write failed: ${result.writeError ?? "Unknown error."}`,
      });
    } catch (err) {
      setV2RecoveryDebugMessage({
        tone: "error",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Debug recovery write/read failed.",
      });
    } finally {
      setV2IsBusy(false);
    }
  }

  async function handleV2ClearBuffer() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const [status, recoveryClearResult] = await Promise.all([
        clearAutoTrackerV2NativeBuffer(),
        clearAutoTrackerV2NativeRecovery(),
      ]);
      setV2ProbeStatus(status);
      if (isV2SamplerStatusEnabled) {
        const samplerStatus = await getAutoTrackerV2NativeSamplerStatus();
        setV2SamplerStatus(samplerStatus);
      }
      setV2Snapshot((prev: AutoTrackerV2NativeSnapshot | null) =>
        prev ? { ...prev, status, events: [] } : null,
      );
      setV2LastCaptureInfo(null);
      setV2WrittenPreviewSessionIds(new Set());
      setV2ManualWriteSelectionId("");
      setV2ManualWriteMessage(null);
      setV2ContinuousWriteStatus(null);
      setV2StopFinalizeMessage(null);
      setV2RecoveryFinalizeMessage(null);
      setV2RecoveryDebugWriteResult(null);
      setV2RecoveredStateSummary(null);
      setV2PersistedOpenPreviewSession(null);
      setV2PersistedRecoveryStatus("noEligibleSession");
      setV2PersistedRecoveryMessage(null);
      clearTfAutoTrackerV2DevPersistedState();
      setV2LastPersistedAtMs(null);
      setV2PersistenceError(null);
      setV2RecoveryDiagnostics({
        recoveryFilePath: recoveryClearResult.recoveryFilePath,
        source: "primary",
        primaryRecoveryFilePath: recoveryClearResult.recoveryFilePath,
        writeFilePath: recoveryClearResult.recoveryFilePath,
        readFilePath: null,
        selectedReadSource: "none",
        exists: false,
        sizeBytes: null,
        modifiedAtMs: null,
        parsedSchemaVersion: null,
        eventsCount: null,
        lastObservedAppName: null,
        lastObservedBundleId: null,
        lastObservedBrowserTitle: null,
        lastObservedBrowserUrl: null,
        readError: null,
        fallbackCandidates: [],
        lastWriteByteCount: null,
        fileExistsAfterWrite: false,
        readbackAfterWriteEventsCount: null,
      });
      setV2RecoveryDebugMessage({
        tone: "info",
        text: `Deleted primary: ${recoveryClearResult.deletedPrimary ? "Yes" : "No"}. Fallback cleanup count: ${recoveryClearResult.fallbackCleanupCount}.`,
      });
      setV2StopFinalizeMessage({
        tone: "info",
        text: recoveryClearResult.deleted
          ? `Cleared dev Auto-Tracker state and deleted native recovery file.`
          : "Cleared dev Auto-Tracker state. No native recovery file was present.",
      });
    } catch (err) {
      setV2InspectorError(
        err instanceof Error && err.message
          ? err.message
          : "Clear dev Auto-Tracker state failed.",
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

  async function handleV2StartNativeSampler() {
    setV2InspectorError(null);
    setV2SamplerActionBusy(true);
    try {
      const samplerStatus = await startAutoTrackerV2NativeSampler();
      setV2SamplerStatus(samplerStatus);
      await refreshV2SnapshotAndSamplerStatus();
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Unable to start Auto-Tracker.";
      setV2InspectorError(message);
    } finally {
      setV2SamplerActionBusy(false);
    }
  }

  async function handleV2StopNativeSampler() {
    setV2InspectorError(null);
    setV2SamplerActionBusy(true);
    try {
      const samplerStatus = await stopAutoTrackerV2NativeSampler();
      setV2SamplerStatus(samplerStatus);
      await refreshV2SnapshotAndSamplerStatus();
    } catch (err) {
      const message =
        err instanceof Error && err.message ? err.message : "Unable to stop Auto-Tracker.";
      setV2InspectorError(message);
    } finally {
      setV2SamplerActionBusy(false);
    }
  }

  async function writeAutoTrackerV2PreviewSession(
    previewSession: TfAutotrackerV2FinalizedPreviewSession,
  ): Promise<string> {
    const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
      previewSession,
      makeAutoTrackerV2PreviewSessionLogId(previewSession.previewSessionId),
    );
    await upsertSessionLog(sessionLog);
    setV2WrittenPreviewSessionIds((current) => {
      return appendWrittenPreviewSessionId(current, previewSession.previewSessionId);
    });
    return sessionLog.method;
  }

  async function handleV2FinalizeRecoveredPreviewSession() {
    if (v2IsRecoveryFinalizing || v2IsWritingSelectedSession) {
      return;
    }

    setV2InspectorError(null);
    setV2RecoveryFinalizeMessage(null);
    setV2IsRecoveryFinalizing(true);

    try {
      if (!recoveredPreviewAssessment.canFinalize) {
        setV2RecoveryFinalizeMessage({
          tone: "info",
          text: recoveredPreviewAssessment.message,
        });
        return;
      }

      const previewSession = finalizeAutoTrackerV2RecoveredPreviewSession(
        recoveredPreviewAssessment.recoveredPreviewSession,
      );
      if (!previewSession) {
        setV2RecoveryFinalizeMessage({
          tone: "info",
          text: "Recovered session could not be finalized safely.",
        });
        return;
      }

      v2WritingPreviewSessionIdsRef.current.add(previewSession.previewSessionId);
      try {
        const method = await writeAutoTrackerV2PreviewSession(previewSession);
        setV2RecoveryFinalizeMessage({
          tone: "success",
          text: `Recovered session wrote ${method} to Session Log.`,
        });
      } finally {
        v2WritingPreviewSessionIdsRef.current.delete(previewSession.previewSessionId);
      }
    } catch (err) {
      setV2RecoveryFinalizeMessage({
        tone: "error",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Unable to finalize the recovered preview session.",
      });
    } finally {
      setV2IsRecoveryFinalizing(false);
    }
  }

  async function handleV2StopAndFinalizeCurrentPreviewSession() {
    if (v2IsStopFinalizing || v2IsWritingSelectedSession) {
      return;
    }

    setV2InspectorError(null);
    setV2StopFinalizeMessage(null);
    setV2IsStopFinalizing(true);

    try {
      const nowMs = Date.now();
      const selection = selectAutoTrackerV2StopSavePreviewSessions({
        finalizedPreviewSessions,
        previewSpans: buildAutoTrackerV2PreviewSpans(
          v2Snapshot?.events ?? [],
          classificationSettings,
        ),
        state: reducerPreview.state,
        nowMs,
        writtenPreviewSessionIds: new Set([
          ...v2WrittenPreviewSessionIds,
          ...v2WritingPreviewSessionIdsRef.current,
        ]),
      });
      let stoppedSampler = false;
      const selectionCount = selection.previewSessions.length;

      if (isSamplerRunning) {
        const samplerStatus = await stopAutoTrackerV2NativeSampler();
        setV2SamplerStatus(samplerStatus);
        stoppedSampler = true;
      }

      if (selectionCount === 0) {
        const reasonText =
          selection.reason === "alreadyWritten"
            ? "Those tracked/distraction preview sessions were already written."
            : "No eligible tracked/distraction session was open.";
        setV2StopFinalizeMessage({
          tone: "info",
          text: stoppedSampler ? `Stopped native sampler. ${reasonText}` : reasonText,
        });
        return;
      }

      for (const previewSession of selection.previewSessions) {
        v2WritingPreviewSessionIdsRef.current.add(previewSession.previewSessionId);
      }
      try {
        const names: string[] = [];
        for (const previewSession of selection.previewSessions) {
          const method = await writeAutoTrackerV2PreviewSession(previewSession);
          names.push(method);
        }
        setV2StopFinalizeMessage({
          tone: "success",
          text: stoppedSampler
            ? selectionCount === 1
              ? `Stopped native sampler and wrote ${names[0]} to Session Log.`
              : `Stopped native sampler and wrote ${selectionCount} Session Log entries.`
            : selectionCount === 1
              ? `Wrote ${names[0]} to Session Log.`
              : `Wrote ${selectionCount} Session Log entries.`,
        });
      } finally {
        for (const previewSession of selection.previewSessions) {
          v2WritingPreviewSessionIdsRef.current.delete(previewSession.previewSessionId);
        }
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Unable to stop and save Auto-Tracker.";
      setV2StopFinalizeMessage({
        tone: "error",
        text: message,
      });
    } finally {
      setV2IsStopFinalizing(false);
    }
  }

  async function handleV2WriteSelectedFinalizedPreviewSession(
    previewSession: TfAutotrackerV2FinalizedPreviewSession | null,
  ) {
    if (!FF.autotrackerV2ManualWrite || !previewSession || v2IsWritingSelectedSession) {
      return;
    }

    if (
      v2WrittenPreviewSessionIds.has(previewSession.previewSessionId) ||
      v2WritingPreviewSessionIdsRef.current.has(previewSession.previewSessionId)
    ) {
      setV2ManualWriteMessage({
        tone: "error",
        text: "This preview session was already written during the current inspector session.",
      });
      return;
    }

    setV2ManualWriteMessage(null);
    setV2IsWritingSelectedSession(true);
    v2WritingPreviewSessionIdsRef.current.add(previewSession.previewSessionId);

    try {
      const method = await writeAutoTrackerV2PreviewSession(previewSession);
      setV2ManualWriteMessage({
        tone: "success",
        text: `Wrote 1 preview session to Session Log: ${method}.`,
      });
    } catch (err) {
      setV2ManualWriteMessage({
        tone: "error",
        text:
          err instanceof Error && err.message
            ? err.message
            : "Unable to write the selected finalized preview session.",
      });
    } finally {
      v2WritingPreviewSessionIdsRef.current.delete(previewSession.previewSessionId);
      setV2IsWritingSelectedSession(false);
    }
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

  const canConfirmReset = resetConfirmationToken === RESET_CONFIRMATION_TOKEN;

  return (
    <div className={embedded ? "flex flex-col gap-6" : "p-8 flex flex-col gap-6"}>
      {!embedded ? (
        <div className="rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-6 shadow-lg shadow-black/20">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-emerald-300">
                Local only
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Tracker Settings</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Manage which apps and websites count as study time on this device.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-xs leading-5 text-slate-400">
              Changes stay on this device.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/15">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-white">Tracker Rules</h3>
              <p className="mt-1 text-sm text-slate-400">
                Manage which apps and websites count as study time or distractions on this device.
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3 text-xs leading-5 text-slate-400">
              Changes stay on this device.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {TRACKER_GROUPS.map((config) => {
          const rulesByKind = {
            website: draftPrefs[config.listKeys.website],
            app: draftPrefs[config.listKeys.app],
          };
          const originalRulesByKind = {
            website: state.trackerPrefs[config.listKeys.website],
            app: state.trackerPrefs[config.listKeys.app],
          };
          const sanitizedDraftWebsite = sanitizeTrackerRules(rulesByKind.website, "website");
          const sanitizedDraftApp = sanitizeTrackerRules(rulesByKind.app, "app");
          const sanitizedOriginalWebsite = sanitizeTrackerRules(originalRulesByKind.website, "website");
          const sanitizedOriginalApp = sanitizeTrackerRules(originalRulesByKind.app, "app");
          const isDirty =
            !trackerRuleListsMatch(sanitizedDraftWebsite, sanitizedOriginalWebsite) ||
            !trackerRuleListsMatch(sanitizedDraftApp, sanitizedOriginalApp);

          return (
            <TrackerGroupCard
              key={config.key}
              title={config.title}
              description={config.description}
              namePlaceholder={config.namePlaceholder}
              targetPlaceholders={config.targetPlaceholders}
              listKeys={config.listKeys}
              rulesByKind={rulesByKind}
              onRulesChange={(kind, nextRules) => {
                setDraftPrefs((prev) => ({
                  ...prev,
                  [config.listKeys[kind]]: nextRules,
                }));
              }}
              onSave={() => handleSave(config.key)}
              isSaving={savingKey === config.key}
              isDisabled={isDataBusy}
              isDirty={isDirty}
            />
          );
        })}
      </div>

      {FF.autotrackerV2UserMode ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 shadow-lg shadow-black/10">
          <div className="text-[11px] font-medium text-slate-500">
            Auto-Tracking setup
          </div>
          <p className="text-sm leading-6 text-cyan-50">
            Add the apps and websites you want counted as study time in Allowed. Put distracting
            apps and sites in Distractions.
          </p>
          <p className="text-sm font-medium leading-6 text-cyan-50">
            Use Session Log to start or stop Auto-Tracking.
          </p>
        </section>
      ) : null}

      {!embedded ? (
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/15">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-cyan-300">
                TimeFolio data
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-100">Back up, import, or reset TimeFolio data</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Use these controls only if you need to move data between devices or restore a copy.
                </p>
              </div>
            </div>
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
                onClick={() => {
                  void handleRestorePreviousState();
                }}
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
                onChange={(event) => {
                  void handleImportFileChange(event);
                }}
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
                      onClick={() => {
                        void handleConfirmImportData();
                      }}
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
                  <p className="font-medium">This clears only TimeFolio data. Legacy data is untouched.</p>
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
                      onClick={() => {
                        void handleConfirmResetData();
                      }}
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
      ) : null}

      {!FF.autotrackerV2UserMode ? (
        <section className="flex flex-col gap-5 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/15">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="inline-flex w-fit rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-teal-300">
                Local control
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-100">Auto-Tracker Status</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Production-facing Auto-Tracker controls appear here when enabled. Bootstrap status stays local-only.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleRefreshAutoTrackerStatus();
                }}
                disabled={isAutoTrackerRefreshing}
                className="rounded-lg border border-teal-500/30 bg-teal-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAutoTrackerRefreshing ? "Refreshing…" : "Refresh status"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleImportLatestAutoTrackerSpans();
                }}
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
      ) : null}

      {(() => {
        if (!FF.autotrackerV2NativeInspector && !FF.autotrackerV2NativeSampler) {
          return null;
        }
        const lastAppEvent = v2Snapshot
          ? [...v2Snapshot.events]
              .reverse()
              .find((e) => (e.kind === "targetFocused" || e.kind === "untrackedFocused") && e.appName)
          : undefined;

        const isDelayPending = v2DelayCountdown !== null;
        const anyBusy = v2IsBusy || v2SamplerActionBusy || isDelayPending;
        const recoveryTerminalPath =
          v2RecoveryDiagnostics?.primaryRecoveryFilePath ??
          v2RecoveryDiagnostics?.recoveryFilePath ??
          v2SamplerStatus?.recoveryFilePath ??
          null;
        const recoveryTerminalCommand = recoveryTerminalPath
          ? `ls -lh "${recoveryTerminalPath}" && cat "${recoveryTerminalPath}" | head -c 1000`
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
                    Diagnostic view of the V2 native event buffer that powers the dev preview only. Not wired to production Auto-Tracker mode yet.
                  </p>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                    Dev inspector preview state now recovers locally across reloads. Native sampler does not auto-resume.
                  </p>
                </div>
                <div className="inline-flex w-fit rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-200">
                  Manual capture remains the source of truth. Native sampler is Rust-owned and dev-only.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleV2Probe();
                  }}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-violet-500/30 bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {v2IsBusy ? "…" : "Probe"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleV2CaptureOnce();
                  }}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Capture once
                </button>
                <button
                  type="button"
                  onClick={handleV2CaptureDelayed}
                  disabled={isDelayPending || v2IsBusy || v2SamplerActionBusy || isSamplerRunning}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDelayPending ? `Capturing in ${v2DelayCountdown}s… switch now` : "Capture in 5s"}
                </button>
                {FF.autotrackerV2NativeSampler ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (isSamplerRunning) {
                        void handleV2StopNativeSampler();
                        return;
                      }
                      void handleV2StartNativeSampler();
                    }}
                    disabled={
                      isSamplerRunning
                        ? v2SamplerActionBusy
                        : v2IsBusy || v2SamplerActionBusy || isDelayPending
                    }
                    className={
                      isSamplerRunning
                        ? "rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    }
                  >
                    {isSamplerRunning ? "Stop native sampler" : "Start native sampler"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void handleV2StopAndFinalizeCurrentPreviewSession();
                  }}
                  disabled={v2IsBusy || v2SamplerActionBusy || isDelayPending || v2IsStopFinalizing}
                  className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {v2IsStopFinalizing
                    ? "Stopping & finalizing…"
                    : "Stop & finalize last tracked item"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleV2RefreshSnapshot();
                  }}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refresh snapshot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleV2DebugWriteRecoveryNow();
                  }}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Debug write/read recovery now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleV2ClearBuffer();
                  }}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear dev Auto-Tracker state
                </button>
              </div>
              <div className="max-w-3xl text-[11px] leading-5 text-slate-500">
                Uses the last eligible tracked/distraction preview item so clicking this button does not turn TimeFolio into the final target.
              </div>
            </div>

            {v2InspectorError ? (
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {v2InspectorError}
              </div>
            ) : null}

            {v2RecoveryDebugMessage ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  v2RecoveryDebugMessage.tone === "error"
                    ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                    : v2RecoveryDebugMessage.tone === "info"
                      ? "border-slate-600 bg-slate-950/40 text-slate-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {v2RecoveryDebugMessage.text}
              </div>
            ) : null}

            {v2RecoveryDebugWriteResult ? (
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-xs text-sky-50">
                <span>Debug write path: {v2RecoveryDebugWriteResult.writePath}</span>
                <span className="ml-3">
                  Read path: {v2RecoveryDebugWriteResult.readPath}
                </span>
                <span className="ml-3">
                  Bytes: {formatFileSize(v2RecoveryDebugWriteResult.bytesWritten)}
                </span>
                <span className="ml-3">
                  Readback events: {v2RecoveryDebugWriteResult.readbackEventsCount ?? 0}
                </span>
                <span className="ml-3">
                  Exists: {v2RecoveryDebugWriteResult.exists ? "Yes" : "No"}
                </span>
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

            {v2RecoveredStateSummary ? (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
                Recovered dev Auto-Tracker preview state. {v2RecoveredStateSummary.eventsCount} event
                {v2RecoveredStateSummary.eventsCount === 1 ? "" : "s"} and{" "}
                {v2RecoveredStateSummary.writtenPreviewSessionIdCount} written preview session id
                {v2RecoveredStateSummary.writtenPreviewSessionIdCount === 1 ? "" : "s"} restored.
              </div>
            ) : null}

            {v2RecoveredStateSummary ||
            v2RecoveryDiagnostics ||
            v2PersistedOpenPreviewSession ||
            v2PersistedRecoveryMessage ||
            v2PersistedRecoveryStatus !== "noEligibleSession" ? (
              <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Recovery
                    </div>
                    <div className="mt-1 text-sm text-cyan-50">
                      Status: {formatRecoveryStatus(recoveredPreviewAssessment.status)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleV2ReloadNativeRecoveryFile();
                      }}
                      disabled={v2IsBusy || v2IsRecoveryFinalizing || v2IsWritingSelectedSession}
                      className="rounded-lg border border-cyan-400/30 bg-slate-950/30 px-4 py-2 text-sm font-medium text-cyan-50 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Reload native recovery file
                    </button>
                    {recoveredPreviewAssessment.canFinalize ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleV2FinalizeRecoveredPreviewSession();
                        }}
                        disabled={v2IsRecoveryFinalizing || v2IsWritingSelectedSession}
                        className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-50 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {v2IsRecoveryFinalizing ? "Finalizing…" : "Finalize recovered session"}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-50/85">
                  <span>
                    Last persisted: {formatDateTimeFromMs(v2LastPersistedAtMs)}
                  </span>
                  <span>
                    Sampler was {v2RecoveredStateSummary?.lastSamplerRunning ? "running" : "stopped"}
                  </span>
                  <span>
                    Last sampler tick: {formatDateTimeFromMs(v2RecoveredStateSummary?.lastSamplerTickCompletedAtMs ?? null)}
                  </span>
                </div>

                {v2PersistedOpenPreviewSession ? (
                  <div className="rounded-lg border border-cyan-400/20 bg-slate-950/30 px-4 py-3 text-sm text-cyan-50">
                    <div className="font-medium">
                      Recovered active session: {v2PersistedOpenPreviewSession.matchedRuleName ?? v2PersistedOpenPreviewSession.targetLabel}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-50/80">
                      <span>
                        Classification: {v2PersistedOpenPreviewSession.classification}
                      </span>
                      <span>
                        Last seen: {formatDateTimeFromMs(v2PersistedOpenPreviewSession.lastSeenAtMs)}
                      </span>
                      <span>
                        Gap: {formatPreviewDuration(recoveredPreviewAssessment.gapMs)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-cyan-400/20 bg-slate-950/20 px-4 py-3 text-sm text-cyan-50/80">
                    No eligible tracked or distraction session was persisted for recovery.
                  </div>
                )}

                <div className="text-xs leading-5 text-cyan-50/80">
                  {v2PersistedRecoveryMessage ?? recoveredPreviewAssessment.message}
                </div>

                {v2RecoveryFinalizeMessage ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      v2RecoveryFinalizeMessage.tone === "error"
                        ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                        : v2RecoveryFinalizeMessage.tone === "info"
                          ? "border-slate-600 bg-slate-950/40 text-slate-200"
                          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                    }`}
                  >
                    {v2RecoveryFinalizeMessage.text}
                  </div>
                ) : null}

                {v2RecoveryDiagnostics ? (
                  <div className="rounded-lg border border-cyan-400/20 bg-slate-950/30 px-4 py-3 text-sm text-cyan-50">
                    <div className="text-[11px] font-medium text-slate-500">
                      Native recovery diagnostics
                    </div>
                    <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-cyan-50/85 sm:grid-cols-2">
                      <span className="sm:col-span-2">
                        Primary path: {v2RecoveryDiagnostics.primaryRecoveryFilePath}
                      </span>
                      <span className="sm:col-span-2">
                        Write path: {v2RecoveryDiagnostics.writeFilePath}
                      </span>
                      <span className="sm:col-span-2">
                        Read path: {v2RecoveryDiagnostics.readFilePath ?? "None"}
                      </span>
                      <span>Selected read source: {v2RecoveryDiagnostics.selectedReadSource}</span>
                      <span>Exists: {v2RecoveryDiagnostics.exists ? "Yes" : "No"}</span>
                      <span>Size: {formatFileSize(v2RecoveryDiagnostics.sizeBytes)}</span>
                      <span>Modified: {formatDateTimeFromMs(v2RecoveryDiagnostics.modifiedAtMs)}</span>
                      <span>
                        Schema: {v2RecoveryDiagnostics.parsedSchemaVersion ?? "Unreadable"}
                      </span>
                      <span>
                        Events: {v2RecoveryDiagnostics.eventsCount ?? 0}
                      </span>
                      <span>
                        Last write bytes: {formatFileSize(v2RecoveryDiagnostics.lastWriteByteCount)}
                      </span>
                      <span>
                        Exists after write:{" "}
                        {v2RecoveryDiagnostics.fileExistsAfterWrite === null
                          ? "Unknown"
                          : v2RecoveryDiagnostics.fileExistsAfterWrite
                            ? "Yes"
                            : "No"}
                      </span>
                      <span>
                        Readback events: {v2RecoveryDiagnostics.readbackAfterWriteEventsCount ?? 0}
                      </span>
                      <span>
                        Last app: {v2RecoveryDiagnostics.lastObservedAppName ?? "Unknown"}
                      </span>
                      <span>
                        Last title: {v2RecoveryDiagnostics.lastObservedBrowserTitle ?? "Unknown"}
                      </span>
                      <span className="sm:col-span-2">
                        Last URL: {v2RecoveryDiagnostics.lastObservedBrowserUrl ?? "Unknown"}
                      </span>
                    </div>
                    <div className="mt-3 rounded-md border border-cyan-400/10 bg-slate-950/40 px-3 py-2 text-[11px] leading-5 text-cyan-50/75">
                      Terminal verification: {recoveryTerminalCommand}
                    </div>
                    {v2RecoveryDiagnostics.fallbackCandidates.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-2">
                        <div className="text-[11px] font-medium text-slate-500">
                          Fallback candidates
                        </div>
                        {v2RecoveryDiagnostics.fallbackCandidates.map((candidate) => (
                          <div
                            key={`${candidate.source}:${candidate.recoveryFilePath}`}
                            className="rounded-md border border-cyan-400/10 bg-slate-950/30 px-3 py-2 text-[11px] leading-5 text-cyan-50/75"
                          >
                            <div className="break-all">{candidate.recoveryFilePath}</div>
                            <div>
                              Exists: {candidate.exists ? "Yes" : "No"} · Events:{" "}
                              {candidate.eventsCount ?? 0} · Parse:{" "}
                              {candidate.readError
                                ? candidate.readError
                                : candidate.exists
                                  ? "Readable"
                                  : "Missing"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {v2RecoveryDiagnostics.readError ? (
                      <div className="mt-2 text-xs text-amber-200">
                        Read error: {v2RecoveryDiagnostics.readError}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {v2PersistenceError ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {v2PersistenceError}
              </div>
            ) : null}

            {v2StopFinalizeMessage ? (
              <div
                className={`rounded-xl border px-4 py-3 text-sm ${
                  v2StopFinalizeMessage.tone === "error"
                    ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                    : v2StopFinalizeMessage.tone === "info"
                      ? "border-slate-600 bg-slate-950/40 text-slate-200"
                      : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {v2StopFinalizeMessage.text}
              </div>
            ) : null}

            {FF.autotrackerV2NativeSampler && v2SamplerStatus ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">
                    Native sampler: {v2SamplerStatus.running ? "Running" : "Stopped"}
                  </span>
                  <span className="text-emerald-100/75">
                    Tick count: {v2SamplerStatus.tickCount}
                  </span>
                  <span className="text-emerald-100/75">
                    Last completed: {formatTimeOfDayFromMs(v2SamplerStatus.lastTickCompletedAtMs)}
                  </span>
                  <span className="text-emerald-100/75">
                    Last appended: {v2SamplerStatus.lastAppendedCount}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-emerald-100/75">
                  <span>Interval: {v2SamplerStatus.intervalMs}ms</span>
                  {v2SamplerStatus.recoveryFilePath ? (
                    <span>Primary recovery path: {v2SamplerStatus.recoveryFilePath}</span>
                  ) : null}
                  {v2SamplerStatus.recoveryWritePath ? (
                    <span>Write path: {v2SamplerStatus.recoveryWritePath}</span>
                  ) : null}
                  {v2SamplerStatus.recoveryReadPath ? (
                    <span>Read path: {v2SamplerStatus.recoveryReadPath}</span>
                  ) : null}
                  <span>Recovery writes: {v2SamplerStatus.recoveryWriteCount}</span>
                  <span>
                    Last recovery write: {formatDateTimeFromMs(v2SamplerStatus.lastRecoveryWriteAtMs)}
                  </span>
                  <span>
                    Recovery events: {v2SamplerStatus.lastRecoveryEventsCount}
                  </span>
                  <span>
                    Last write bytes: {formatFileSize(v2SamplerStatus.lastRecoveryWriteByteCount)}
                  </span>
                  <span>
                    Readback events: {v2SamplerStatus.lastRecoveryReadbackEventsCount ?? 0}
                  </span>
                  <span>
                    File exists after write:{" "}
                    {v2SamplerStatus.recoveryFileExistsAfterWrite === null
                      ? "Unknown"
                      : v2SamplerStatus.recoveryFileExistsAfterWrite
                        ? "Yes"
                        : "No"}
                  </span>
                  {v2SamplerStatus.lastObservedAppName ? (
                    <span>
                      Last app: {v2SamplerStatus.lastObservedAppName}
                      {v2SamplerStatus.lastObservedBundleId
                        ? ` (${v2SamplerStatus.lastObservedBundleId})`
                        : ""}
                    </span>
                  ) : null}
                  {v2SamplerStatus.lastRecoveryWriteError ? (
                    <span className="text-amber-200">
                      Recovery write error: {v2SamplerStatus.lastRecoveryWriteError}
                    </span>
                  ) : (
                    <span>Recovery write error: None</span>
                  )}
                  {v2SamplerStatus.lastError ? (
                    <span className="text-amber-200">Last error: {v2SamplerStatus.lastError}</span>
                  ) : (
                    <span>Last error: None</span>
                  )}
                </div>
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
                  value={`${v2SamplerStatus?.bufferCount ?? v2ProbeStatus.bufferLen} / ${v2ProbeStatus.bufferCapacity}`}
                  detail="Buffered events / capacity"
                />
                <DataStatCard
                  label="Last sampled"
                  value={formatTimeOfDayFromMs(v2ProbeStatus.lastSampledAtMs)}
                  detail={`Platform: ${v2ProbeStatus.platform}`}
                />
                <DataStatCard
                  label="Persisted Dev State"
                  value={
                    v2LastPersistedAtMs
                      ? v2RecoveredStateSummary
                        ? "Recovered"
                        : "Stored"
                      : "None"
                  }
                  detail={`Recovered events: ${v2RecoveryDiagnostics?.eventsCount ?? v2RecoveredStateSummary?.eventsCount ?? 0} · Written ids: ${v2WrittenPreviewSessionIds.size} · Last saved: ${formatTimeOfDayFromMs(v2LastPersistedAtMs)}`}
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-5 text-sm text-slate-500">
                Click Probe or Capture once to load V2 native status.
              </div>
            )}

            <div className="rounded-xl border border-slate-700 bg-slate-950/40 px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500">Last detected app</div>
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
                <div className="text-[11px] font-medium text-slate-500">
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
                <div className="text-[11px] font-medium text-slate-500">
                  Preview spans (read-only)
                </div>
                <span className="text-[10px] text-slate-600">Preview only — no sessions written.</span>
                <span className="text-[10px] text-slate-600">
                  Classification uses saved tracker rules. Changes are saved automatically.
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
                  <div className="text-[11px] font-medium text-slate-500">
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
                    <div className="text-[10px] text-slate-500">
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
                    <div className="text-[10px] text-slate-500">
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
                {FF.autotrackerV2ContinuousWrite ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <div className="text-[11px] font-medium text-slate-500">
                        Continuous writer
                      </div>
                      <span className="text-[10px] text-cyan-50/80">
                        Dev continuous write enabled — writes finalized tracked and distraction preview sessions from manual captures or the native sampler.
                      </span>
                    </div>

                    {v2ContinuousWriteStatus ? (
                      <div
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          v2ContinuousWriteStatus.error
                            ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                        }`}
                      >
                        <div>
                          Wrote {v2ContinuousWriteStatus.writtenCount} finalized preview session
                          {v2ContinuousWriteStatus.writtenCount === 1 ? "" : "s"} automatically.
                        </div>
                        {v2ContinuousWriteStatus.names.length > 0 ? (
                          <div className="mt-1">
                            {v2ContinuousWriteStatus.names.join(", ")}
                          </div>
                        ) : null}
                        {v2ContinuousWriteStatus.skippedDuplicateCount > 0 ? (
                          <div className="mt-1">
                            Skipped {v2ContinuousWriteStatus.skippedDuplicateCount} duplicate preview
                            session
                            {v2ContinuousWriteStatus.skippedDuplicateCount === 1 ? "" : "s"}.
                          </div>
                        ) : null}
                        {v2ContinuousWriteStatus.error ? (
                          <div className="mt-1">{v2ContinuousWriteStatus.error}</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                        Waiting for newly finalized tracked or distraction preview sessions from manual captures or the native sampler.
                      </div>
                    )}
                  </div>
                ) : null}
                {FF.autotrackerV2ManualWrite ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <div
                        className={themeAwareWarmAccent(
                          themeId,
                          "text-xs font-medium uppercase tracking-[0.18em] text-orange-200",
                          "text-xs font-medium uppercase tracking-[0.18em] text-amber-200",
                        )}
                      >
                        Manual writer
                      </div>
                      <span
                        className={themeAwareWarmAccent(
                          themeId,
                          "text-[10px] text-orange-100/80",
                          "text-[10px] text-amber-100/80",
                        )}
                      >
                        Dev manual write — writes one finalized tracked or distraction preview session to Session Log.
                      </span>
                    </div>

                    {v2ManualWriteMessage ? (
                      <div
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          v2ManualWriteMessage.tone === "error"
                            ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
                            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                        }`}
                      >
                        {v2ManualWriteMessage.text}
                      </div>
                    ) : null}

                    {finalizedPreviewSessions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/40 px-4 py-4 text-sm text-slate-400">
                        No finalized preview sessions available to write.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col divide-y divide-slate-800 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
                          {finalizedPreviewSessions.map((session) => {
                            const isSelected =
                              session.previewSessionId === v2ManualWriteSelectionId;
                            const alreadyWritten = v2WrittenPreviewSessionIds.has(
                              session.previewSessionId,
                            );

                            return (
                              <label
                                key={session.previewSessionId}
                                className={`flex cursor-pointer gap-3 px-3 py-3 text-sm ${
                                  isSelected ? "bg-amber-500/10" : ""
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="autotracker-v2-finalized-preview-session"
                                  value={session.previewSessionId}
                                  checked={isSelected}
                                  onChange={(event) => {
                                    setV2ManualWriteSelectionId(event.target.value);
                                    setV2ManualWriteMessage(null);
                                  }}
                                  className="mt-0.5 accent-amber-400"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <span className="font-semibold text-slate-100">
                                      {session.targetLabel}
                                    </span>
                                    <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                                      {formatPreviewDuration(session.durationMs)}
                                    </span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                        session.isDistraction
                                          ? "border border-rose-500/20 bg-rose-500/10 text-rose-200"
                                          : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                                      }`}
                                    >
                                      {session.isDistraction ? "distraction" : "tracked"}
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500">
                                      {session.sourceTargetStableId}
                                    </span>
                                    {alreadyWritten ? (
                                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                                        written
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    {session.classificationReason}
                                  </div>
                                  {session.browserTitle ? (
                                    <div className="mt-1 text-xs text-slate-300">
                                      {session.browserTitle}
                                    </div>
                                  ) : null}
                                  {session.browserUrl ? (
                                    <div className="mt-1 font-mono text-xs text-violet-300 break-all">
                                      {session.browserUrl}
                                    </div>
                                  ) : null}
                                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                    <span>
                                      {new Intl.DateTimeFormat(undefined, {
                                        timeStyle: "medium",
                                      }).format(new Date(session.startedAtMs))}
                                    </span>
                                    <span>→</span>
                                    <span>
                                      {new Intl.DateTimeFormat(undefined, {
                                        timeStyle: "medium",
                                      }).format(new Date(session.endedAtMs))}
                                    </span>
                                    <span>·</span>
                                    <span>{session.sourceSpanIds.length} spans</span>
                                    <span>·</span>
                                    <span>{session.sourceEventIds.length} events</span>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            void handleV2WriteSelectedFinalizedPreviewSession(
                              selectedFinalizedPreviewSession,
                            );
                          }}
                          disabled={
                            selectedFinalizedPreviewSession === null ||
                            selectedFinalizedPreviewSessionAlreadyWritten ||
                            v2IsWritingSelectedSession
                          }
                          className="rounded-lg border border-amber-500/30 bg-amber-500/20 px-4 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {v2IsWritingSelectedSession
                            ? "Writing selected finalized preview session…"
                            : "Write selected finalized preview session"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
          </div>
        </div>
        </section>
        );
      })()}

    </div>
  );
}
