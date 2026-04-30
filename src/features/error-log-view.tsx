import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit2, Plus, Trash2 } from "lucide-react";
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
  high: "border-rose-300/30 bg-rose-300/15 text-rose-200",
  medium: "border-amber-300/30 bg-amber-300/15 text-amber-200",
  low: "border-slate-300/20 bg-slate-300/10 text-slate-300",
};

const SOURCE_COLORS: Record<ErrorLogSource, string> = {
  UWorld: "bg-cyan-500/15 border-cyan-500/25 text-cyan-200",
  TrueLearn: "bg-emerald-500/15 border-emerald-500/25 text-emerald-200",
  NBME: "bg-violet-500/15 border-violet-500/25 text-violet-200",
  "CMS Form": "bg-rose-500/15 border-rose-500/25 text-rose-200",
  AMBOSS: "bg-amber-500/15 border-amber-500/25 text-amber-200",
  COMSAE: "bg-indigo-500/15 border-indigo-500/25 text-indigo-200",
  Other: "bg-slate-500/15 border-slate-500/25 text-slate-300",
};

const ERROR_TYPE_COLORS: Record<ErrorLogErrorType, string> = {
  "Knowledge Gap": "bg-amber-500/15 border-amber-500/25 text-amber-200",
  "Misread Question": "bg-blue-500/15 border-blue-500/25 text-blue-200",
  "Wrong Algorithm": "bg-rose-500/15 border-rose-500/25 text-rose-200",
  "Trap Answer": "bg-purple-500/15 border-purple-500/25 text-purple-200",
  "Reasoning Error": "bg-cyan-500/15 border-cyan-500/25 text-cyan-200",
  "Trap / Misread": "bg-fuchsia-500/15 border-fuchsia-500/25 text-fuchsia-200",
  "Management Algorithm": "bg-emerald-500/15 border-emerald-500/25 text-emerald-200",
};

const FOLLOW_UP_ACTION_LABELS: Record<ErrorLogFollowUpAction, string> = {
  "": "No follow-up set",
  "make-anki": "Make Anki",
  "do-10-targeted-questions": "Do 10 targeted questions",
  "review-algorithm": "Review algorithm",
  "add-to-final-sheet": "Add to final sheet",
  "ignore-one-off-detail": "Ignore one-off detail",
};

