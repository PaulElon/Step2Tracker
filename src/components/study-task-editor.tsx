import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { fieldClassName, primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import { getEmptyStudyBlockDraft, validateStudyBlockInput } from "../lib/storage";
import { getDayName } from "../lib/datetime";
import { useAppStore } from "../state/app-store";
import type { StudyBlock, StudyBlockInput } from "../types/models";

type StudyTaskEditorDraft = {
  id?: string;
  date: string;
  category: StudyBlock["category"];
  task: string;
  completed: boolean;
  order: number;
  durationHoursText: string;
  durationMinutesText: string;
  reminderAtText: string;
  importSourceId?: string;
};

function createInitialDraft(
  task?: StudyBlock,
  seedDate?: string,
  seedTaskName?: string,
  seedCategory?: StudyBlock["category"],
) {
  if (!task) {
    const draft = getEmptyStudyBlockDraft();
    if (seedDate) {
      draft.date = seedDate;
      draft.day = getDayName(seedDate);
    }
    if (seedTaskName !== undefined) {
      draft.task = seedTaskName;
    }
    if (seedCategory !== undefined) {
      draft.category = seedCategory;
    }

    return {
      ...draft,
      completed: draft.completed ?? false,
      order: draft.order ?? 0,
      durationHoursText: draft.durationHours ? String(draft.durationHours) : "",
      durationMinutesText: draft.durationMinutes ? String(draft.durationMinutes) : "",
      reminderAtText: draft.reminderAt ?? "",
      importSourceId: draft.importSourceId,
    } satisfies StudyTaskEditorDraft;
  }

  return {
    id: task.id,
    date: task.date,
    category: task.category,
    task: task.task,
    completed: task.completed ?? false,
    order: task.order ?? 0,
    durationHoursText: task.durationHours ? String(task.durationHours) : "",
    durationMinutesText: task.durationMinutes ? String(task.durationMinutes) : "",
    reminderAtText: task.reminderAt ?? "",
    importSourceId: task.importSourceId,
  } satisfies StudyTaskEditorDraft;
}

export function StudyTaskEditorSheet({
  task,
  seedDate,
  seedTaskName,
  seedCategory,
  onClose,
  onDelete,
  onSave,
}: {
  task?: StudyBlock;
  seedDate?: string;
  seedTaskName?: string;
  seedCategory?: StudyBlock["category"];
  onClose: () => void;
  onDelete?: () => void;
  onSave: (draft: StudyBlockInput & { id?: string }) => void;
}) {
  const { state } = useAppStore();
  const categories = state.preferences.customCategories;
  const [draft, setDraft] = useState(createInitialDraft(task, seedDate, seedTaskName, seedCategory));
  const [errors, setErrors] = useState<Partial<Record<"date" | "task" | "duration" | "category" | "reminder", string>>>(
    {},
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const taskRef = useRef<HTMLInputElement>(null);
  useEffect(() => { taskRef.current?.focus(); }, []);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const dateId = `${id}-date`;
  const dateErrorId = `${id}-date-error`;
  const taskId = `${id}-task`;
  const taskErrorId = `${id}-task-error`;
  const categoryId = `${id}-category`;
  const categoryErrorId = `${id}-category-error`;
  const hoursId = `${id}-hours`;
  const minutesId = `${id}-minutes`;
  const durationErrorId = `${id}-duration-error`;
  const reminderId = `${id}-reminder`;
  const reminderErrorId = `${id}-reminder-error`;

  return (
    <ModalShell
      onClose={onClose}
      position="side"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={taskRef}
      contentClassName="max-w-[500px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{task ? "Edit task" : "New task"}</p>
          <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
            {task ? task.task : "Create daily task"}
          </h3>
          <p id={descriptionId} className="mt-2 text-sm text-slate-400">
            Set the date, task, category, duration, and optional reminder.
          </p>
        </div>
        <button type="button" onClick={onClose} className={secondaryButtonClassName} aria-label="Close task editor">
          Close
        </button>
      </div>

      <form
        noValidate
        className="mt-8 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const reminderAt = draft.reminderAtText.trim();
          const nextDraft = {
            id: draft.id,
            date: draft.date,
            day: getDayName(draft.date),
            durationHours: draft.durationHoursText.trim() ? Number(draft.durationHoursText) : 0,
            durationMinutes: draft.durationMinutesText.trim() ? Number(draft.durationMinutesText) : 0,
            category: draft.category,
            task: draft.task,
            completed: draft.completed ?? false,
            order: draft.order ?? 0,
            importSourceId: draft.importSourceId,
            reminderAt,
            reminderSentAt: reminderAt && reminderAt === task?.reminderAt ? task?.reminderSentAt ?? "" : "",
          } satisfies StudyBlockInput & { id?: string };
          const nextErrors = validateStudyBlockInput(nextDraft);

          if (Object.keys(nextErrors).length) {
            setErrors(nextErrors);
            return;
          }

          onSave(nextDraft);
        }}
      >
        <div>
          <label htmlFor={dateId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Date
          </label>
          <input
            ref={dateRef}
            id={dateId}
            type="date"
            value={draft.date}
            onChange={(event) => {
              setDraft((current) => ({ ...current, date: event.target.value }));
              setErrors((current) => ({ ...current, date: undefined }));
            }}
            aria-describedby={errors.date ? dateErrorId : undefined}
            aria-invalid={Boolean(errors.date)}
            className={`${fieldClassName} mt-2`}
          />
          {errors.date ? (
            <p id={dateErrorId} className="mt-2 text-sm text-rose-300">
              {errors.date}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={taskId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Task
          </label>
          <input
            ref={taskRef}
            id={taskId}
            value={draft.task}
            onChange={(event) => {
              setDraft((current) => ({ ...current, task: event.target.value }));
              setErrors((current) => ({ ...current, task: undefined }));
            }}
            aria-describedby={errors.task ? taskErrorId : undefined}
            aria-invalid={Boolean(errors.task)}
            className={`${fieldClassName} mt-2`}
            placeholder="Review cardio murmurs"
          />
          {errors.task ? (
            <p id={taskErrorId} className="mt-2 text-sm text-rose-300">
              {errors.task}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={categoryId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Category
          </label>
          <select
            id={categoryId}
            value={draft.category}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                category: event.target.value,
              }));
              setErrors((current) => ({ ...current, category: undefined }));
            }}
            aria-describedby={errors.category ? categoryErrorId : undefined}
            aria-invalid={Boolean(errors.category)}
            className={`${fieldClassName} mt-2`}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {errors.category ? (
            <p id={categoryErrorId} className="mt-2 text-sm text-rose-300">
              {errors.category}
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Optional duration</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={hoursId} className="sr-only">
                Duration hours
              </label>
              <input
                id={hoursId}
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.durationHoursText}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, durationHoursText: event.target.value }));
                  setErrors((current) => ({ ...current, duration: undefined }));
                }}
                className={fieldClassName}
                placeholder="Hours"
              />
            </div>
            <div>
              <label htmlFor={minutesId} className="sr-only">
                Duration minutes
              </label>
              <input
                id={minutesId}
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.durationMinutesText}
                onChange={(event) => {
                  setDraft((current) => ({ ...current, durationMinutesText: event.target.value }));
                  setErrors((current) => ({ ...current, duration: undefined }));
                }}
                className={fieldClassName}
                placeholder="Minutes"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Blank duration fields save as 0.</p>
          {errors.duration ? (
            <p id={durationErrorId} className="mt-2 text-sm text-rose-300">
              {errors.duration}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor={reminderId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Reminder
          </label>
          <input
            id={reminderId}
            type="datetime-local"
            value={draft.reminderAtText}
            onChange={(event) => {
              setDraft((current) => ({ ...current, reminderAtText: event.target.value }));
              setErrors((current) => ({ ...current, reminder: undefined }));
            }}
            aria-describedby={errors.reminder ? reminderErrorId : undefined}
            aria-invalid={Boolean(errors.reminder)}
            className={`${fieldClassName} mt-2 ${!draft.reminderAtText ? "italic opacity-30" : ""}`}
          />
          <p className="mt-2 text-xs text-slate-500">Optional. Alerts on this Mac when notifications are enabled.</p>
          {errors.reminder ? (
            <p id={reminderErrorId} className="mt-2 text-sm text-rose-300">
              {errors.reminder}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 pt-4">
          {onDelete ? (
            confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-rose-300">Delete this task?</span>
                <button
                  type="button"
                  className="rounded-[14px] border border-rose-300/30 bg-rose-300/15 px-3 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-300/25"
                  onClick={onDelete}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={secondaryButtonClassName}
                aria-label="Delete task"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <button type="button" className={secondaryButtonClassName} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClassName}>
              Save task
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
