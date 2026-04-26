import { ChevronLeft, ChevronRight, Edit3, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { getWeakTopicPlannerInsights, type WeakTopicPlannerInsight } from "../lib/analytics";
import { formatShortDate, getTodayKey } from "../lib/datetime";
import {
  WEAK_TOPIC_PRIORITY_VALUES,
  WEAK_TOPIC_STATUS_VALUES,
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

const DISPLAY_STATUSES = ["Active", "Improving", "Resolved"] as const;
type DisplayStatus = typeof DISPLAY_STATUSES[number];

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

function entryDisplayStatus(status: string): DisplayStatus {
  if (status === "Improving") return "Improving";
  if (status === "Resolved") return "Resolved";
  return "Active";
}

function StatusArrows({
  status,
  onChangeStatus,
}: {
  status: string;
  onChangeStatus: (newStatus: DisplayStatus) => void;
}) {
  const display = entryDisplayStatus(status);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {display !== "Active" && (
        <button
          type="button"
          onClick={() => onChangeStatus(display === "Resolved" ? "Improving" : "Active")}
          className={`${iconButtonClassName} !p-1`}
          title={display === "Resolved" ? "Move to Improving" : "Move to Active"}
          aria-label={display === "Resolved" ? "Move to Improving" : "Move to Active"}
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
      )}
      {display !== "Resolved" && (
        <button
          type="button"
          onClick={() => onChangeStatus(display === "Active" ? "Improving" : "Resolved")}
          className={`${iconButtonClassName} !p-1`}
          title={display === "Active" ? "Move to Improving" : "Move to Resolved"}
          aria-label={display === "Active" ? "Move to Improving" : "Move to Resolved"}
        >
          <ChevronRight className="h-3 w-3" />
        </button>
      )}
    </div>
  );
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
  const topicRef = { current: null as HTMLInputElement | null };
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const topicId = `${id}-topic`;
  const topicErrorId = `${id}-topic-error`;
  const priorityId = `${id}-priority`;
  const statusId = `${id}-status`;
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

          if (!entry) {
            const isDuplicate = existingTopics.some(
              (t) => t.toLowerCase() === normalizedTopic.toLowerCase(),
            );
            if (isDuplicate) {
              nextErrors.topic = "This topic already exists.";
            }
          }

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

        <div className="grid gap-4 sm:grid-cols-2">
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
          <div>
            <label htmlFor={statusId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Status</label>
            <select
              id={statusId}
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as WeakTopicInput["status"],
                }))
              }
              className={`${fieldClassName} mt-2`}
            >
              {WEAK_TOPIC_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
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

export function WeakTopicsView() {
  const { state, trashWeakTopic, upsertWeakTopic, upsertStudyBlock } = useAppStore();
  const [editorEntry, setEditorEntry] = useState<WeakTopicEntry | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [taskSeed, setTaskSeed] = useState<{ taskName: string; category: string } | null>(null);

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

  const existingTopics = useMemo(
    () => state.weakTopicEntries.map((e) => e.topic),
    [state.weakTopicEntries],
  );

  function getColumnEntries(status: DisplayStatus): WeakTopicPlannerInsight[] {
    return status === "Active"
      ? insights.filter((e) => e.status === "Active" || (e.status as string) === "Watching")
      : insights.filter((e) => e.status === status);
  }

  function handleStatusChange(entry: WeakTopicPlannerInsight, newStatus: DisplayStatus) {
    const storeEntry = state.weakTopicEntries.find((e) => e.id === entry.id);
    if (storeEntry) void upsertWeakTopic({ ...storeEntry, status: newStatus });
  }

  // Metric card derived values
  const unscheduledCount = insights.filter((e) => e.linkedBlockCount === 0 && e.status !== "Resolved").length;

  const recurringInsight = insights
    .filter((e) => e.occurrenceCount > 1)
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0];

  const latestInsight = insights
    .slice()
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];

  const latestLabel = latestInsight
    ? `Latest Weak Topic: ${latestInsight.lastSeenAt === today ? "Today" : formatShortDate(latestInsight.lastSeenAt)}`
    : "Latest Weak Topic";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Logged topics"
          value={`${state.weakTopicEntries.length}`}
        />
        <MetricCard
          label="Recurring Weakest Topic"
          value={recurringInsight ? `${recurringInsight.occurrenceCount}×` : "—"}
          meta={recurringInsight ? recurringInsight.topic : "No repeating topics yet"}
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

      <Panel
        title="Priority"
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Unscheduled: {unscheduledCount}
            </span>
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
        {insights.length ? (
          <div className="space-y-4">
            {WEAK_TOPIC_PRIORITY_VALUES.map((priority) => {
              const priorityInsights = insights.filter((e) => e.priority === priority);
              if (!priorityInsights.length) return null;
              return (
                <div key={priority}>
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-[0.18em] ${priorityHeadingStyle[priority]}`}>
                    {priority} Priority
                  </p>
                  <div className="grid gap-3 md:grid-cols-3">
                    {priorityInsights.map((entry) => (
                      <div
                        key={entry.id}
                        className={`rounded-[16px] border p-4 ${prioritySectionStyle[priority]}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-semibold text-white">{entry.topic}</p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              {entry.occurrenceCount > 0 ? `${entry.occurrenceCount}× flagged weak` : "Manual entry"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <StatusArrows
                              status={entry.status}
                              onChangeStatus={(newStatus) => handleStatusChange(entry, newStatus)}
                            />
                            <button
                              type="button"
                              className={iconButtonClassName}
                              onClick={() => setTaskSeed({ taskName: entry.topic, category: "Review" })}
                              aria-label={`Add task for ${entry.topic}`}
                              title="Add to tasks"
                            >
                              <Plus className="h-3.5 w-3.5" />
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
                        <p className="mt-2 text-sm leading-6 text-slate-200">
                          Scheduled review: {entry.linkedBlockCount}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No weak topics yet"
            description="Topics from tests and manual entries will appear here."
            compact
          />
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-3">
        {DISPLAY_STATUSES.map((status) => {
          const entries = getColumnEntries(status);

          return (
            <div
              key={status}
              className="glass-panel min-w-0"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{status}</h3>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-400">
                  {entries.length}
                </span>
              </div>

              <div className="max-h-[332px] space-y-2 overflow-y-auto pr-0.5">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-[14px] border border-white/10 bg-slate-900/55 px-3 py-2.5 transition select-none"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${priorityDotClass[entry.priority] ?? "bg-slate-400"}`} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                        {entry.topic}
                      </span>
                      <StatusArrows
                        status={entry.status}
                        onChangeStatus={(newStatus) => handleStatusChange(entry, newStatus)}
                      />
                      <button
                        type="button"
                        className={iconButtonClassName}
                        onClick={() => setTaskSeed({ taskName: entry.topic, category: "Review" })}
                        aria-label={`Add task for ${entry.topic}`}
                        title="Add task"
                      >
                        <Plus className="h-3.5 w-3.5" />
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
                    {entry.sourceLabel && (
                      <p className="mt-1 truncate pl-4 text-xs text-slate-500">
                        {entry.sourceLabel}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {entries.length === 0 && (
                <div className="flex min-h-[100px] items-center justify-center rounded-[14px] border border-dashed border-white/10 bg-white/[0.02] px-4 text-center text-sm text-slate-400">
                  No {status.toLowerCase()} topics
                </div>
              )}
            </div>
          );
        })}
      </div>

      {taskSeed ? (
        <StudyTaskEditorSheet
          seedDate={today}
          seedTaskName={taskSeed.taskName}
          seedCategory={taskSeed.category}
          onClose={() => setTaskSeed(null)}
          onSave={(draft) => {
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
              }
            })();
          }}
        />
      ) : null}

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
              const saved = await upsertWeakTopic(draft);
              if (saved) {
                setShowEditor(false);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
