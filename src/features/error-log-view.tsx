import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Edit2,
  Plus,
  Repeat,
  Search,
  Sparkles,
  SlidersHorizontal,
  Target,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
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

const PRIORITY_DOT: Record<ErrorLogPriority, string> = {
  high: "bg-rose-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

const PRIORITY_PILL: Record<ErrorLogPriority, string> = {
  high: "border-rose-300/25 bg-rose-400/10 text-rose-200",
  medium: "border-amber-300/25 bg-amber-300/10 text-amber-200",
  low: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
};

const PRIORITY_LABEL: Record<ErrorLogPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const FOLLOW_UP_ACTION_LABELS: Record<ErrorLogFollowUpAction, string> = {
  "": "No follow-up set",
  "make-anki": "Make Anki",
  "do-10-targeted-questions": "Do 10 targeted questions",
  "review-algorithm": "Review algorithm",
  "add-to-final-sheet": "Add to final sheet",
  "ignore-one-off-detail": "Ignore one-off detail",
};

const FILTER_FIELD_CLASS =
  "h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30";
const STUDY_TEXT_CLASS = "break-words whitespace-pre-wrap text-[0.95rem] leading-6 text-slate-200";
const ENTRY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const TOPIC_BAR_PALETTE = [
  "bg-rose-400/85",
  "bg-amber-400/85",
  "bg-cyan-300/80",
  "bg-violet-400/85",
  "bg-emerald-400/80",
];

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function renderBasicFormattedInline(text: string, keyPrefix = "segment"): React.ReactNode[] {
  const pattern = /(\*\*[\s\S]+?\*\*|__[\s\S]+?__|<u>[\s\S]+?<\/u>|\*[^*\n][\s\S]*?\*|_[^_\n][\s\S]*?_)/g;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let segmentIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const tokenKey = `${keyPrefix}-${segmentIndex}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={tokenKey}>{renderBasicFormattedInline(token.slice(2, -2), tokenKey)}</strong>);
    } else if (token.startsWith("__") && token.endsWith("__")) {
      parts.push(<u key={tokenKey}>{renderBasicFormattedInline(token.slice(2, -2), tokenKey)}</u>);
    } else if (token.startsWith("<u>") && token.endsWith("</u>")) {
      parts.push(<u key={tokenKey}>{renderBasicFormattedInline(token.slice(3, -4), tokenKey)}</u>);
    } else if ((token.startsWith("*") && token.endsWith("*")) || (token.startsWith("_") && token.endsWith("_"))) {
      parts.push(<em key={tokenKey}>{renderBasicFormattedInline(token.slice(1, -1), tokenKey)}</em>);
    } else {
      parts.push(token);
    }

    cursor = match.index + token.length;
    segmentIndex += 1;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
}

function renderStudyContent(content: string, className = STUDY_TEXT_CLASS) {
  if (!content.trim()) {
    return <p className="text-slate-500">Not provided</p>;
  }

  if (looksLikeHtml(content)) {
    return (
      <div className={`rich-text-render ${className} [&_p]:my-0 [&_li]:my-0.5 [&_ul]:my-1 [&_ol]:my-1`}>
        <RichTextRender html={content} />
      </div>
    );
  }

  const lines = content.split("\n");
  return (
    <div className={className}>
      {lines.map((line, index) => (
        <Fragment key={`${line}-${index}`}>
          {renderBasicFormattedInline(line, `line-${index}`)}
          {index < lines.length - 1 ? <br /> : null}
        </Fragment>
      ))}
    </div>
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

function formatEntryDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return ENTRY_DATE_FORMATTER.format(parsed);
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

  const fieldClass =
    "h-9 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40";
  const selectClass = fieldClass;
  const labelClass = "mb-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400";
  const bodyTextClass = "!font-sans !text-base !font-normal !leading-[1.65] !tracking-normal [word-spacing:0.05em]";
  const topTextareaClass = `mt-1 ${bodyTextClass}`;
  const bottomTextareaClass =
    `${fieldClass} ${bodyTextClass} h-[7.75rem] min-h-[7.75rem] max-h-[7.75rem] resize-none overflow-y-auto py-3`;

  return (
    <ModalShell
      onClose={onClose}
      position="center"
      titleId="log-entry-title"
      contentClassName="flex h-[calc(100vh-3rem)] max-h-[calc(100vh-3rem)] w-full max-w-[720px] flex-col overflow-hidden p-6"
    >
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h3 id="log-entry-title" className="text-[1.35rem] font-semibold leading-tight text-white">
            {isEdit ? "Edit Log entry" : "Log entry"}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          title="Close modal"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-slate-900/60 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="mt-2 flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pl-1 pr-1">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className={labelClass}>Source</label>
              <select
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value as ErrorLogSource }))}
                className={selectClass}
              >
                {ERROR_LOG_SOURCE_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Exam / Block</label>
              <input
                value={draft.examBlock}
                onChange={(e) => setDraft((d) => ({ ...d, examBlock: e.target.value }))}
                placeholder="Block 2"
                className={fieldClass}
              />
            </div>
            <div>
              <label className={labelClass}>System</label>
              <select
                value={draft.system}
                onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value as ErrorLogSystem }))}
                className={selectClass}
              >
                {ERROR_LOG_SYSTEM_VALUES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Topic</label>
              <input
                value={draft.topic}
                onChange={(e) => setDraft((d) => ({ ...d, topic: e.target.value }))}
                placeholder="Aortic dissection"
                className={fieldClass}
              />
              {errors.topic ? <p className="mt-1 text-xs text-rose-400">{errors.topic}</p> : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelClass}>Error Type</label>
              <select
                value={draft.errorType}
                onChange={(e) => setDraft((d) => ({ ...d, errorType: e.target.value as ErrorLogErrorType }))}
                className={selectClass}
              >
                {ERROR_LOG_ERROR_TYPE_VALUES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Priority</label>
              <select
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as ErrorLogPriority }))}
                className={selectClass}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Date</label>
              <input
                type="date"
                value={draft.entryDate}
                onChange={(e) => setDraft((d) => ({ ...d, entryDate: e.target.value }))}
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Missed Pattern</label>
            <RichTextEditor
              value={draft.missedPattern}
              onChange={(html) => setDraft((d) => ({ ...d, missedPattern: html }))}
              placeholder="What did you miss?"
              minLines={7}
              scrollable
              className={topTextareaClass}
            />
            {errors.missedPattern ? <p className="mt-1 text-xs text-rose-400">{errors.missedPattern}</p> : null}
          </div>

          <div>
            <label className={labelClass}>Fix</label>
            <RichTextEditor
              value={draft.fix}
              onChange={(html) => setDraft((d) => ({ ...d, fix: html }))}
              placeholder="What will you do differently?"
              minLines={7}
              scrollable
              className={topTextareaClass}
            />
            {errors.fix ? <p className="mt-1 text-xs text-rose-400">{errors.fix}</p> : null}
          </div>

          <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Why I picked wrong answer</label>
                <textarea
                  value={draft.whyPickedWrongAnswer}
                  onChange={(e) => setDraft((d) => ({ ...d, whyPickedWrongAnswer: e.target.value }))}
                  rows={4}
                  className={bottomTextareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>Why correct answer is correct</label>
                <textarea
                  value={draft.whyCorrectAnswerIsCorrect}
                  onChange={(e) => setDraft((d) => ({ ...d, whyCorrectAnswerIsCorrect: e.target.value }))}
                  rows={4}
                  className={bottomTextareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>Why tempting wrong answer is wrong</label>
                <textarea
                  value={draft.whyTemptingWrongAnswerIsWrong}
                  onChange={(e) => setDraft((d) => ({ ...d, whyTemptingWrongAnswerIsWrong: e.target.value }))}
                  rows={4}
                  className={bottomTextareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>Decision rule / algorithm</label>
                <textarea
                  value={draft.decisionRule}
                  onChange={(e) => setDraft((d) => ({ ...d, decisionRule: e.target.value }))}
                  rows={4}
                  className={bottomTextareaClass}
                />
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
              <div>
                <label className={labelClass}>Follow-up action</label>
                <select
                  value={draft.followUpAction}
                  onChange={(e) => setDraft((d) => ({ ...d, followUpAction: e.target.value as ErrorLogFollowUpAction }))}
                  className={selectClass}
                >
                  {ERROR_LOG_FOLLOW_UP_ACTION_VALUES.map((action) => (
                    <option key={action || "none"} value={action}>
                      {FOLLOW_UP_ACTION_LABELS[action]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2 sm:grid-cols-3 sm:pt-[1.25rem]">
                <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-2.5 text-[11px] font-medium leading-tight text-slate-300">
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
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  Repeat miss
                </label>
                <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-2.5 text-[11px] font-medium leading-tight text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.isGuessedCorrect}
                    onChange={(e) => setDraft((d) => ({ ...d, isGuessedCorrect: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  Guessed correct
                </label>
                <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-2.5 text-[11px] font-medium leading-tight text-slate-300">
                  <input
                    type="checkbox"
                    checked={draft.addToFinalSheet}
                    onChange={(e) => setDraft((d) => ({ ...d, addToFinalSheet: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  Add to final sheet
                </label>
              </div>
            </div>
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.08] pt-2.5">
          <button type="button" className={`${secondaryButtonClassName} h-8 px-3 text-sm`} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`${primaryButtonClassName} h-8 px-3 text-sm`} disabled={saving}>
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
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

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

  useEffect(() => {
    if (sorted.length === 0) {
      if (selectedEntryId !== null) setSelectedEntryId(null);
      return;
    }
    if (!selectedEntryId || !sorted.some((entry) => entry.id === selectedEntryId)) {
      setSelectedEntryId(sorted[0].id);
    }
  }, [sorted, selectedEntryId]);

  const selectedEntry = useMemo(
    () => (selectedEntryId ? entries.find((entry) => entry.id === selectedEntryId) ?? null : null),
    [entries, selectedEntryId],
  );

  const totalMissed = entries.length;
  const recurringPatternsCount = useMemo(
    () => entries.reduce((total, entry) => total + (entry.isRepeatMiss ? 1 : 0), 0),
    [entries],
  );
  const highImpactCount = useMemo(
    () => entries.reduce((total, entry) => total + ((entry.priority ?? "medium") === "high" ? 1 : 0), 0),
    [entries],
  );
  const mostCommonSystem = useMemo(() => modeCount(entries.map((e) => e.system)), [entries]);
  const mostCommonErrorType = useMemo(() => modeCount(entries.map((e) => e.errorType)), [entries]);

  const topMissedTopics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const topic = entry.topic.trim();
      if (!topic) continue;
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5);
  }, [entries]);

  const nextReviewSuggestions = useMemo(() => {
    const others = entries.filter((entry) => entry.id !== selectedEntryId);
    return [...others]
      .sort((a, b) => {
        const aRepeat = a.isRepeatMiss ? 0 : 1;
        const bRepeat = b.isRepeatMiss ? 0 : 1;
        if (aRepeat !== bRepeat) return aRepeat - bRepeat;
        const pa = PRIORITY_SORT_ORDER[a.priority ?? "medium"] ?? 1;
        const pb = PRIORITY_SORT_ORDER[b.priority ?? "medium"] ?? 1;
        if (pa !== pb) return pa - pb;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, 3);
  }, [entries, selectedEntryId]);

  const activeFilterCount = [
    filterSource !== "All",
    filterSystem !== "All",
    filterErrorType !== "All",
    filterPriority !== "All",
    sortKey !== "newest",
  ].filter(Boolean).length;

  const filtersActive = activeFilterCount > 0 || search.trim().length > 0;

  function resetFilters() {
    setFilterSource("All");
    setFilterSystem("All");
    setFilterErrorType("All");
    setFilterPriority("All");
    setSortKey("newest");
    setSearch("");
  }

  async function handleSave(input: ErrorLogInput) {
    await upsertErrorLogEntry(input);
    setShowModal(false);
    setEditingEntry(null);
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

  function openCreate() {
    setEditingEntry(null);
    setShowModal(true);
  }

  function openEdit(entry: ErrorLogEntry) {
    setEditingEntry(entry);
    setConfirmDeleteId(null);
    setShowModal(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pb-6">
      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}

      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Portfolio - Error Log</h2>

      <HeaderBand
        search={search}
        onSearchChange={setSearch}
        showFilters={showFilters}
        onToggleFilters={() => setShowFilters((value) => !value)}
        activeFilterCount={activeFilterCount}
        onCreate={openCreate}
        onExport={() => exportCsv(sorted)}
        canExport={sorted.length > 0}
        entriesCount={entries.length}
      />

      {showFilters && entries.length > 0 ? (
        <FiltersPanel
          filterSource={filterSource}
          filterSystem={filterSystem}
          filterErrorType={filterErrorType}
          filterPriority={filterPriority}
          sortKey={sortKey}
          onFilterSource={setFilterSource}
          onFilterSystem={setFilterSystem}
          onFilterErrorType={setFilterErrorType}
          onFilterPriority={setFilterPriority}
          onSortKey={setSortKey}
          onReset={resetFilters}
        />
      ) : null}

      <SummaryStrip
        totalMissed={totalMissed}
        recurringPatterns={recurringPatternsCount}
        highImpact={highImpactCount}
        mostCommonSystem={mostCommonSystem}
        mostCommonErrorType={mostCommonErrorType}
        filteredCount={sorted.length}
        filtersActive={filtersActive}
      />

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,16.5rem)]">
        <EntryList
          entries={sorted}
          totalEntries={entries.length}
          selectedId={selectedEntryId}
          filtersActive={filtersActive}
          onSelect={setSelectedEntryId}
          onCreate={openCreate}
          onResetFilters={resetFilters}
        />

        <EntryDetail
          entry={selectedEntry}
          totalEntries={entries.length}
          onEdit={(entry) => openEdit(entry)}
          onCreate={openCreate}
        />

        <InsightsRail
          entries={entries}
          selectedEntry={selectedEntry}
          topMissedTopics={topMissedTopics}
          recurringPatterns={recurringPatternsCount}
          nextReview={nextReviewSuggestions}
          weakTopicAdded={selectedEntry ? addedWeakTopicIds.has(selectedEntry.id) : false}
          confirmDeleteId={confirmDeleteId}
          onAddWeakTopic={(entry) => {
            void handleAddWeakTopic(entry);
          }}
          onEditEntry={openEdit}
          onExportEntry={(entry) => exportCsv([entry])}
          onDeleteRequest={(id) => setConfirmDeleteId(id)}
          onDeleteConfirm={(id) => {
            void handleDelete(id);
          }}
          onDeleteCancel={() => setConfirmDeleteId(null)}
          onSelect={setSelectedEntryId}
        />
      </div>

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

function HeaderBand({
  search,
  onSearchChange,
  showFilters,
  onToggleFilters,
  activeFilterCount,
  onCreate,
  onExport,
  canExport,
  entriesCount,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
  onCreate: () => void;
  onExport: () => void;
  canExport: boolean;
  entriesCount: number;
}) {
  const hasEntries = entriesCount > 0;
  return (
    <section className="glass-panel flex shrink-0 flex-wrap items-center gap-2 p-4">
      {hasEntries ? (
        <>
          <label className="relative flex h-9 min-w-0 items-center sm:w-[18rem]">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search entries..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 w-full rounded-lg border border-white/10 bg-slate-900/60 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
            />
          </label>
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={showFilters}
            className={`${secondaryButtonClassName} h-9 shrink-0 px-3 text-sm`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onCreate}
        className={`${primaryButtonClassName} h-9 shrink-0 px-3 text-sm`}
        title="Log a new entry"
      >
        <Plus className="h-4 w-4" />
        Log entry
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={!canExport}
        className={`${secondaryButtonClassName} h-9 shrink-0 px-3 text-sm ${
          canExport ? "" : "cursor-default opacity-50"
        }`}
        title="Export visible entries to CSV"
      >
        <Download className="h-4 w-4" />
        Export
      </button>
    </section>
  );
}

function FiltersPanel({
  filterSource,
  filterSystem,
  filterErrorType,
  filterPriority,
  sortKey,
  onFilterSource,
  onFilterSystem,
  onFilterErrorType,
  onFilterPriority,
  onSortKey,
  onReset,
}: {
  filterSource: ErrorLogSource | "All";
  filterSystem: ErrorLogSystem | "All";
  filterErrorType: ErrorLogErrorType | "All";
  filterPriority: ErrorLogPriority | "All";
  sortKey: SortKey;
  onFilterSource: (value: ErrorLogSource | "All") => void;
  onFilterSystem: (value: ErrorLogSystem | "All") => void;
  onFilterErrorType: (value: ErrorLogErrorType | "All") => void;
  onFilterPriority: (value: ErrorLogPriority | "All") => void;
  onSortKey: (value: SortKey) => void;
  onReset: () => void;
}) {
  const labelClass = "text-[10px] font-semibold uppercase tracking-wider text-slate-500";
  return (
    <section className="shrink-0 rounded-2xl border border-white/[0.08] bg-slate-950/35 p-3">
      <div className="grid gap-2 md:grid-cols-5">
        <label className="min-w-0">
          <span className={labelClass}>Source</span>
          <select
            value={filterSource}
            onChange={(e) => onFilterSource(e.target.value as ErrorLogSource | "All")}
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
          <span className={labelClass}>System</span>
          <select
            value={filterSystem}
            onChange={(e) => onFilterSystem(e.target.value as ErrorLogSystem | "All")}
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
          <span className={labelClass}>Error type</span>
          <select
            value={filterErrorType}
            onChange={(e) => onFilterErrorType(e.target.value as ErrorLogErrorType | "All")}
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
          <span className={labelClass}>Priority</span>
          <select
            value={filterPriority}
            onChange={(e) => onFilterPriority(e.target.value as ErrorLogPriority | "All")}
            className={`${FILTER_FIELD_CLASS} mt-1`}
          >
            <option value="All">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="min-w-0">
          <span className={labelClass}>Sort</span>
          <select
            value={sortKey}
            onChange={(e) => onSortKey(e.target.value as SortKey)}
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
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] font-medium text-slate-400 transition-colors hover:text-cyan-200"
        >
          Reset filters
        </button>
      </div>
    </section>
  );
}

function SummaryStrip({
  totalMissed,
  recurringPatterns,
  highImpact,
  mostCommonSystem,
  mostCommonErrorType,
  filteredCount,
  filtersActive,
}: {
  totalMissed: number;
  recurringPatterns: number;
  highImpact: number;
  mostCommonSystem: string | null;
  mostCommonErrorType: string | null;
  filteredCount: number;
  filtersActive: boolean;
}) {
  return (
    <section className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCell
        label="Total Missed"
        value={String(totalMissed)}
        meta={
          filtersActive && filteredCount !== totalMissed
            ? `${filteredCount} match filters`
            : totalMissed === 1
              ? "1 entry logged"
              : `${totalMissed} entries logged`
        }
        icon={AlertTriangle}
        tone="text-rose-200"
      />
      <SummaryCell
        label="Recurring Patterns"
        value={String(recurringPatterns)}
        meta={recurringPatterns === 0 ? "No repeat misses yet" : recurringPatterns === 1 ? "1 repeat miss" : `${recurringPatterns} repeat misses`}
        icon={Repeat}
        tone="text-amber-200"
      />
      <SummaryCell
        label="High Impact"
        value={String(highImpact)}
        meta={highImpact === 0 ? "Nothing at high priority" : "High-priority entries"}
        icon={Target}
        tone="text-cyan-200"
      />
      <SummaryCell
        label="Top Category"
        value={mostCommonSystem ?? "—"}
        meta={mostCommonErrorType ? `Most common: ${mostCommonErrorType}` : "Add entries to see trends"}
        icon={TrendingUp}
        tone="text-emerald-200"
      />
    </section>
  );
}

function SummaryCell({
  label,
  value,
  meta,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  icon: typeof AlertTriangle;
  tone: string;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-2xl border border-white/[0.07] bg-slate-950/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
        <p className="mt-1 truncate text-[1.6rem] font-semibold leading-none tracking-[-0.03em] text-white">{value}</p>
        <p className="mt-1.5 truncate text-[11px] text-slate-400">{meta}</p>
      </div>
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
    </div>
  );
}

function EntryList({
  entries,
  totalEntries,
  selectedId,
  filtersActive,
  onSelect,
  onCreate,
  onResetFilters,
}: {
  entries: ErrorLogEntry[];
  totalEntries: number;
  selectedId: string | null;
  filtersActive: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onResetFilters: () => void;
}) {
  return (
    <section className="glass-panel flex min-h-0 min-w-0 flex-col overflow-hidden p-0">
      <header className="shrink-0 border-b border-white/[0.07] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Entries</p>
          <p className="text-[11px] text-slate-500">
            {totalEntries === 0
              ? "None yet"
              : entries.length === totalEntries
                ? `${totalEntries} total`
                : `${entries.length} of ${totalEntries}`}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
        {totalEntries === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-white">No entries yet</p>
            <p className="text-xs text-slate-400">Log your first miss to start building patterns.</p>
            <button type="button" onClick={onCreate} className={`${primaryButtonClassName} h-9 px-3 text-sm`}>
              <Plus className="h-4 w-4" />
              Log entry
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-white">No matches</p>
            <p className="text-xs text-slate-400">No entries match the current filters.</p>
            {filtersActive ? (
              <button
                type="button"
                onClick={onResetFilters}
                className={`${secondaryButtonClassName} h-9 px-3 text-sm`}
              >
                Reset filters
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {entries.map((entry) => (
              <EntryListRow
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedId}
                onSelect={() => onSelect(entry.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function EntryListRow({
  entry,
  selected,
  onSelect,
}: {
  entry: ErrorLogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const priority = entry.priority ?? "medium";
  const dateLabel = formatEntryDate(entry.entryDate || entry.createdAt.slice(0, 10));
  const sourceLabel = [entry.source, entry.examBlock].filter(Boolean).join(" · ");

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors ${
          selected ? "bg-cyan-400/[0.08]" : "hover:bg-white/[0.03]"
        }`}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`truncate text-[13px] font-semibold leading-tight ${selected ? "text-white" : "text-slate-100"}`}>
              {entry.topic || "Untitled topic"}
            </p>
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] ${PRIORITY_PILL[priority]}`}
            >
              {PRIORITY_LABEL[priority]}
            </span>
          </div>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            {sourceLabel || "—"} {sourceLabel ? "·" : ""} {dateLabel}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
            <span className="truncate">{entry.system}</span>
            {entry.isRepeatMiss ? (
              <span className="inline-flex items-center gap-1 text-amber-300/90">
                <Repeat className="h-3 w-3" />
                Repeat
              </span>
            ) : null}
            {entry.addToFinalSheet ? <span className="text-slate-400">Final sheet</span> : null}
          </div>
        </div>
      </button>
    </li>
  );
}

function EntryDetail({
  entry,
  totalEntries,
  onEdit,
  onCreate,
}: {
  entry: ErrorLogEntry | null;
  totalEntries: number;
  onEdit: (entry: ErrorLogEntry) => void;
  onCreate: () => void;
}) {
  if (!entry) {
    return (
      <section className="glass-panel flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 p-6 text-center">
        {totalEntries === 0 ? (
          <>
            <p className="text-base font-semibold text-white">Nothing logged yet</p>
            <p className="max-w-sm text-sm text-slate-400">
              Capture a missed question, the reasoning that led you astray, and the rule you want to remember next time.
            </p>
            <button type="button" onClick={onCreate} className={`${primaryButtonClassName} h-9 px-3 text-sm`}>
              <Plus className="h-4 w-4" />
              Log entry
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-white">Select an entry</p>
            <p className="max-w-sm text-sm text-slate-400">Choose an entry from the list to review its reasoning.</p>
          </>
        )}
      </section>
    );
  }

  const priority = entry.priority ?? "medium";
  const dateLabel = formatEntryDate(entry.entryDate || entry.createdAt.slice(0, 10));
  const metadata = [entry.source, entry.examBlock, dateLabel].filter(Boolean).join(" · ");
  const showHighImpact = priority === "high";

  return (
    <section className="glass-panel flex min-h-0 min-w-0 flex-col overflow-hidden p-0">
      <header className="shrink-0 border-b border-white/[0.07] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${PRIORITY_DOT[priority]}`} />
              <h3 className="break-words text-lg font-semibold leading-tight text-white">
                {entry.topic || "Untitled topic"}
              </h3>
              {showHighImpact ? (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${PRIORITY_PILL.high}`}>
                  High impact
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 break-words text-xs text-slate-400">
              {entry.system}
              {metadata ? <span className="text-slate-500"> · {metadata}</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className={`${secondaryButtonClassName} h-8 shrink-0 px-3 text-xs`}
          >
            <Edit2 className="h-3.5 w-3.5" />
            Edit Entry
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle px-5 py-4">
        <DetailSection title="Summary" icon={Sparkles}>
          {renderStudyContent(entry.missedPattern)}
        </DetailSection>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <DetailSection title="Your Reasoning" tone="rose" badge="Why you picked the wrong answer">
            {renderStudyContent(entry.whyPickedWrongAnswer)}
          </DetailSection>
          <DetailSection title="Correct Reasoning" tone="emerald" badge="Why the correct answer is correct">
            {renderStudyContent(entry.whyCorrectAnswerIsCorrect)}
          </DetailSection>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <DetailSection title="Tempting Wrong Answer">
            {renderStudyContent(entry.whyTemptingWrongAnswerIsWrong)}
          </DetailSection>
          <DetailSection title="Missed Pattern">
            {renderStudyContent(entry.missedPattern)}
          </DetailSection>
          <DetailSection title="Fix / Takeaway">
            {renderStudyContent(entry.fix)}
          </DetailSection>
        </div>

        <div className="mt-3">
          <DetailSection title="Decision Rule">
            {renderStudyContent(entry.decisionRule)}
          </DetailSection>
        </div>

        <DetailMetaRow entry={entry} />
      </div>
    </section>
  );
}

function DetailSection({
  title,
  icon: Icon,
  badge,
  tone,
  children,
}: {
  title: string;
  icon?: typeof AlertTriangle;
  badge?: string;
  tone?: "rose" | "emerald";
  children: React.ReactNode;
}) {
  const toneRing =
    tone === "rose"
      ? "border-rose-300/15"
      : tone === "emerald"
        ? "border-emerald-300/15"
        : "border-white/[0.07]";
  const toneTitle =
    tone === "rose" ? "text-rose-200" : tone === "emerald" ? "text-emerald-200" : "text-slate-200";

  return (
    <section className={`min-w-0 rounded-2xl border ${toneRing} bg-white/[0.03] px-4 py-3`}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 text-slate-400" /> : null}
        <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${toneTitle}`}>{title}</p>
      </div>
      {badge ? <p className="mt-0.5 text-[11px] text-slate-500">{badge}</p> : null}
      <div className="mt-2 text-[0.92rem] leading-6 text-slate-200">{children}</div>
    </section>
  );
}

