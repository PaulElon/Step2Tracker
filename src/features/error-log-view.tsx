import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit2, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
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

const REVIEW_SECTION_CLASS =
  "min-w-0 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]";
const FILTER_FIELD_CLASS = "h-9 w-full rounded-lg border border-white/10 bg-slate-900/70 px-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30";
const STUDY_TEXT_CLASS = "break-words whitespace-pre-wrap text-[0.95rem] leading-6 text-slate-200";
const REVIEW_LABEL_CLASS = "text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500";
const PREVIEW_TEXT_CLASS =
  "break-words whitespace-pre-wrap text-[0.84rem] leading-[1.2rem] text-slate-100 [&_p]:my-0 [&_li]:my-0.5 [&_ul]:my-1 [&_ol]:my-1";
const PREVIEW_MAX_HEIGHT = "2.6rem";
const COLLAPSED_CARD_VISIBLE_TAGS = 2;
const ENTRY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function getEntryTags(entry: ErrorLogEntry) {
  const priority = entry.priority ?? "medium";
  return [
    { label: entry.errorType, className: NEUTRAL_TAG },
    { label: priority, className: PRIORITY_PILL[priority] },
    ...(entry.isRepeatMiss ? [{ label: "Repeat miss", className: NEUTRAL_TAG }] : []),
    ...(entry.isGuessedCorrect ? [{ label: "Guessed correct", className: NEUTRAL_TAG }] : []),
    ...(entry.addToFinalSheet ? [{ label: "Final sheet", className: NEUTRAL_TAG }] : []),
  ];
}

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

