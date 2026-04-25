import { Edit3, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { getWeakTopicPlannerInsights, type WeakTopicPlannerInsight } from "../lib/analytics";
import { formatShortDate, formatLongDate } from "../lib/datetime";
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
import type { WeakTopicEntry, WeakTopicInput } from "../types/models";

const DISPLAY_STATUSES = ["Active", "Improving", "Resolved"] as const;
type DisplayStatus = typeof DISPLAY_STATUSES[number];

const priorityDotClass: Record<string, string> = {
  High: "bg-rose-400",
  Medium: "bg-amber-400",
  Low: "bg-slate-400",
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
  existingTopics,
}: {
  entry?: WeakTopicEntry;
  onClose: () => void;
  onSave: (draft: WeakTopicInput & { id?: string }) => void;
  existingTopics: string[];
}) {
  const [draft, setDraft] = useState(createInitialDraft(entry));
  const [errors, setErrors] = useState<Partial<Record<"topic", string>>>({});
  const [topicInput, setTopicInput] = useState(draft.topic);
  const [showDropdown, setShowDropdown] = useState(false);
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
              ref={topicRef}
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

  const dragRef = useRef<{ id: string; fromStatus: DisplayStatus } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<DisplayStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const [columnOrder, setColumnOrder] = useState<Record<DisplayStatus, string[]>>({
    Active: [],
    Improving: [],
    Resolved: [],
  });

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
    const statusInsights = status === "Active"
      ? insights.filter((e) => e.status === "Active" || e.status === "Watching")
      : insights.filter((e) => e.status === status);

    const order = columnOrder[status];
    if (!order.length) return statusInsights;

    const byId = new Map(statusInsights.map((e) => [e.id, e]));
    const ordered = order.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
    const orderedIds = new Set(order);
    const remaining = statusInsights.filter((e) => !orderedIds.has(e.id));
    return [...ordered, ...remaining];
  }

  function handleCardDragStart(id: string, fromStatus: DisplayStatus, e: React.DragEvent) {
    dragRef.current = { id, fromStatus };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  function handleDragEnd() {
    dragRef.current = null;
    setDragOverColumn(null);
    setDragOverCardId(null);
  }

  function handleColumnDragOver(status: DisplayStatus, e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
  }

  function handleCardDragOver(cardId: string, status: DisplayStatus, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
    setDragOverCardId(cardId);
  }

  function handleColumnDrop(targetStatus: DisplayStatus, e: React.DragEvent) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.fromStatus === targetStatus) {
      if (!dragOverCardId) {
        const ids = getColumnEntries(targetStatus).map((entry) => entry.id).filter((id) => id !== drag.id);
        ids.push(drag.id);
        setColumnOrder((prev) => ({ ...prev, [targetStatus]: ids }));
      }
    } else {
      const storeEntry = state.weakTopicEntries.find((entry) => entry.id === drag.id);
      if (storeEntry) {
        void upsertWeakTopic({ ...storeEntry, status: targetStatus });
      }
      const fromIds = getColumnEntries(drag.fromStatus).map((entry) => entry.id).filter((id) => id !== drag.id);
      const toIds = getColumnEntries(targetStatus).map((entry) => entry.id);
      if (!dragOverCardId) toIds.push(drag.id);
      setColumnOrder((prev) => ({
        ...prev,
        [drag.fromStatus]: fromIds,
        [targetStatus]: toIds,
      }));
    }

    setDragOverColumn(null);
    setDragOverCardId(null);
    dragRef.current = null;
  }

  function handleCardDrop(targetCardId: string, targetStatus: DisplayStatus, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const drag = dragRef.current;
    if (!drag || drag.id === targetCardId) return;

    if (drag.fromStatus === targetStatus) {
      const ids = getColumnEntries(targetStatus).map((entry) => entry.id);
      const fromIdx = ids.indexOf(drag.id);
      if (fromIdx !== -1) ids.splice(fromIdx, 1);
      const toIdx = ids.indexOf(targetCardId);
      if (toIdx !== -1) ids.splice(toIdx, 0, drag.id);
      else ids.push(drag.id);
      setColumnOrder((prev) => ({ ...prev, [targetStatus]: ids }));
    } else {
      const storeEntry = state.weakTopicEntries.find((entry) => entry.id === drag.id);
      if (storeEntry) {
        void upsertWeakTopic({ ...storeEntry, status: targetStatus });
      }
      const fromIds = getColumnEntries(drag.fromStatus).map((entry) => entry.id).filter((id) => id !== drag.id);
      const toIds = getColumnEntries(targetStatus).map((entry) => entry.id);
      const toIdx = toIds.indexOf(targetCardId);
      if (toIdx !== -1) toIds.splice(toIdx, 0, drag.id);
      else toIds.push(drag.id);
      setColumnOrder((prev) => ({
        ...prev,
        [drag.fromStatus]: fromIds,
        [targetStatus]: toIds,
      }));
    }

    setDragOverColumn(null);
    setDragOverCardId(null);
    dragRef.current = null;
  }

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

      <div className="grid gap-4 md:grid-cols-3">
        {DISPLAY_STATUSES.map((status) => {
          const entries = getColumnEntries(status);
          const isOver = dragOverColumn === status;

          return (
            <div
              key={status}
              className={`glass-panel min-w-0 transition ${isOver ? "ring-1 ring-cyan-300/40" : ""}`}
              onDragOver={(e) => handleColumnDragOver(status, e)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverColumn(null);
                  setDragOverCardId(null);
                }
              }}
              onDrop={(e) => handleColumnDrop(status, e)}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{status}</h3>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-400">
                  {entries.length}
                </span>
              </div>

              <div className="max-h-[332px] space-y-2 overflow-y-auto pr-0.5">
                {entries.map((entry) => {
                  const isDraggingThis = dragRef.current?.id === entry.id;
                  const isDropTarget = dragOverCardId === entry.id;

                  return (
                    <div
                      key={entry.id}
                      draggable
                      onDragStart={(e) => handleCardDragStart(entry.id, status, e)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleCardDragOver(entry.id, status, e)}
                      onDrop={(e) => handleCardDrop(entry.id, status, e)}
                      className={[
                        "cursor-grab rounded-[14px] border border-white/10 bg-slate-900/55 px-3 py-2.5 transition select-none",
                        isDraggingThis ? "opacity-40" : "",
                        isDropTarget ? "ring-1 ring-cyan-300/50" : "",
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${priorityDotClass[entry.priority] ?? "bg-slate-400"}`} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                          {entry.topic}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {formatShortDate(entry.lastSeenAt)}
                        </span>
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
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={iconButtonClassName}
                          onClick={() => void trashWeakTopic(entry.id)}
                          aria-label={`Delete ${entry.topic}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {entry.sourceLabel && (
                        <p className="mt-1 truncate pl-4 text-xs text-slate-500">
                          {entry.sourceLabel}
                        </p>
                      )}
                    </div>
                  );
                })}
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

      {showEditor ? (
        <WeakTopicEditorSheet
          entry={editorEntry}
          onClose={() => setShowEditor(false)}
          existingTopics={existingTopics.filter((t) => t !== editorEntry?.topic)}
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