const REPEAT_PILL = "border-rose-300/30 bg-rose-300/15 text-rose-200";
const FINAL_SHEET_PILL = "border-emerald-300/30 bg-emerald-300/15 text-emerald-200";
const GUESSED_PILL = "border-sky-300/30 bg-sky-300/15 text-sky-200";

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}>
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
  const [editingEntry, setEditingEntry] = useState<ErrorLogEntry | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addedWeakTopicIds, setAddedWeakTopicIds] = useState<Set<string>>(new Set());
  const deferredSearch = useDeferredValue(search);
  const topicRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim();
    return entries.filter((e) => {
      if (filterSource !== "All" && e.source !== filterSource) return false;
      if (filterSystem !== "All" && e.system !== filterSystem) return false;
      if (filterErrorType !== "All" && e.errorType !== filterErrorType) return false;
      if (
        q &&
        !`${e.topic} ${e.source} ${e.examBlock} ${richTextToPlain(e.missedPattern)} ${e.whyPickedWrongAnswer} ${e.whyCorrectAnswerIsCorrect} ${e.decisionRule}`
          .toLowerCase()
          .includes(q)
      ) return false;
      return true;
    });
  }, [entries, deferredSearch, filterSource, filterSystem, filterErrorType]);

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

  return (
    <div className="flex h-full flex-col gap-3 pb-6">
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

      {/* Row 1 — Metric cards */}
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <MetricCard label="Total logged" value={String(entries.length)} />
        <MetricCard label="Most common error type" value={mostCommonErrorType ?? "—"} />
        <MetricCard label="Most common category" value={mostCommonSystem ?? "—"} />
      </div>

      <section className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-white">Top 5 repeated weak topics</p>
          <span className="text-xs text-slate-500">{topRepeatedWeakTopics.length} tracked</span>
        </div>
        {topRepeatedWeakTopics.length ? (
          <ol className="mt-2 grid gap-2 sm:grid-cols-5">
            {topRepeatedWeakTopics.map(([topic, count]) => (
              <li
                key={topic}
                className="min-w-0 rounded-lg border border-white/10 bg-slate-950/30 px-3 py-2"
              >
                <p className="truncate text-xs font-semibold text-slate-200">{topic}</p>
                <p className="mt-1 text-[11px] text-rose-200">{count} repeat miss{count === 1 ? "" : "es"}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-white/10 bg-slate-950/20 px-3 py-2 text-xs text-slate-500">
            No repeated misses logged yet.
          </p>
        )}
      </section>

      {/* Entries list — fills remaining space */}
      <section className="glass-panel min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto scrollbar-subtle">
          {/* Header + controls */}
          <div className="sticky top-0 z-10 bg-inherit pb-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                Entries
                {sorted.length !== entries.length ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    ({sorted.length} of {entries.length})
                  </span>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={primaryButtonClassName}
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
                  className={secondaryButtonClassName}
                  onClick={() => exportCsv(sorted)}
                  title="Export CSV"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
              </div>
            </div>

            {/* Search + filters (only visible when there are entries) */}
            {entries.length > 0 ? (
              <>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="Search topic, source, pattern…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="min-w-[180px] flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                  />
                  <select
                    value={filterSource}
                    onChange={(e) => setFilterSource(e.target.value as ErrorLogSource | "All")}
                    className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="All">All sources</option>
                    {ERROR_LOG_SOURCE_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterSystem}
                    onChange={(e) => setFilterSystem(e.target.value as ErrorLogSystem | "All")}
                    className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="All">All systems</option>
                    {ERROR_LOG_SYSTEM_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterErrorType}
                    onChange={(e) => setFilterErrorType(e.target.value as ErrorLogErrorType | "All")}
                    className="rounded-xl border border-white/10 bg-slate-900/60 px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="All">All error types</option>
                    {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(["newest", "priority", "system", "topic", "errorType"] as SortKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSortKey(key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        sortKey === key
                          ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                          : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
                      }`}
                    >
                      {key === "newest" ? "Newest" : key === "errorType" ? "Error Type" : key.charAt(0).toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {/* Entries */}
          <div className="mt-2 space-y-2 pb-4">
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
              sorted.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  confirmDeleteId={confirmDeleteId}
                  weakTopicAdded={addedWeakTopicIds.has(entry.id)}
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
              ))
            )}
          </div>
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
  confirmDeleteId,
  weakTopicAdded,
  onEdit,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onAddWeakTopic,
}: {
  entry: ErrorLogEntry;
  isEditing: boolean;
  confirmDeleteId: string | null;
  weakTopicAdded: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onAddWeakTopic: () => void;
}) {
  const priority = entry.priority ?? "medium";
  const displayDate = entry.entryDate || entry.createdAt.slice(0, 10);
  const nextReview = describeNextReview(entry);

  return (
    <div
      className={`w-full rounded-xl border p-3 transition-colors ${
        isEditing
          ? "border-cyan-400/30 bg-cyan-400/5"
          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={SOURCE_COLORS[entry.source] ?? SOURCE_COLORS.Other}>
              {entry.source}
            </Badge>
            <Badge className={ERROR_TYPE_COLORS[entry.errorType] ?? ERROR_TYPE_COLORS["Knowledge Gap"]}>
              {entry.errorType}
            </Badge>
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm ${PRIORITY_PILL[priority]}`}>
              {priority} priority
            </span>
            {entry.isRepeatMiss ? <Badge className={REPEAT_PILL}>Repeat miss</Badge> : null}
            {entry.addToFinalSheet ? <Badge className={FINAL_SHEET_PILL}>Final sheet</Badge> : null}
            {entry.isGuessedCorrect ? <Badge className={GUESSED_PILL}>Guessed correct</Badge> : null}
            {entry.examBlock ? (
              <span className="text-[10px] text-slate-500">{entry.examBlock}</span>
            ) : null}
            <span className="text-xs font-semibold text-white">{entry.topic}</span>
            <span className="text-xs text-slate-400">{entry.system}</span>
            <span className="text-[10px] text-slate-500">{displayDate}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {confirmDeleteId === entry.id ? (
            <div className="flex items-center gap-2">
              <button type="button" onClick={onDeleteConfirm} className="text-xs font-medium text-rose-400 hover:text-rose-300">
                Confirm delete
              </button>
              <button type="button" onClick={onDeleteCancel} className="text-xs text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={weakTopicAdded ? undefined : onAddWeakTopic}
                disabled={weakTopicAdded}
                className={`rounded-lg px-2 py-1 text-[10px] font-medium transition-colors ${
                  weakTopicAdded
                    ? "text-emerald-400 cursor-default"
                    : "text-slate-400 hover:bg-white/5 hover:text-cyan-300"
                }`}
                title={weakTopicAdded ? "Already added as weak topic" : "Add as weak topic"}
              >
                {weakTopicAdded ? "✓ Added" : "+ Weak Topic"}
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg p-1.5 text-slate-500 hover:text-cyan-300 transition-colors"
                title="Edit"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDeleteRequest}
                className="rounded-lg p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {entry.missedPattern ? (
        <div className="mt-2 text-xs text-slate-300 rich-text-render">
          <span className="font-medium text-slate-500">Missed: </span>
          <RichTextRender html={entry.missedPattern} />
        </div>
      ) : null}

      {entry.whyCorrectAnswerIsCorrect ? (
        <p className="mt-1 text-xs whitespace-pre-wrap text-slate-300">
          <span className="font-medium text-slate-500">Correct rule: </span>
          {entry.whyCorrectAnswerIsCorrect}
        </p>
      ) : null}

      {entry.whyPickedWrongAnswer ? (
        <p className="mt-1 text-xs whitespace-pre-wrap text-slate-300">
          <span className="font-medium text-slate-500">Why I missed it: </span>
          {entry.whyPickedWrongAnswer}
        </p>
      ) : null}

      {entry.whyTemptingWrongAnswerIsWrong ? (
        <p className="mt-1 text-xs whitespace-pre-wrap text-slate-400">
          <span className="font-medium text-slate-500">Tempting wrong answer: </span>
          {entry.whyTemptingWrongAnswerIsWrong}
        </p>
      ) : null}

      {entry.decisionRule ? (
        <p className="mt-1 text-xs whitespace-pre-wrap text-slate-400">
          <span className="font-medium text-slate-500">Decision rule: </span>
          {entry.decisionRule}
        </p>
      ) : null}

      {entry.fix ? (
        <div className="mt-1 text-xs text-slate-400 rich-text-render">
          <span className="font-medium text-slate-500">Fix: </span>
          <RichTextRender html={entry.fix} />
        </div>
      ) : null}

      <p className="mt-1 text-xs text-slate-400">
        <span className="font-medium text-slate-500">Next review: </span>
        {nextReview}
      </p>
    </div>
  );
}