function StudyPreview({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const hasContent = content.trim().length > 0;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const node = previewRef.current;
    if (!node || !hasContent) {
      setHasOverflow(false);
      return;
    }

    const measureOverflow = () => {
      setHasOverflow(node.scrollHeight - node.clientHeight > 1);
    };

    measureOverflow();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [content, hasContent]);

  return (
    <section className="flex min-h-0 min-w-0 flex-col">
      <p className={REVIEW_LABEL_CLASS}>{label}</p>
      {hasContent ? (
        <div className="mt-1 min-w-0">
          <div
            ref={previewRef}
            className="overflow-hidden pr-1"
            style={{ minHeight: PREVIEW_MAX_HEIGHT, maxHeight: PREVIEW_MAX_HEIGHT }}
          >
            {renderStudyContent(content, PREVIEW_TEXT_CLASS)}
          </div>
          {hasOverflow ? (
            <div className="pointer-events-none mt-1 h-1.5 rounded-full bg-gradient-to-b from-white/[0.07] via-white/[0.02] to-transparent" />
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-[0.84rem] leading-[1.2rem] text-slate-500">Not provided</p>
      )}
    </section>
  );
}

function IconActionButton({
  icon,
  label,
  onClick,
  disabled = false,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors ${className} ${
        disabled ? "cursor-default opacity-70" : "hover:bg-white/5"
      }`}
    >
      {icon}
    </button>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] ${className}`}>
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
  const [reasoningEntryId, setReasoningEntryId] = useState<string | null>(null);
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
  const reasoningEntry = reasoningEntryId ? entries.find((entry) => entry.id === reasoningEntryId) ?? null : null;

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
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total logged" value={String(entries.length)} />
        <MetricCard label="Most common error type" value={mostCommonErrorType ?? "—"} />
        <MetricCard label="Most common category" value={mostCommonSystem ?? "—"} />
        <div className="panel-subtle flex min-h-[132px] min-w-0 flex-col justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Top repeated weak topics</p>
            {topRepeatedWeakTopics.length ? (
              <div className="mt-2 min-w-0">
                <p className="truncate text-[1.75rem] font-semibold tracking-[-0.04em] text-white">
                  {topRepeatedWeakTopics[0][0]}
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-[1.75rem] font-semibold tracking-[-0.04em] text-white">None yet</p>
                <p className="mt-1 text-sm text-slate-300">No repeated misses yet</p>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {topRepeatedWeakTopics.length
              ? `${topRepeatedWeakTopics[0][1]} repeat${topRepeatedWeakTopics[0][1] === 1 ? "" : "s"} tracked · ${topRepeatedWeakTopics.length} repeated topic${topRepeatedWeakTopics.length === 1 ? "" : "s"}`
              : "0 repeats tracked · 0 repeated topics"}
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

            {entries.length > 0 ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-start gap-2 sm:justify-end">
                <input
                  type="text"
                  placeholder="Search topic, source, pattern..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-10 w-full min-w-0 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40 sm:min-w-[20rem] sm:flex-1 sm:max-w-[28rem] lg:max-w-[30rem]"
                />
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
            ) : (
              <div className="flex flex-wrap items-center gap-2">
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

          {/* Compact filters */}
          {entries.length > 0 ? (
            <>
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
          ) : null}
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
            <div className="grid gap-3 pb-4 lg:grid-cols-2">
              {sorted.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isEditing={editingEntry?.id === entry.id}
                  confirmDeleteId={confirmDeleteId}
                  weakTopicAdded={addedWeakTopicIds.has(entry.id)}
                  onShowReasoning={() => setReasoningEntryId(entry.id)}
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

      {reasoningEntry ? (
        <FullReasoningModal entry={reasoningEntry} onClose={() => setReasoningEntryId(null)} />
      ) : null}
    </div>
  );
}

function FullReasoningModal({
  entry,
  onClose,
}: {
  entry: ErrorLogEntry;
  onClose: () => void;
}) {
  const displayDate = formatEntryDate(entry.entryDate || entry.createdAt.slice(0, 10));
  const metadata = [
    entry.system,
    entry.source,
    entry.examBlock,
    displayDate,
  ].filter(Boolean);
  const tags = getEntryTags(entry);
  const nextReview = describeNextReview(entry);

  return (
    <ModalShell
      onClose={onClose}
      position="center"
      titleId="full-reasoning-title"
      contentClassName="max-h-[90vh] w-full max-w-[1080px] overflow-y-auto p-0"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close full reasoning"
        title="Close full reasoning"
        className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-950/75 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="border-b border-white/[0.08] bg-slate-950/45 px-5 py-5 pr-16 sm:px-6 sm:pr-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Full reasoning</p>
            <h3 id="full-reasoning-title" className="mt-2 break-words text-2xl font-semibold leading-tight text-white">
              {entry.topic || "Untitled topic"}
            </h3>
            <p className="mt-2 break-words text-sm leading-5 text-slate-400">{metadata.join(" · ")}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {tags.map((tag) => (
              <Badge key={tag.label} className={tag.className}>
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6">
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div className="space-y-3.5">
            <ReviewSection title="Missed">
              {renderStudyContent(entry.missedPattern)}
            </ReviewSection>

            <ReviewSection title="Why I missed it">
              {renderStudyContent(entry.whyPickedWrongAnswer)}
            </ReviewSection>

            <ReviewSection title="Fix">
              {renderStudyContent(entry.fix)}
            </ReviewSection>

            <ReviewSection title="Additional details">
              <div className="grid gap-2 text-[0.95rem] leading-6 text-slate-200 sm:grid-cols-2">
                <p className="break-words">
                  <span className="text-slate-500">Follow-up:</span>{" "}
                  {FOLLOW_UP_ACTION_LABELS[entry.followUpAction] ?? entry.followUpAction}
                </p>
                <p>
                  <span className="text-slate-500">Repeat miss:</span> {entry.isRepeatMiss ? "Yes" : "No"}
                </p>
                <p>
                  <span className="text-slate-500">Guessed correct:</span> {entry.isGuessedCorrect ? "Yes" : "No"}
                </p>
                <p>
                  <span className="text-slate-500">Final sheet:</span> {entry.addToFinalSheet ? "Yes" : "No"}
                </p>
              </div>
            </ReviewSection>
          </div>

          <div className="space-y-3.5">
            <ReviewSection title="Correct rule">
              {renderStudyContent(entry.whyCorrectAnswerIsCorrect)}
            </ReviewSection>

            <ReviewSection title="Tempting wrong answer">
              {renderStudyContent(entry.whyTemptingWrongAnswerIsWrong)}
            </ReviewSection>

            <ReviewSection title="Decision rule / algorithm">
              {renderStudyContent(entry.decisionRule)}
            </ReviewSection>

            <ReviewSection title="Next action">
              {renderStudyContent(nextReview)}
            </ReviewSection>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function EntryCard({
  entry,
  isEditing,
  confirmDeleteId,
  weakTopicAdded,
  onShowReasoning,
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
  onShowReasoning: () => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onAddWeakTopic: () => void;
}) {
  const priority = entry.priority ?? "medium";
  const displayDate = formatEntryDate(entry.entryDate || entry.createdAt.slice(0, 10));
  const metadata = [
    entry.system,
    entry.source,
    entry.examBlock,
    displayDate,
  ].filter(Boolean);
  const tags = getEntryTags(entry);
  const visibleTags = tags.slice(0, COLLAPSED_CARD_VISIBLE_TAGS);
  const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);

  return (
    <div
      className={`flex min-h-[20rem] w-full flex-col overflow-hidden rounded-2xl border border-l-4 px-4 py-3.5 transition-colors md:h-[20rem] ${
        isEditing
          ? "border-cyan-400/30 bg-cyan-400/[0.06]"
          : "border-white/[0.08] bg-slate-950/45 hover:border-white/15"
      } ${PRIORITY_CARD_ACCENT[priority]}`}
    >
      <div className="grid gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_minmax(11rem,12.75rem)] md:items-start">
        <div className="min-w-0">
          <h3 className="line-clamp-2 break-words text-base font-semibold leading-tight text-white">
            {entry.topic || "Untitled topic"}
          </h3>
        </div>
        <div className="min-w-0 md:max-w-[12.75rem] md:justify-self-end">
          <div className="flex flex-col gap-1 md:items-end">
            <div className="flex flex-wrap gap-1.5 md:justify-end">
              {visibleTags.map((tag) => (
                <Badge key={tag.label} className={tag.className}>
                  {tag.label}
                </Badge>
              ))}
              {hiddenTagCount > 0 ? <Badge className={NEUTRAL_TAG}>+{hiddenTagCount}</Badge> : null}
            </div>
            <p className="line-clamp-2 break-words text-[10px] leading-4 text-slate-400 md:text-right">
              {metadata.join(" · ")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2.5 grid min-h-0 flex-1 grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
        <StudyPreview label="Missed pattern" content={entry.missedPattern} />
        <StudyPreview label="Fix" content={entry.fix} />
        <StudyPreview label="Why wrong answer is tempting" content={entry.whyTemptingWrongAnswerIsWrong} />
        <StudyPreview label="Rule / Algorithm" content={entry.decisionRule} />
      </div>

      <div className="mt-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-2">
        <button
          type="button"
          onClick={onShowReasoning}
          className="text-[10px] font-medium tracking-[0.08em] text-slate-500 transition-colors hover:text-cyan-200"
          aria-haspopup="dialog"
        >
          Show full reasoning
        </button>

        <div className="flex items-center justify-end gap-1">
          {confirmDeleteId === entry.id ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={onDeleteConfirm} className="text-[11px] font-medium text-rose-300 hover:text-rose-200">
                Confirm delete
              </button>
              <button type="button" onClick={onDeleteCancel} className="text-[11px] text-slate-500 hover:text-slate-300">
                Cancel
              </button>
            </div>
          ) : (
            <IconActionButton
              icon={<Plus className="h-4 w-4" />}
              label={weakTopicAdded ? "Already added as weak topic" : "Add as weak topic"}
              onClick={weakTopicAdded ? undefined : onAddWeakTopic}
              disabled={weakTopicAdded}
              className={weakTopicAdded ? "text-emerald-300" : "hover:text-cyan-300"}
            />
          )}

          <IconActionButton
            icon={<Edit2 className="h-4 w-4" />}
            label="Edit"
            onClick={onEdit}
            className="hover:text-cyan-300"
          />
          <IconActionButton
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            onClick={onDeleteRequest}
            className="hover:text-rose-300"
          />
        </div>
      </div>
    </div>
  );
}

function ReviewSection({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${REVIEW_SECTION_CLASS} ${className}`}>
      <p className={REVIEW_LABEL_CLASS}>{title}</p>
      <div className="mt-2 text-[0.95rem] leading-6 text-slate-200">{children}</div>
    </section>
  );
}
