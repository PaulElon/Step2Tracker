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
  getAutoTrackerV2NativeSamplerStatus,
  probeAutoTrackerV2Native,
  snapshotAutoTrackerV2Native,
  startAutoTrackerV2NativeSampler,
  stopAutoTrackerV2NativeSampler,
  type AutoTrackerV2NativeCaptureResult,
  type AutoTrackerV2NativeSamplerStatus,
  type AutoTrackerV2NativeSnapshot,
  type AutoTrackerV2NativeStatus,
} from "../../lib/tf-autotracker-v2-native-events";
import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../lib/tf-autotracker-v2-preview-spans";
import {
  buildAutoTrackerV2ReducerPreview,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2ContinuousWritePreviewSessions,
  type TfAutotrackerV2FinalizedPreviewSession,
} from "../../lib/tf-autotracker-v2-reducer-preview";
import type { NativeTrackerSpanInput } from "../../lib/tf-native-span-reconciler";
import { deriveTfTrackerRuleName, normalizeTfAppState } from "../../lib/tf-storage";
import { cn, fieldClassName, iconButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import { useTimeFolioStore } from "../../state/tf-store";
import type { TfAppState, TfTrackerPrefs, TfTrackerRule, TfTrackerRuleKind } from "../../types/models";

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
      app: "/Applications/Anki.app",
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
      app: "/Applications/ChatGPT.app",
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
                      <p className="mt-0.5 truncate text-xs text-slate-400">{row.rule.target}</p>
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
          <p className="truncate px-1 pt-2 text-xs text-slate-400">{pendingTarget}</p>
        ) : null}
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
                <p className="mt-1 text-sm text-slate-200">4. Choose Copy “App” as Pathname, then paste it below.</p>
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

export function TrackerSettingsPanel() {
  const { state, isLoading, error, reload, reset, saveState, importNativeSpans, upsertSessionLog } = useTimeFolioStore();
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
  const [v2ContinuousWriteStatus, setV2ContinuousWriteStatus] = useState<{
    writtenCount: number;
    names: string[];
    skippedDuplicateCount: number;
    error: string | null;
  } | null>(null);
  const [v2IsWritingSelectedSession, setV2IsWritingSelectedSession] = useState(false);

  const v2DelayIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const v2WritingPreviewSessionIdsRef = useRef<Set<string>>(new Set());

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
    };
  }, []);

  useEffect(() => {
    if (!FF.autotrackerV2NativeInspector && !FF.autotrackerV2NativeSampler) {
      return;
    }

    void getAutoTrackerV2NativeSamplerStatus()
      .then((status) => {
        setV2SamplerStatus(status);
      })
      .catch(() => {
        // Leave existing inspector state alone if sampler diagnostics are unavailable.
      });
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
    if (!FF.autotrackerV2NativeSampler || !isSamplerRunning) {
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
        onAction={reload}
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
    } as TfTrackerPrefs;

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

  async function refreshV2SnapshotAndSamplerStatus() {
    const [snapshot, samplerStatus] = await Promise.all([
      snapshotAutoTrackerV2Native(),
      FF.autotrackerV2NativeSampler ? getAutoTrackerV2NativeSamplerStatus() : Promise.resolve(null),
    ]);

    setV2Snapshot(snapshot);
    setV2ProbeStatus(snapshot.status);
    if (samplerStatus) {
      setV2SamplerStatus(samplerStatus);
    }
  }

  async function handleV2Probe() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const [status, samplerStatus] = await Promise.all([
        probeAutoTrackerV2Native(),
        FF.autotrackerV2NativeSampler
          ? getAutoTrackerV2NativeSamplerStatus()
          : Promise.resolve(null),
      ]);
      setV2ProbeStatus(status);
      if (samplerStatus) {
        setV2SamplerStatus(samplerStatus);
      }
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

  async function handleV2ClearBuffer() {
    setV2InspectorError(null);
    setV2IsBusy(true);
    try {
      const status = await clearAutoTrackerV2NativeBuffer();
      setV2ProbeStatus(status);
      if (FF.autotrackerV2NativeSampler) {
        const samplerStatus = await getAutoTrackerV2NativeSamplerStatus();
        setV2SamplerStatus(samplerStatus);
      }
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

  async function handleV2StartNativeSampler() {
    setV2InspectorError(null);
    setV2SamplerActionBusy(true);
    try {
      const samplerStatus = await startAutoTrackerV2NativeSampler();
      setV2SamplerStatus(samplerStatus);
      await refreshV2SnapshotAndSamplerStatus();
    } catch (err) {
      setV2InspectorError(
        err instanceof Error && err.message ? err.message : "Unable to start native sampler.",
      );
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
      setV2InspectorError(
        err instanceof Error && err.message ? err.message : "Unable to stop native sampler.",
      );
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
      if (current.has(previewSession.previewSessionId)) {
        return current;
      }
      const next = new Set(current);
      next.add(previewSession.previewSessionId);
      return next;
    });
    return sessionLog.method;
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

      {FF.autotrackerV2NativeInspector || FF.autotrackerV2NativeSampler ? (() => {
        const lastAppEvent = v2Snapshot
          ? [...v2Snapshot.events]
              .reverse()
              .find((e) => (e.kind === "targetFocused" || e.kind === "untrackedFocused") && e.appName)
          : undefined;

        const isDelayPending = v2DelayCountdown !== null;
        const anyBusy = v2IsBusy || v2SamplerActionBusy || isDelayPending;

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
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                    Dev inspector state is temporary; buffer/preview resets when leaving this page or restarting.
                  </p>
                </div>
                <div className="inline-flex w-fit rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-200">
                  Manual capture remains the source of truth. Native sampler is Rust-owned and dev-only.
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleV2Probe}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-violet-500/30 bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {v2IsBusy ? "…" : "Probe"}
                </button>
                <button
                  type="button"
                  onClick={handleV2CaptureOnce}
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
                    onClick={isSamplerRunning ? handleV2StopNativeSampler : handleV2StartNativeSampler}
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
                  onClick={handleV2RefreshSnapshot}
                  disabled={anyBusy || isSamplerRunning}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Refresh snapshot
                </button>
                <button
                  type="button"
                  onClick={handleV2ClearBuffer}
                  disabled={anyBusy || isSamplerRunning}
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
                  {v2SamplerStatus.lastObservedAppName ? (
                    <span>
                      Last app: {v2SamplerStatus.lastObservedAppName}
                      {v2SamplerStatus.lastObservedBundleId
                        ? ` (${v2SamplerStatus.lastObservedBundleId})`
                        : ""}
                    </span>
                  ) : null}
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
                {FF.autotrackerV2ContinuousWrite ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-100">
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
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-200">
                        Manual writer
                      </div>
                      <span className="text-[10px] text-amber-100/80">
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
      })() : null}

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
    </div>
  );
}