function DetailMetaRow({ entry }: { entry: ErrorLogEntry }) {
  const items = [
    { label: "Error type", value: entry.errorType },
    {
      label: "Follow-up",
      value: FOLLOW_UP_ACTION_LABELS[entry.followUpAction] ?? entry.followUpAction,
    },
    { label: "Repeat miss", value: entry.isRepeatMiss ? "Yes" : "No" },
    { label: "Guessed correct", value: entry.isGuessedCorrect ? "Yes" : "No" },
    { label: "Final sheet", value: entry.addToFinalSheet ? "Yes" : "No" },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-white/[0.05] bg-white/[0.02] px-4 py-2.5">
      {items.map((item) => (
        <p key={item.label} className="text-[11px] text-slate-400">
          <span className="text-slate-500">{item.label}:</span>{" "}
          <span className="text-slate-200">{item.value || "—"}</span>
        </p>
      ))}
    </div>
  );
}

function InsightsRail({
  entries,
  selectedEntry,
  topMissedTopics,
  recurringPatterns,
  nextReview,
  weakTopicAdded,
  confirmDeleteId,
  onAddWeakTopic,
  onEditEntry,
  onExportEntry,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onSelect,
}: {
  entries: ErrorLogEntry[];
  selectedEntry: ErrorLogEntry | null;
  topMissedTopics: Array<[string, number]>;
  recurringPatterns: number;
  nextReview: ErrorLogEntry[];
  weakTopicAdded: boolean;
  confirmDeleteId: string | null;
  onAddWeakTopic: (entry: ErrorLogEntry) => void;
  onEditEntry: (entry: ErrorLogEntry) => void;
  onExportEntry: (entry: ErrorLogEntry) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
  onSelect: (id: string) => void;
}) {
  const totalForPercent = Math.max(1, entries.length);
  const isConfirming = selectedEntry !== null && confirmDeleteId === selectedEntry.id;

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto scrollbar-subtle lg:col-span-2 xl:col-span-1">
      <RailCard title="Pattern Insights" icon={Sparkles}>
        {topMissedTopics.length === 0 ? (
          <p className="text-xs text-slate-500">Log entries to surface most-missed topics.</p>
        ) : (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Most missed topics</p>
            <ul className="mt-2 space-y-2">
              {topMissedTopics.map(([topic, count], index) => {
                const pct = Math.round((count / totalForPercent) * 100);
                return (
                  <li key={topic} className="min-w-0">
                    <div className="flex items-center justify-between gap-3 text-[11px]">
                      <span className="truncate text-slate-200">{topic}</span>
                      <span className="shrink-0 text-slate-500">{pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={`h-full rounded-full ${TOPIC_BAR_PALETTE[index % TOPIC_BAR_PALETTE.length]}`}
                        style={{ width: `${Math.min(100, Math.max(4, pct))}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Recurring Patterns</p>
              <p className="mt-1 text-[1.4rem] font-semibold leading-none tracking-[-0.03em] text-white">{recurringPatterns}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {recurringPatterns === 0
                  ? "No repeat misses yet"
                  : recurringPatterns === 1
                    ? "1 repeat miss flagged"
                    : `${recurringPatterns} repeat misses flagged`}
              </p>
            </div>
          </>
        )}
      </RailCard>

      <RailCard title="Next Review Suggestions">
        {nextReview.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing else queued up.</p>
        ) : (
          <ul className="space-y-2">
            {nextReview.map((entry) => {
              const priority = entry.priority ?? "medium";
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    className="flex w-full items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-white/15 hover:bg-white/[0.04]"
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-100">
                        {entry.topic || "Untitled topic"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        Priority: <span className="text-slate-300">{PRIORITY_LABEL[priority]}</span>
                        {entry.isRepeatMiss ? <span className="ml-1 text-amber-300/90">· Repeat</span> : null}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">{describeNextReview(entry)}</p>
                    </div>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </RailCard>

      <RailCard title="Actions">
        {selectedEntry ? (
          <div className="space-y-1">
            <ActionRow
              icon={Plus}
              label={weakTopicAdded ? "Added as Weak Topic" : "Add as Weak Topic"}
              onClick={weakTopicAdded ? undefined : () => onAddWeakTopic(selectedEntry)}
              disabled={weakTopicAdded}
              accent={weakTopicAdded ? "emerald" : undefined}
            />
            <ActionRow icon={Edit2} label="Edit Entry" onClick={() => onEditEntry(selectedEntry)} />
            <ActionRow icon={Download} label="Export This Entry" onClick={() => onExportEntry(selectedEntry)} />
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              {isConfirming ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-400/25 bg-rose-500/[0.06] px-3 py-2">
                  <p className="text-[11px] text-rose-200">Delete this entry?</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onDeleteConfirm(selectedEntry.id)}
                      className="text-[11px] font-medium text-rose-300 hover:text-rose-200"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteCancel}
                      className="text-[11px] text-slate-500 hover:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <ActionRow
                  icon={Trash2}
                  label="Delete Entry"
                  onClick={() => onDeleteRequest(selectedEntry.id)}
                  accent="rose"
                />
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Select an entry to see available actions.</p>
        )}
      </RailCard>
    </section>
  );
}

function RailCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel min-w-0 p-4">
      <header className="flex items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 text-slate-400" /> : null}
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      </header>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  accent,
}: {
  icon: typeof AlertTriangle;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  accent?: "rose" | "emerald";
}) {
  const toneClass =
    accent === "rose"
      ? "text-rose-300 hover:text-rose-200 hover:bg-rose-500/[0.08]"
      : accent === "emerald"
        ? "text-emerald-200"
        : "text-slate-200 hover:text-white hover:bg-white/[0.04]";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors ${toneClass} ${
        disabled ? "cursor-default opacity-80" : ""
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
