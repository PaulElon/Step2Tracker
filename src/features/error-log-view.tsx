import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit2, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { MetricCard } from "../components/ui";
import { ModalShell } from "../components/modal-shell";
import { RichTextEditor, RichTextRender, richTextToPlain } from "../components/rich-text-editor";
import { primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import {
  ERROR_LOG_FOLLOW_UP_ACTION_VALUES,
  ERROR_LOG_ERROR_TYPE_VALUES,
  ERROR_LOG_SOURCE_VALUES,
  ERROR_LOG_SYSTEM_VALUES,
} from "../lib/storage";
import { useAppStore } from "../state/app-store";
import type {
  ErrorLogEntry,
  ErrorLogErrorType,
  ErrorLogFollowUpAction,
  ErrorLogInput,
  ErrorLogPriority,
  ErrorLogSource,
  ErrorLogSystem,
  WeakTopicInput,
  WeakTopicPriority,
} from "../types/models";

type SortKey = "newest" | "system" | "topic" | "errorType" | "priority";

const PRIORITY_PILL: Record<ErrorLogPriority, string> = {
  high: "border-white/10 bg-white/[0.04] text-slate-300",
  medium: "border-white/10 bg-white/[0.04] text-slate-300",
  low: "border-white/10 bg-white/[0.04] text-slate-300",
};

const PRIORITY_CARD_ACCENT: Record<ErrorLogPriority, string> = {
  high: "border-l-rose-400/80 shadow-[inset_3px_0_0_rgba(251,113,133,0.72)]",
  medium: "border-l-amber-400/70 shadow-[inset_3px_0_0_rgba(251,191,36,0.58)]",
  low: "border-l-slate-500/70 shadow-[inset_3px_0_0_rgba(100,116,139,0.46)]",
};

const NEUTRAL_TAG = "border-white/10 bg-white/[0.04] text-slate-300";

const FOLLOW_UP_ACTION_LABELS: Record<ErrorLogFollowUpAction, string> = {
  "": "No follow-up set",
  "make-anki": "Make Anki",
  "do-10-targeted-questions": "Do 10 targeted questions",
  "review-algorithm": "Review algorithm",
  "add-to-final-sheet": "Add to final sheet",
  "ignore-one-off-detail": "Ignore one-off detail",
};

const REVIEW_SECTION_CLASS = "min-w-0 overflow-hidden rounded-lg border border-white/[0.07] bg-slate-950/25 p-1.5";
const FILTER_FIELD_CLASS = "h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30";

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${className}`}>
      {children}
    </span>
  );
}

function modeCount<T extends string>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top = values[0];
  let topCount = 0;
  for (const [k, c] of counts) {
    if (c > topCount) { top = k; topCount = c; }
  }
  return top;
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed right-4 top-4 z-50 rounded-xl border border-emerald-500/30 bg-slate-900/95 px-4 py-3 text-sm text-emerald-200 shadow-lg backdrop-blur">
      {message}
    </div>
  );
}

function exportCsv(entries: ErrorLogEntry[]) {
  const headers = [
    "Source",
    "Exam/Block",
    "System",
    "Topic",
    "Error Type",
    "Priority",
    "Missed Pattern",
    "Why Picked Wrong Answer",
    "Why Correct Answer Is Correct",
    "Why Tempting Wrong Answer Is Wrong",
    "Decision Rule",
    "Fix",
    "Repeat Miss",
    "Follow-Up Action",
    "Guessed Correct",
    "Add To Final Sheet",
    "Date",
  ];
  const rows = entries.map((e) => [
    e.source,
    e.examBlock,
    e.system,
    e.topic,
    e.errorType,
    e.priority,
    richTextToPlain(e.missedPattern),
    e.whyPickedWrongAnswer,
    e.whyCorrectAnswerIsCorrect,
    e.whyTemptingWrongAnswerIsWrong,
    e.decisionRule,
    richTextToPlain(e.fix),
    e.isRepeatMiss ? "Yes" : "No",
    FOLLOW_UP_ACTION_LABELS[e.followUpAction] ?? e.followUpAction,
    e.isGuessedCorrect ? "Yes" : "No",
    e.addToFinalSheet ? "Yes" : "No",
    e.entryDate || e.createdAt.slice(0, 10),
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `exam-error-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM: ErrorLogInput = {
  source: "UWorld",
  examBlock: "",
  system: "IM/FM",
  topic: "",
  errorType: "Knowledge Gap",
  missedPattern: "",
  fix: "",
  whyPickedWrongAnswer: "",
  whyCorrectAnswerIsCorrect: "",
  whyTemptingWrongAnswerIsWrong: "",
  decisionRule: "",
  isRepeatMiss: false,
  followUpAction: "",
  isGuessedCorrect: false,
  addToFinalSheet: false,
  priority: "medium",
  entryDate: todayIso(),
};

type FormErrors = Partial<Record<keyof ErrorLogInput, string>>;

function validateForm(draft: ErrorLogInput): FormErrors {
  const errors: FormErrors = {};
  if (!draft.source.trim()) errors.source = "Required";
  if (!draft.system.trim()) errors.system = "Required";
  if (!draft.topic.trim()) errors.topic = "Required";
  if (!draft.errorType.trim()) errors.errorType = "Required";
  if (!richTextToPlain(draft.missedPattern).trim()) errors.missedPattern = "Required";
  if (!richTextToPlain(draft.fix).trim()) errors.fix = "Required";
  return errors;
}

const PRIORITY_SORT_ORDER: Record<ErrorLogPriority, number> = { high: 0, medium: 1, low: 2 };

function describeNextReview(entry: ErrorLogEntry) {
  const parts = [
    entry.followUpAction ? FOLLOW_UP_ACTION_LABELS[entry.followUpAction] ?? entry.followUpAction : "",
    entry.isRepeatMiss ? "repeat miss" : "",
    entry.addToFinalSheet ? "final sheet" : "",
  ].filter(Boolean);

  if (!parts.length) {
    return "No follow-up set";
  }

  return parts.join(" / ");
}

function LogEntryModal({
  initial,
  onClose,
  onSave,
}: {
  initial: ErrorLogEntry | null;
  onClose: () => void;
  onSave: (input: ErrorLogInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ErrorLogInput>(() =>
    initial
      ? {
          id: initial.id,
          source: initial.source,
          examBlock: initial.examBlock,
          system: initial.system,
          topic: initial.topic,
          errorType: initial.errorType,
          missedPattern: initial.missedPattern,
          fix: initial.fix,
          whyPickedWrongAnswer: initial.whyPickedWrongAnswer,
          whyCorrectAnswerIsCorrect: initial.whyCorrectAnswerIsCorrect,
          whyTemptingWrongAnswerIsWrong: initial.whyTemptingWrongAnswerIsWrong,
          decisionRule: initial.decisionRule,
          isRepeatMiss: initial.isRepeatMiss,
          followUpAction: initial.followUpAction,
          isGuessedCorrect: initial.isGuessedCorrect,
          addToFinalSheet: initial.addToFinalSheet,
          priority: initial.priority ?? "medium",
          entryDate: initial.entryDate || initial.createdAt.slice(0, 10),
        }
      : { ...EMPTY_FORM, entryDate: todayIso() },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextDraft = {
      ...draft,
      followUpAction:
        draft.isRepeatMiss && !draft.followUpAction ? "make-anki" : draft.followUpAction,
    } satisfies ErrorLogInput;
    const next = validateForm(nextDraft);
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    setSaving(true);
    try {
      await onSave(nextDraft);
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40";
  const selectClass = fieldClass;

  return (
    <ModalShell onClose={onClose} position="center" titleId="log-entry-title" contentClassName="max-w-[720px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{isEdit ? "Edit entry" : "New entry"}</p>
          <h3 id="log-entry-title" className="mt-2 text-2xl font-semibold text-white">
            {isEdit ? "Edit Log entry" : "Log entry"}
          </h3>
        </div>
        <button type="button" className={secondaryButtonClassName} onClick={onClose}>
          Close
        </button>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="mt-6 space-y-4"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Source</label>
            <select
              value={draft.source}
              onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as ErrorLogSource }))}
              className={`${selectClass} mt-1`}
            >
              {ERROR_LOG_SOURCE_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Exam / Block</label>
            <input
              value={draft.examBlock}
              onChange={(e) => setDraft((d) => ({ ...d, examBlock: e.target.value }))}
              placeholder="Block 2"
              className={`${fieldClass} mt-1`}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">System</label>
            <select
              value={draft.system}
              onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value as ErrorLogSystem }))}
              className={`${selectClass} mt-1`}
            >
              {ERROR_LOG_SYSTEM_VALUES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Topic</label>
            <input
              value={draft.topic}
              onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
              placeholder="Aortic dissection"
              className={`${fieldClass} mt-1`}
            />
            {errors.topic ? <p className="mt-1 text-xs text-rose-400">{errors.topic}</p> : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Error Type</label>
            <select
              value={draft.errorType}
              onChange={(e) => setDraft((d) => ({ ...d, errorType: e.target.value as ErrorLogErrorType }))}
              className={`${selectClass} mt-1`}
            >
              {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Priority</label>
            <select
              value={draft.priority}
              onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as ErrorLogPriority }))}
              className={`${selectClass} mt-1`}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Date</label>
            <input
              type="date"
              value={draft.entryDate}
              onChange={(e) => setDraft((d) => ({ ...d, entryDate: e.target.value }))}
              className={`${fieldClass} mt-1`}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Missed Pattern
          </label>
          <RichTextEditor
            value={draft.missedPattern}
            onChange={(html) => setDraft((d) => ({ ...d, missedPattern: html }))}
            placeholder="What did you miss?"
            minLines={3}
            scrollable
            className="mt-1"
          />
          {errors.missedPattern ? <p className="mt-1 text-xs text-rose-400">{errors.missedPattern}</p> : null}
        </div>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Fix</label>
          <RichTextEditor
            value={draft.fix}
            onChange={(html) => setDraft((d) => ({ ...d, fix: html }))}
            placeholder="What will you do differently?"
            minLines={3}
            scrollable
            className="mt-1"
          />
          {errors.fix ? <p className="mt-1 text-xs text-rose-400">{errors.fix}</p> : null}
        </div>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Reasoning / correction
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Why I picked wrong answer
              </label>
              <textarea
                value={draft.whyPickedWrongAnswer}
                onChange={(e) => setDraft((d) => ({ ...d, whyPickedWrongAnswer: e.target.value }))}
                rows={3}
                className={`${fieldClass} mt-1 resize-y`}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Why correct answer is correct
              </label>
              <textarea
                value={draft.whyCorrectAnswerIsCorrect}
                onChange={(e) => setDraft((d) => ({ ...d, whyCorrectAnswerIsCorrect: e.target.value }))}
                rows={3}
                className={`${fieldClass} mt-1 resize-y`}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Why tempting wrong answer is wrong
              </label>
              <textarea
                value={draft.whyTemptingWrongAnswerIsWrong}
                onChange={(e) => setDraft((d) => ({ ...d, whyTemptingWrongAnswerIsWrong: e.target.value }))}
                rows={3}
                className={`${fieldClass} mt-1 resize-y`}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Decision rule / algorithm
              </label>
              <textarea
                value={draft.decisionRule}
                onChange={(e) => setDraft((d) => ({ ...d, decisionRule: e.target.value }))}
                rows={3}
                className={`${fieldClass} mt-1 resize-y`}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                Follow-up action
              </label>
              <select
                value={draft.followUpAction}
                onChange={(e) => setDraft((d) => ({ ...d, followUpAction: e.target.value as ErrorLogFollowUpAction }))}
                className={`${selectClass} mt-1`}
              >
                {ERROR_LOG_FOLLOW_UP_ACTION_VALUES.map((action) => (
                  <option key={action || "none"} value={action}>
                    {FOLLOW_UP_ACTION_LABELS[action]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.isRepeatMiss}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      isRepeatMiss: e.target.checked,
                      followUpAction: e.target.checked && !d.followUpAction ? "make-anki" : d.followUpAction,
                    }))
                  }
                  className="h-4 w-4 accent-cyan-400"
                />
                Repeat miss
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.isGuessedCorrect}
                  onChange={(e) => setDraft((d) => ({ ...d, isGuessedCorrect: e.target.checked }))}
                  className="h-4 w-4 accent-cyan-400"
                />
                Guessed correct
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-300">
                <input
                  type="checkbox"
                  checked={draft.addToFinalSheet}
                  onChange={(e) => setDraft((d) => ({ ...d, addToFinalSheet: e.target.checked }))}
                  className="h-4 w-4 accent-cyan-400"
                />
                Add to final sheet
              </label>
            </div>
          </div>
        </section>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" className={secondaryButtonClassName} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClassName} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Log entry"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ErrorLogView() {
  const { state, upsertErrorLogEntry, trashErrorLogEntry, upsertWeakTopic } = useAppStore();
  const entries = state.errorLogEntries;

  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [search, setSearch] = useState("");
  const [filterSource, setFilterSource] = useState<ErrorLogSource | "All">("All");
  const [filterSystem, setFilterSystem] = useState<ErrorLogSystem | "All">("All");
  const [filterErrorType, setFilterErrorType] = useState<ErrorLogErrorType | "All">("All");
  const [filterPriority, setFilterPriority] = useState<ErrorLogPriority | "All">("All");
  const [showFilters, setShowFilters] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ErrorLogEntry | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addedWeakTopicIds, setAddedWeakTopicIds] = useState<Set<string>>(new Set());
  const [expandedEntryIds, setExpandedEntryIds] = useState<Set<string>>(new Set());
  const deferredSearch = useDeferredValue(search);
  const topicRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    return entries.filter((e) => {
      if (filterSource !== "All" && e.source !== filterSource) return false;
      if (filterSystem !== "All" && e.system !== filterSystem) return false;
      if (filterErrorType !== "All" && e.errorType !== filterErrorType) return false;
      if (filterPriority !== "All" && (e.priority ?? "medium") !== filterPriority) return false;
      if (
        q &&
        !`${e.topic} ${e.source} ${e.examBlock} ${richTextToPlain(e.missedPattern)} ${e.whyPickedWrongAnswer} ${e.whyCorrectAnswerIsCorrect} ${e.decisionRule}`
          .toLowerCase()
          .includes(q)
      ) return false;
      return true;
    });
  }, [entries, deferredSearch, filterSource, filterSystem, filterErrorType, filterPriority]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === "newest") return b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "system") return a.system.localeCompare(b.system) || b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "topic") return a.topic.localeCompare(b.topic);
      if (sortKey === "errorType") return a.errorType.localeCompare(b.errorType) || b.createdAt.localeCompare(a.createdAt);
      if (sortKey === "priority") {
        const pa = PRIORITY_SORT_ORDER[a.priority ?? "medium"] ?? 1;
        const pb = PRIORITY_SORT_ORDER[b.priority ?? "medium"] ?? 1;
        return pa - pb || b.createdAt.localeCompare(a.createdAt);
      }
      return 0;
    });
  }, [filtered, sortKey]);

  const mostCommonErrorType = modeCount(entries.map((e) => e.errorType));
  const mostCommonSystem = modeCount(entries.map((e) => e.system));
  const topRepeatedWeakTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.isRepeatMiss) continue;
      const topic = entry.topic.trim();
      if (!topic) continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5);
  }, [entries]);
  const activeFilterCount = [
    filterSource !== "All",
    filterSystem !== "All",
    filterErrorType !== "All",
    filterPriority !== "All",
    sortKey !== "newest",
  ].filter(Boolean).length;

  async function handleSave(input: ErrorLogInput) {
    await upsertErrorLogEntry(input);
    setShowModal(false);
    setEditingEntry(null);
    setTimeout(() => topicRef.current?.focus(), 50);
  }

  async function handleDelete(id: string) {
    await trashErrorLogEntry(id);
    setConfirmDeleteId(null);
  }

  async function handleAddWeakTopic(entry: ErrorLogEntry) {
    const capitalizedPriority = (
      (entry.priority ?? "medium").charAt(0).toUpperCase() +
      (entry.priority ?? "medium").slice(1)
    ) as WeakTopicPriority;

    const notesText = [
      entry.system,
      entry.errorType,
      richTextToPlain(entry.missedPattern),
      richTextToPlain(entry.fix),
    ].filter(Boolean).join(" | ");

    const input: WeakTopicInput = {
      topic: entry.topic,
      entryType: "manual",
      priority: capitalizedPriority,
      status: "Active",
      notes: notesText,
      lastSeenAt: entry.entryDate || entry.createdAt.slice(0, 10),
      sourceLabel: entry.source,
    };

    await upsertWeakTopic(input);
    setAddedWeakTopicIds((prev) => new Set([...prev, entry.id]));
    setToast(`Added "${entry.topic}" as a weak topic.`);
  }

  function toggleExpandedEntry(id: string) {
    setExpandedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3 pb-6">
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

      {/* Row 1 — Metric cards */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total logged" value={String(entries.length)} />
        <MetricCard label="Most common error type" value={mostCommonErrorType ?? "—"} />
        <MetricCard label="Most common category" value={mostCommonSystem ?? "—"} />
        <div className="panel-subtle flex min-h-[132px] min-w-0 flex-col justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Top repeated weak topics</p>
            {topRepeatedWeakTopics.length ? (
              <div className="mt-3 space-y-1.5">
                {topRepeatedWeakTopics.slice(0, 3).map(([topic, count]) => (
                  <div key={topic} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-200">{topic}</span>
                    <span className="shrink-0 text-slate-500">{count}x</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm font-medium text-slate-300">No repeated misses yet</p>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {topRepeatedWeakTopics.length ? `${topRepeatedWeakTopics.length} tracked` : "Ready when patterns repeat"}
          </p>
        </div>
      </div>

      {/* Entries list — fills remaining space */}
      <section className="glass-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header + controls stay fixed while cards scroll */}
        <div className="shrink-0 border-b border-white/[0.07] pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">
              Entries
              {sorted.length !== entries.length ? (
                <span className="ml-1.5 text-xs font-normal text-slate-400">
                  ({sorted.length} of {entries.length})
                </span>
              ) : null}
            </p>
          </div>

          {/* Search + compact filters (only visible when there are entries) */}
          {entries.length > 0 ? (
            <>
              <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(18rem,1fr)_auto]">
                <input
                  type="text"
                  placeholder="Search topic, source, pattern..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 min-w-0 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                />
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowFilters((value) => !value)}
                    className={`${secondaryButtonClassName} h-10 shrink-0`}
                    aria-expanded={showFilters}
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
                  </button>
                  <button
                    type="button"
                    className={`${primaryButtonClassName} h-10 shrink-0`}
                    onClick={() => {
                      setEditingEntry(null);
                      setShowModal(true);
                    }}
                    title="Log a new entry"
                  >
                    <Plus className="h-4 w-4" />
                    Log entry
                  </button>
                  <button
                    type="button"
                    className={`${secondaryButtonClassName} h-10 shrink-0`}
                    onClick={() => exportCsv(sorted)}
                    title="Export CSV"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </button>
                </div>
              </div>

              {showFilters ? (
                <div className="mt-2 rounded-xl border border-white/[0.08] bg-slate-950/35 p-3">
                  <div className="grid gap-2 md:grid-cols-5">
                    <label className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Source</span>
                      <select
                        value={filterSource}
                        onChange={(e) => setFilterSource(e.target.value as ErrorLogSource | "All")}
                        className={`${FILTER_FIELD_CLASS} mt-1`}
                      >
                        <option value="All">All sources</option>
                        {ERROR_LOG_SOURCE_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">System</span>
                      <select
                        value={filterSystem}
                        onChange={(e) => setFilterSystem(e.target.value as ErrorLogSystem | "All")}
                        className={`${FILTER_FIELD_CLASS} mt-1`}
                      >
                        <option value="All">All systems</option>
                        {ERROR_LOG_SYSTEM_VALUES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Error type</span>
                      <select
                        value={filterErrorType}
                        onChange={(e) => setFilterErrorType(e.target.value as ErrorLogErrorType | "All")}
                        className={`${FILTER_FIELD_CLASS} mt-1`}
                      >
                        <option value="All">All error types</option>
                        {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Priority</span>
                      <select
                        value={filterPriority}
                        onChange={(e) => setFilterPriority(e.target.value as ErrorLogPriority | "All")}
                        className={`${FILTER_FIELD_CLASS} mt-1`}
                      >
                        <option value="All">All priorities</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                    <label className="min-w-0">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Sort</span>
                      <select
                        value={sortKey}
                        onChange={(e) => setSortKey(e.target.value as SortKey)}
                        className={`${FILTER_FIELD_CLASS} mt-1`}
                      >
                        <option value="newest">Newest</option>
                        <option value="priority">Priority</option>
                        <option value="system">System</option>
                        <option value="topic">Topic</option>
                        <option value="errorType">Error Type</option>
                      </select>
                    </label>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`${primaryButtonClassName} h-10 shrink-0`}
                onClick={() => {
                  setEditingEntry(null);
                  setShowModal(true);
                }}
                title="Log a new entry"
              >
                <Plus className="h-4 w-4" />
                Log entry
              </button>
              <button
                type="button"
                className={`${secondaryButtonClassName} h-10 shrink-0`}
                onClick={() => exportCsv(sorted)}
                title="Export CSV"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          )}
        </div>

        {/* Entries */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-subtle">
          {entries.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setEditingEntry(null);
                setShowModal(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-white/15 bg-white/[0.02] py-10 text-base font-semibold text-slate-300 transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/5 hover:text-cyan-200"
            >
              <Plus className="h-5 w-5" />
              Add first log entry
            </button>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No entries match the current filters.
            </div>
          ) : (
            <div className="grid gap-2 pb-3 lg:grid-cols-2">
              {sorted.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  isExpanded={expandedEntryIds.has(entry.id)}
                  confirmDeleteId={confirmDeleteId}
                  weakTopicAdded={addedWeakTopicIds.has(entry.id)}
                  onToggleExpanded={() => toggleExpandedEntry(entry.id)}
                  onEdit={() => {
                    setEditingEntry(entry);
                    setConfirmDeleteId(null);
                    setShowModal(true);
                  }}
                  onDeleteRequest={() => setConfirmDeleteId(entry.id)}
                  onDeleteConfirm={() => {
                    void handleDelete(entry.id);
                  }}
                  onDeleteCancel={() => setConfirmDeleteId(null)}
                  onAddWeakTopic={() => {
                    void handleAddWeakTopic(entry);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {showModal ? (
        <LogEntryModal
          initial={editingEntry}
          onClose={() => {
            setShowModal(false);
            setEditingEntry(null);
          }}
          onSave={(input) => handleSave(input)}
        />
      ) : null}
    </div>
  );
}

function EntryCard({
  entry,
  isEditing,
  isExpanded,
  confirmDeleteId,
  weakTopicAdded,
  onToggleExpanded,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onAddWeakTopic,
}: {
  entry: ErrorLogEntry;
  isEditing: boolean;
  isExpanded: boolean;
  confirmDeleteId: string | null;
  weakTopicAdded: boolean;
  onToggleExpanded: () => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onAddWeakTopic: () => void;
}) {
  const priority = entry.priority ?? "medium";
  const displayDate = entry.entryDate || entry.createdAt.slice(0, 10);
  const nextReview = describeNextReview(entry);
  const missedPatternText = richTextToPlain(entry.missedPattern);
  const metadata = [
    entry.system,
    entry.source,
    entry.examBlock,
    displayDate,
  ].filter(Boolean);

  return (
    <div
      className={`flex w-full flex-col rounded-xl border border-l-4 p-2.5 transition-colors ${
        isEditing
          ? "border-cyan-400/30 bg-cyan-400/5"
          : "border-white/[0.08] bg-slate-950/30 hover:border-white/15"
      } ${PRIORITY_CARD_ACCENT[priority]} ${isExpanded ? "min-h-[17rem]" : "h-32 overflow-hidden"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-white">{entry.topic || "Untitled topic"}</h3>
          <p className="mt-1 truncate text-xs text-slate-400">{metadata.join(" / ")}</p>
        </div>
        <div className="flex max-w-full flex-wrap justify-start gap-1 sm:max-w-[68%] sm:justify-end">
          <Badge className={NEUTRAL_TAG}>{entry.source}</Badge>
          <Badge className={NEUTRAL_TAG}>{entry.errorType}</Badge>
          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${PRIORITY_PILL[priority]}`}>
            {priority}
          </span>
          {entry.isRepeatMiss ? <Badge className={NEUTRAL_TAG}>Repeat miss</Badge> : null}
          {entry.isGuessedCorrect ? <Badge className={NEUTRAL_TAG}>Guessed correct</Badge> : null}
          {entry.addToFinalSheet ? <Badge className={NEUTRAL_TAG}>Final sheet</Badge> : null}
        </div>
      </div>

      <div className="mt-1.5 h-6 shrink-0 overflow-hidden rounded-lg border border-white/[0.07] bg-slate-950/25 px-2 py-1 text-xs leading-snug text-slate-300">
        <p className="truncate">
          <span className="mr-1 font-semibold uppercase tracking-wider text-rose-200">Missed</span>
          {missedPatternText || "Not provided"}
        </p>
      </div>

      {isExpanded ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ReviewSection title="Correct rule" titleClassName="text-slate-300">
            {entry.whyCorrectAnswerIsCorrect ? (
              <p className="whitespace-pre-wrap text-slate-300">{entry.whyCorrectAnswerIsCorrect}</p>
            ) : (
              <p className="text-slate-500">Not provided</p>
            )}
          </ReviewSection>

          <ReviewSection title="Why I missed it" titleClassName="text-slate-300">
            {entry.whyPickedWrongAnswer ? (
              <p className="whitespace-pre-wrap text-slate-300">{entry.whyPickedWrongAnswer}</p>
            ) : (
              <p className="text-slate-500">Not provided</p>
            )}
          </ReviewSection>

          <ReviewSection title="Tempting wrong answer" titleClassName="text-slate-300">
            {entry.whyTemptingWrongAnswerIsWrong ? (
              <p className="whitespace-pre-wrap text-slate-300">{entry.whyTemptingWrongAnswerIsWrong}</p>
            ) : (
              <p className="text-slate-500">Not provided</p>
            )}
          </ReviewSection>

          <ReviewSection title="Decision rule / algorithm" titleClassName="text-slate-300">
            {entry.decisionRule ? (
              <p className="whitespace-pre-wrap text-slate-300">{entry.decisionRule}</p>
            ) : (
              <p className="text-slate-500">Not provided</p>
            )}
          </ReviewSection>

          <ReviewSection title="Fix" titleClassName="text-slate-300">
            {entry.fix ? (
              <div className="rich-text-render text-slate-300">
                <RichTextRender html={entry.fix} />
              </div>
            ) : (
              <p className="text-slate-500">Not provided</p>
            )}
          </ReviewSection>

          <ReviewSection title="Next action" titleClassName="text-slate-300">
            <p className="whitespace-pre-wrap text-slate-300">{nextReview}</p>
          </ReviewSection>

          <ReviewSection title="Additional details" titleClassName="text-slate-300">
            <div className="space-y-1 text-slate-300">
              <p>Follow-up: {FOLLOW_UP_ACTION_LABELS[entry.followUpAction] ?? entry.followUpAction}</p>
              <p>Repeat miss: {entry.isRepeatMiss ? "Yes" : "No"}</p>
              <p>Guessed correct: {entry.isGuessedCorrect ? "Yes" : "No"}</p>
              <p>Final sheet: {entry.addToFinalSheet ? "Yes" : "No"}</p>
            </div>
          </ReviewSection>
        </div>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-1.5">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="text-xs font-medium text-slate-400 transition-colors hover:text-cyan-200"
          aria-expanded={isExpanded}
        >
          {isExpanded ? "Hide full reasoning" : "Show full reasoning"}
        </button>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirmDeleteId === entry.id ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={onDeleteConfirm} className="text-xs font-medium text-rose-300 hover:text-rose-200">
                Confirm delete
              </button>
              <button type="button" onClick={onDeleteCancel} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={weakTopicAdded ? undefined : onAddWeakTopic}
              disabled={weakTopicAdded}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
                weakTopicAdded
                  ? "cursor-default text-emerald-300"
                  : "text-slate-400 hover:bg-white/5 hover:text-cyan-300"
              }`}
              title={weakTopicAdded ? "Already added as weak topic" : "Add as weak topic"}
            >
              {weakTopicAdded ? "Added Weak Topic" : "+ Weak Topic"}
            </button>
          )}

          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-cyan-300"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onDeleteRequest}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-white/5 hover:text-rose-300"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  titleClassName,
  children,
}: {
  title: string;
  titleClassName: string;
  children: React.ReactNode;
}) {
  return (
    <section className={REVIEW_SECTION_CLASS}>
      <p className={`text-[11px] font-semibold uppercase tracking-wider ${titleClassName}`}>{title}</p>
      <div className="mt-1 text-xs leading-relaxed">{children}</div>
    </section>
  );
}
