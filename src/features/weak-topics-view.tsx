import { Edit3, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { getWeakTopicPlannerInsights } from "../lib/analytics";
import { formatLongDate, formatShortDate } from "../lib/datetime";
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
import { EmptyState, MetricCard, Panel } from "../components/ui";
import type { WeakTopicEntry, WeakTopicInput, WeakTopicStatus } from "../types/models";

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
}: {
  entry?: WeakTopicEntry;
  onClose: () => void;
  onSave: (draft: WeakTopicInput & { id?: string }) => void;
}) {
  const [draft, setDraft] = useState(createInitialDraft(entry));
  const [errors, setErrors] = useState<Partial<Record<"topic", string>>>({});
  const id = useId();
  const topicRef = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const topicId = `${id}-topic`;
  const topicErrorId = `${id}-topic-error`;
  const priorityId = `${id}-priority`;
  const statusId = `${id}-status`;
  const lastSeenId = `${id}-last-seen`;
  const sourceId = `${id}-source`;
  const notesId = `${id}-notes`;

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
          const nextErrors = validateWeakTopicInput(draft);

          if (Object.keys(nextErrors).length) {
            setErrors(nextErrors);
            return;
          }

          onSave(draft);
        }}
      >
        <div>
          <label htmlFor={topicId} className="text-xs uppercase tracking-[0.18em] text-slate-500">Topic</label>
          <input
            ref={topicRef}
            id={topicId}
            value={draft.topic}
            onChange={(event) => {
              setDraft((current) => ({ ...current, topic: event.target.value }));
              setErrors((current) => ({ ...current, topic: undefined }));
            }}
            aria-describedby={errors.topic ? topicErrorId : undefined}
            aria-invalid={Boolean(errors.topic)}
            className={`${fieldClassName} mt-2`}
            placeholder="Cardio murmurs, postpartum hemorrhage, ethics..."
          />
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

        <div className="flex items-center justify-end gap-3 pt-4">
          <button type="button" className={secondaryButtonClassName} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClassName}>
            Save topic
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function WeakTopicsView() {
  const { state, trashWeakTopic, upsertWeakTopic } = useAppStore();
  const [editorEntry, setEditorEntry] = useState<WeakTopicEntry | undefined>();
  const [showEditor, setShowEditor] = useState(false);

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

  const groupedByStatus = WEAK_TOPIC_STATUS_VALUES.reduce<Record<WeakTopicStatus, typeof insights>>(
    (groups, status) => {
      groups[status] = insights.filter((entry) => entry.status === status);
      return groups;
    },
    {
      Active: [],
      Watching: [],
      Improving: [],
      Resolved: [],
    },
  );

  const uncoveredCount = insights.filter((entry) => entry.linkedBlockCount === 0 && entry.status !== "Resolved").length;
  const recurringCount = insights.filter((entry) => entry.occurrenceCount > 1).length;
  const latestInsight = insights
    .slice()
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Logged topics"
          value={`${state.weakTopicEntries.length}`}
          meta="Saved weak-topic entries"
        />
        <MetricCard
          label="Recurring topics"
          value={`${recurringCount}`}
          meta="Seen more than once across assessments"
        />
        <MetricCard
          label="Uncovered topics"
          value={`${uncoveredCount}`}
          meta="Active topics with no clear future coverage"
        />
        <MetricCard
          label="Latest signal"
          value={latestInsight ? formatShortDate(latestInsight.lastSeenAt) : "—"}
          meta={latestInsight ? latestInsight.topic : "No weak topics logged yet"}
        />
      </div>

      <Panel
        title="Priority"
        action={
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
        }
      >
        {insights.length ? (
          <div className="grid gap-3 md:grid-cols-3">
            {insights.slice(0, 3).map((entry) => (
              <div key={entry.id} className="task-card task-card--assessment">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="lane-pill">{entry.priority} priority</span>
                    <p className="mt-3 text-lg font-semibold text-white">{entry.topic}</p>
                  </div>
                  <p className="text-sm font-semibold text-white">{entry.occurrenceCount}x</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-200">
                  {entry.linkedBlockCount
                    ? `${entry.linkedBlockCount} future blocks already cover this topic.`
                    : "No future block is clearly linked yet."}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Last seen {formatLongDate(entry.lastSeenAt)} · {entry.sourceLabel}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No weak topics yet"
            description="Topics from tests and manual entries will appear here."
            compact
          />
        )}
      </Panel>

      <div className="grid gap-4 2xl:grid-cols-4 xl:grid-cols-2">
        {WEAK_TOPIC_STATUS_VALUES.map((status) => (
          <Panel
            key={status}
            title={status}
            subtitle={`${groupedByStatus[status].length} topics`}
            className="min-h-[320px]"
          >
            {groupedByStatus[status].length ? (
              <div className="space-y-3">
                {groupedByStatus[status].map((entry) => (
                  <div key={entry.id} className="task-card task-card--review task-card--compact">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{entry.topic}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                          {entry.priority} priority · {entry.occurrenceCount} occurrences
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className={iconButtonClassName}
                          onClick={() => {
                            const storeEntry = state.weakTopicEntries.find((candidate) => candidate.id === entry.id);
                            setEditorEntry(storeEntry);
                            setShowEditor(true);
                          }}
                          aria-label={`Edit ${entry.topic}`}
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className={iconButtonClassName}
                          onClick={() => {
                            if (window.confirm(`Move "${entry.topic}" to weak-topic trash?`)) {
                              void trashWeakTopic(entry.id);
                            }
                          }}
                          aria-label={`Delete ${entry.topic}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">
                      {entry.linkedBlockCount
                        ? `${entry.linkedBlockCount} linked future blocks${entry.nextTouchDate ? ` · next ${formatShortDate(entry.nextTouchDate)}` : ""}`
                        : "No linked future blocks yet"}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      {entry.notes || `Latest source: ${entry.sourceLabel}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[180px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 text-center text-sm text-slate-400">
                No topics in {status.toLowerCase()} yet.
              </div>
            )}
          </Panel>
        ))}
      </div>

      {showEditor ? (
        <WeakTopicEditorSheet
          entry={editorEntry}
          onClose={() => setShowEditor(false)}
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
