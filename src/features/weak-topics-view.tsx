import { Check, Edit3, History, Plus, Undo2, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { getWeakTopicPlannerInsights, type WeakTopicPlannerInsight } from "../lib/analytics";
import { formatShortDate, getTodayKey } from "../lib/datetime";
import {
  WEAK_TOPIC_PRIORITY_VALUES,
  validateWeakTopicInput,
} from "../lib/storage";
import {
  fieldClassName,
  iconButtonClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "../lib/ui";
import { useAppStore } from "../state/app-store";
import { ModalShell } from "../components/modal-shell";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { EmptyState, MetricCard, Panel } from "../components/ui";
import type { StudyBlockInput, WeakTopicEntry, WeakTopicInput } from "../types/models";

const priorityDotClass: Record<string, string> = {
  High: "bg-rose-400",
  Medium: "bg-amber-400",
  Low: "bg-slate-400",
};

const prioritySectionStyle: Record<string, string> = {
  High: "border-rose-500/30 bg-rose-950/20",
  Medium: "border-amber-500/30 bg-amber-900/15",
  Low: "border-cyan-500/20 bg-cyan-950/10",
};

const priorityHeadingStyle: Record<string, string> = {
  High: "text-rose-300",
  Medium: "text-amber-300",
  Low: "text-cyan-300",
};

function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function createInitialDraft(entry?: WeakTopicEntry): WeakTopicInput & { id?: string } {
  if (!entry) {
    return {
      topic: "",
      entryType: "manual",
      priority: "High",
      status: "Active",
      lastSeenAt: new Date().toISOString().slice(0, 10),
      sourceLabel: "Manual",
      notes: "",
    };
  }

  return {
    id: entry.id,
    topic: entry.topic,
    entryType: entry.entryType,
    priority: entry.priority,
    status: entry.status,
    lastSeenAt: entry.lastSeenAt,
    sourceLabel: entry.sourceLabel,
    notes: entry.notes,
  };
}

function WeakTopicEditorSheet({
  entry,
  onClose,
  onSave,
  onDelete,
  existingTopics,
}: {
  entry?: WeakTopicEntry;
  onClose: () => void;
  onSave: (draft: WeakTopicInput & { id?: string }) => void;
  onDelete?: (id: string) => void;
  existingTopics: string[];
}) {
  const [draft, setDraft] = useState(createInitialDraft(entry));
  const [errors, setErrors] = useState<Partial<Record<"topic", string>>>({});
  const [topicInput, setTopicInput] = useState(draft.topic);
  const [showDropdown, setShowDropdown] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const id = useId();
  const topicRef = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const topicId = `${id}-topic`;
  const topicErrorId = `${id}-topic-error`;
  const priorityId = `${id}-priority`;
  const lastSeenId = `${id}-last-seen`;
  const sourceId = `${id}-source`;
  const notesId = `${id}-notes`;

  const filteredSuggestions = useMemo(
    () =>
      existingTopics
        .filter((t) => t.toLowerCase().includes(topicInput.toLowerCase()) && topicInput.length > 0)
        .slice(0, 7),
    [existingTopics, topicInput],
  );

  return (
    <ModalShell
      onClose={onClose}
      position="side"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={topicRef}
      contentClassName="max-w-[520px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {entry ? "Edit weak topic" : "New weak topic"}
          </p>
          <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
            {entry ? entry.topic : "Add weak topic"}
          </h3>
          <p id={descriptionId} className="mt-2 text-sm text-slate-400">
            Track a weak topic manually or refine details pulled in from assessments.
          </p>
        </div>
        <button type="button" onClick={onClose} className={secondaryButtonClassName} aria-label="Close weak topic editor">
          Close
        </button>
      </div>

      <form
        noValidate
        className="mt-8 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedTopic = toTitleCase(topicInput.trim());
          const nextErrors = validateWeakTopicInput({ ...draft, topic: normalizedTopic });

          if (Object.keys(nextErrors).length) {
            setErrors(nextErrors);
            return;
          }

          onSave({ ...draft, topic: normalizedTopic });
        }}
      >
        <div>
          <label htmlFor={topicId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Topic</label>
          <div className="relative mt-2">
            <input
              ref={(el) => { topicRef.current = el; }}
              id={topicId}
              value={topicInput}
              onChange={(event) => {
                const val = event.target.value;
                setTopicInput(val);
                setDraft((current) => ({ ...current, topic: val }));
                setErrors((current) => ({ ...current, topic: undefined }));
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              onKeyDown={(e) => { if (e.key === "Escape") setShowDropdown(false); }}
              aria-describedby={errors.topic ? topicErrorId : undefined}
              aria-invalid={Boolean(errors.topic)}
              className={fieldClassName}
              placeholder="Cardio murmurs, postpartum hemorrhage, ethics..."
              autoComplete="off"
            />
            {showDropdown && filteredSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[220px] overflow-y-auto rounded-[14px] border border-white/10 bg-slate-900 py-1 shadow-xl">
                {filteredSuggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    className="w-full px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTopicInput(suggestion);
                      setDraft((current) => ({ ...current, topic: suggestion }));
                      setShowDropdown(false);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
          {errors.topic ? <p id={topicErrorId} className="mt-2 text-sm text-rose-300">{errors.topic}</p> : null}
        </div>

        <div>
          <label htmlFor={priorityId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Priority</label>
          <select
            id={priorityId}
            value={draft.priority}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: event.target.value as WeakTopicInput["priority"],
              }))
            }
            className={`${fieldClassName} mt-2`}
          >
            {WEAK_TOPIC_PRIORITY_VALUES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={lastSeenId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Last seen</label>
            <input
              id={lastSeenId}
              type="date"
              value={draft.lastSeenAt}
              onChange={(event) => setDraft((current) => ({ ...current, lastSeenAt: event.target.value }))}
              className={`${fieldClassName} mt-2`}
            />
          </div>
          <div>
            <label htmlFor={sourceId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Latest source</label>
            <input
              id={sourceId}
              value={draft.sourceLabel}
              onChange={(event) => setDraft((current) => ({ ...current, sourceLabel: event.target.value }))}
              className={`${fieldClassName} mt-2`}
              placeholder="NBME 13, Manual, UWSA 2..."
            />
          </div>
        </div>

        <div>
          <label htmlFor={notesId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Notes</label>
          <textarea
            id={notesId}
            value={draft.notes}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            className={`${fieldClassName} mt-2 min-h-[160px] resize-none`}
            placeholder="What keeps going wrong, what to revisit, what to watch next time..."
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-4">
          <div>
            {entry && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Delete this topic?</span>
                  <button
                    type="button"
                    onClick={() => { onDelete(entry.id); }}
                    className="text-xs font-medium text-rose-400 hover:text-rose-300"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-slate-500 hover:text-rose-400 transition-colors"
                >
                  Delete topic
                </button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" className={secondaryButtonClassName} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClassName}>
              Save topic
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

type HistorySortMode = "recent" | "source" | "priority" | "flagged";

function HistoryModal({
  insights,
  onClose,
  onUndo,
}: {
  insights: WeakTopicPlannerInsight[];
  onClose: () => void;
  onUndo: (entry: WeakTopicPlannerInsight) => void;
}) {
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<HistorySortMode>("recent");
  const id = useId();
  const titleId = `${id}-history-title`;

  const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = q
      ? insights.filter(
          (e) =>
            e.topic.toLowerCase().includes(q) ||
            e.sourceLabel.toLowerCase().includes(q),
        )
      : [...insights];

    switch (sortMode) {
      case "recent":
        result.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
        break;
      case "source":
        result.sort((a, b) => a.sourceLabel.localeCompare(b.sourceLabel) || b.lastSeenAt.localeCompare(a.lastSeenAt));
        break;
      case "priority":
        result.sort(
          (a, b) =>
            (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3) ||
            b.lastSeenAt.localeCompare(a.lastSeenAt),
        );
        break;
      case "flagged":
        result.sort((a, b) => b.occurrenceCount - a.occurrenceCount || b.lastSeenAt.localeCompare(a.lastSeenAt));
        break;
    }

    return result;
  }, [insights, search, sortMode]);

  return (
    <ModalShell
      onClose={onClose}
      position="center"
      titleId={titleId}
      contentClassName="max-w-[640px] w-full"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-slate-400" />
          <h3 id={titleId} className="text-xl font-semibold text-white">History</h3>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-400">
            {insights.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${iconButtonClassName} !p-1.5`}
          aria-label="Close history"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by topic or source…"
          className={`${fieldClassName} flex-1`}
        />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as HistorySortMode)}
          className={`${fieldClassName} w-40 shrink-0`}
        >
          <option value="recent">Recent</option>
          <option value="source">Source</option>
          <option value="priority">Priority</option>
          <option value="flagged">Times flagged</option>
        </select>
      </div>

      <div className="mt-4 max-h-[480px] space-y-2 overflow-y-auto pr-0.5">
        {filtered.length === 0 && (
          <div className="flex min-h-[120px] items-center justify-center text-sm text-slate-500">
            {search ? "No matching history entries." : "No topics in history yet."}
          </div>
        )}
        {filtered.map((entry) => (
          <div
            key={entry.id}
            className="rounded-[14px] border border-white/10 bg-slate-900/55 px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${priorityDotClass[entry.priority] ?? "bg-slate-400"}`} />
                  <p className="truncate text-sm font-semibold text-white">{entry.topic}</p>
                  <span className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {entry.priority}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-4 text-xs text-slate-400">
                  {entry.lastSeenAt && (
                    <span>Last seen: {formatShortDate(entry.lastSeenAt)}</span>
                  )}
                  {entry.sourceLabel && <span>{entry.sourceLabel}</span>}
                  <span>{entry.occurrenceCount > 0 ? `${entry.occurrenceCount}× flagged weak` : "Manual entry"}</span>
                  {entry.linkedBlockCount > 0 && (
                    <span>Scheduled review: {entry.linkedBlockCount}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onUndo(entry)}
                className={`${iconButtonClassName} shrink-0 gap-1 !px-2 !py-1 text-xs`}
                aria-label={`Restore ${entry.topic}`}
                title="Restore to active"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

export function WeakTopicsView() {
  const { state, trashWeakTopic, upsertWeakTopic, upsertStudyBlock } = useAppStore();
  const [editorEntry, setEditorEntry] = useState<WeakTopicEntry | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [taskSeed, setTaskSeed] = useState<{ taskName: string; category: string; entryTopic: string } | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 3000);
    return () => clearTimeout(timer);
  }, [successToast]);

  const today = getTodayKey();

  const insights = useMemo(
    () =>
      getWeakTopicPlannerInsights(state.weakTopicEntries, state.practiceTests, state.studyBlocks).sort(
        (left, right) =>
          right.occurrenceCount - left.occurrenceCount ||
          right.linkedBlockCount - left.linkedBlockCount ||
          left.topic.localeCompare(right.topic),
      ),
    [state.practiceTests, state.studyBlocks, state.weakTopicEntries],
  );

  const activeInsights = useMemo(
    () => insights.filter((e) => e.status !== "Resolved"),
    [insights],
  );

  const historyInsights = useMemo(
    () => insights.filter((e) => e.status === "Resolved"),
    [insights],
  );

  const existingTopics = useMemo(
    () => state.weakTopicEntries.map((e) => e.topic),
    [state.weakTopicEntries],
  );

  function handleSendToHistory(entry: WeakTopicPlannerInsight) {
    const storeEntry = state.weakTopicEntries.find((e) => e.id === entry.id);
    if (storeEntry) void upsertWeakTopic({ ...storeEntry, status: "Resolved" });
  }

  function handleUndoHistory(entry: WeakTopicPlannerInsight) {
    const storeEntry = state.weakTopicEntries.find((e) => e.id === entry.id);
    if (storeEntry) void upsertWeakTopic({ ...storeEntry, status: "Active" });
  }

  const unscheduledCount = activeInsights.filter((e) => e.linkedBlockCount === 0).length;

  const recurringInsight = activeInsights
    .filter((e) => e.occurrenceCount > 1)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0];

  const latestInsight = insights
    .slice()
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];

  const latestLabel = latestInsight
    ? `Latest Weak Topic: ${latestInsight.lastSeenAt === today ? "Today" : formatShortDate(latestInsight.lastSeenAt)}`
    : "Latest Weak Topic";

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Metric cards */}
      <div className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Logged topics"
          value={`${state.weakTopicEntries.length}`}
        />
        <MetricCard
          label="Recurring Weakest Topic"
          value={recurringInsight ? recurringInsight.topic : "—"}
          meta={recurringInsight ? `${recurringInsight.occurrenceCount}x flagged weak` : "No repeating topics yet"}
        />
        <MetricCard
          label="Unscheduled Topics"
          value={`${unscheduledCount}`}
        />
        <MetricCard
          label={latestLabel}
          value={latestInsight ? latestInsight.topic : "—"}
        />
      </div>

      {/* Priority panel — fills remaining height */}
      <Panel
        title="Priority"
        className="flex min-h-0 flex-1 flex-col"
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Unscheduled: {unscheduledCount}
            </span>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => setShowHistory(true)}
            >
              <History className="h-4 w-4" />
              History
              {historyInsights.length > 0 && (
                <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {historyInsights.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                setEditorEntry(undefined);
                setShowEditor(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Add topic
            </button>
          </div>
        }
      >
        {activeInsights.length > 0 ? (
          <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
            {WEAK_TOPIC_PRIORITY_VALUES.map((priority) => {
              const priorityInsights = activeInsights.filter((e) => e.priority === priority);
              return (
                <div
                  key={priority}
                  className={`flex min-h-0 flex-col rounded-[16px] border ${prioritySectionStyle[priority]}`}
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
                    <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${priorityHeadingStyle[priority]}`}>
                      {priority} Priority
                    </p>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-400">
                      {priorityInsights.length}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                    {priorityInsights.map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-[12px] border border-white/10 bg-slate-900/50 px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold leading-tight text-white">{entry.topic}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.occurrenceCount > 0 ? `${entry.occurrenceCount}× flagged weak` : "Manual entry"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <button
                              type="button"
                              className={iconButtonClassName}
                              onClick={() => setTaskSeed({ taskName: entry.topic, category: "Review", entryTopic: entry.topic })}
                              aria-label={`Add task for ${entry.topic}`}
                              title="Add to tasks"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={iconButtonClassName}
                              onClick={() => handleSendToHistory(entry)}
                              aria-label={`Mark ${entry.topic} as done`}
                              title="Mark as done (move to History)"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={iconButtonClassName}
                              onClick={() => {
                                const storeEntry = state.weakTopicEntries.find((e) => e.id === entry.id);
                                setEditorEntry(storeEntry);
                                setShowEditor(true);
                              }}
                              aria-label={`Edit ${entry.topic}`}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-slate-300">
                          Scheduled review: {entry.linkedBlockCount}
                        </p>
                      </div>
                    ))}
                    {priorityInsights.length === 0 && (
                      <div className="flex h-full items-center justify-center text-xs text-slate-500">
                        No {priority.toLowerCase()} priority topics
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No active weak topics"
            description="Topics from tests and manual entries will appear here. Topics marked done move to History."
            compact
          />
        )}
      </Panel>

      {/* Task seeder sheet */}
      {taskSeed ? (
        <StudyTaskEditorSheet
          seedDate={today}
          seedTaskName={taskSeed.taskName}
          seedCategory={taskSeed.category}
          onClose={() => setTaskSeed(null)}
          onSave={(draft) => {
            const topicName = taskSeed?.entryTopic ?? taskSeed?.taskName ?? "";
            void (async () => {
              const maxOrderForDate = Math.max(
                -1,
                ...state.studyBlocks
                  .filter((task) => task.date === draft.date)
                  .map((task) => task.order),
              );
              const saved = await upsertStudyBlock({
                ...draft,
                order: maxOrderForDate + 1,
              } satisfies StudyBlockInput & { id?: string });
              if (saved) {
                setTaskSeed(null);
                setSuccessToast(`${topicName} was successfully added as a Task`);
              }
            })();
          }}
        />
      ) : null}

      {/* Success toast */}
      {successToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[14px] border border-white/10 bg-slate-800 px-4 py-3 text-sm text-white shadow-xl">
          {successToast}
        </div>
      )}

      {/* Editor sheet */}
      {showEditor ? (
        <WeakTopicEditorSheet
          entry={editorEntry}
          onClose={() => setShowEditor(false)}
          existingTopics={existingTopics.filter((t) => t !== editorEntry?.topic)}
          onDelete={(id) => {
            void trashWeakTopic(id);
            setShowEditor(false);
          }}
          onSave={(draft) => {
            void (async () => {
              let saveDraft = draft;
              if (!draft.id) {
                const existingEntry = state.weakTopicEntries.find(
                  (e) => e.topic.toLowerCase() === draft.topic.toLowerCase(),
                );
                if (existingEntry) {
                  // Duplicate manual add: reuse the existing entry's ID and increment
                  // manualOccurrenceCount so [n]x flagged weak reflects repeated manual flags.
                  saveDraft = {
                    ...draft,
                    id: existingEntry.id,
                    manualOccurrenceCount: (existingEntry.manualOccurrenceCount ?? 0) + 1,
                  };
                }
              }
              const saved = await upsertWeakTopic(saveDraft);
              if (saved) {
                setShowEditor(false);
              }
            })();
          }}
        />
      ) : null}

      {/* History modal */}
      {showHistory ? (
        <HistoryModal
          insights={historyInsights}
          onClose={() => setShowHistory(false)}
          onUndo={(entry) => {
            handleUndoHistory(entry);
          }}
        />
      ) : null}
    </div>
  );
}
