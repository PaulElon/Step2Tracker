import { ArrowDown, ArrowUp, Bell, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useDeferredValue, useId, useRef, useState, useTransition } from "react";
import { getStudyBlockMinutes, getWeekDates } from "../lib/analytics";
import {
  addDays,
  compareStudyBlocks,
  formatDateTimeLabel,
  formatLongDate,
  formatMinutes,
  formatShortDate,
  getDayName,
  getTodayKey,
  startOfWeek,
} from "../lib/datetime";
import { parseStudyWorkbook } from "../lib/excel";
import {
  STUDY_TASK_CATEGORY_VALUES,
  getEmptyStudyBlockDraft,
  validateStudyBlockInput,
} from "../lib/storage";
import { useAppStore } from "../state/app-store";
import { CategoryBadge, EmptyState, Panel } from "../components/ui";
import { ModalShell } from "../components/modal-shell";
import {
  fieldClassName,
  iconButtonClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "../lib/ui";
import type { ImportMode, StudyBlock, StudyBlockInput, WorkbookImportPreview } from "../types/models";

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
};

function matchesSearch(task: StudyBlock, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [task.date, task.day, task.category, task.task, task.notes].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function createInitialDraft(task?: StudyBlock, seedDate?: string) {
  if (!task) {
    const draft = getEmptyStudyBlockDraft();
    if (seedDate) {
      draft.date = seedDate;
      draft.day = getDayName(seedDate);
    }
    return {
      ...draft,
      completed: draft.completed ?? false,
      order: draft.order ?? 0,
      durationHoursText: draft.durationHours ? String(draft.durationHours) : "",
      durationMinutesText: draft.durationMinutes ? String(draft.durationMinutes) : "",
      reminderAtText: draft.reminderAt ?? "",
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
  } satisfies StudyTaskEditorDraft;
}

function StudyTaskEditorSheet({
  task,
  seedDate,
  onClose,
  onSave,
}: {
  task?: StudyBlock;
  seedDate?: string;
  onClose: () => void;
  onSave: (draft: StudyBlockInput & { id?: string }) => void;
}) {
  const [draft, setDraft] = useState(createInitialDraft(task, seedDate));
  const [errors, setErrors] = useState<Partial<Record<"date" | "task" | "duration" | "category" | "reminder", string>>>(
    {},
  );
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
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
      initialFocusRef={dateRef}
      contentClassName="max-w-[500px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{task ? "Edit task" : "New task"}</p>
          <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
            {task ? task.task : "Create daily task"}
          </h3>
          <p id={descriptionId} className="mt-2 text-sm text-slate-400">
            Keep the day calm: set the date, define the task, choose a category, and add optional duration or reminder.
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
                category: event.target.value as StudyBlockInput["category"],
              }));
              setErrors((current) => ({ ...current, category: undefined }));
            }}
            aria-describedby={errors.category ? categoryErrorId : undefined}
            aria-invalid={Boolean(errors.category)}
            className={`${fieldClassName} mt-2`}
          >
            {STUDY_TASK_CATEGORY_VALUES.map((category) => (
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
            className={`${fieldClassName} mt-2`}
          />
          <p className="mt-2 text-xs text-slate-500">
            Optional. Alerts on this Mac when notifications are enabled.
          </p>
          {errors.reminder ? (
            <p id={reminderErrorId} className="mt-2 text-sm text-rose-300">
              {errors.reminder}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-3 pt-4">
          <button type="button" className={secondaryButtonClassName} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClassName}>
            Save task
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ImportDialog({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (tasks: StudyBlockInput[], mode: ImportMode) => void;
}) {
  const [preview, setPreview] = useState<WorkbookImportPreview | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const fileId = `${id}-file`;
  const fileHelpId = `${id}-file-help`;

  return (
    <ModalShell
      onClose={onClose}
      position="center"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={fileRef}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Legacy import</p>
          <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
            Import legacy workbook
          </h3>
          <p id={descriptionId} className="mt-2 text-sm text-slate-400">
            Old schedules are converted into daily tasks. Durations come from the original time windows when possible.
          </p>
        </div>
        <button type="button" onClick={onClose} className={secondaryButtonClassName} aria-label="Close import dialog">
          Close
        </button>
      </div>

      <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-slate-900/55 p-6">
        <label htmlFor={fileId} className="text-sm font-medium text-white">
          Select workbook
        </label>
        <input
          ref={fileRef}
          id={fileId}
          type="file"
          accept=".xlsx,.xls"
          aria-describedby={fileHelpId}
          className={`${fieldClassName} mt-3`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }

            void (async () => {
              try {
                setError("");
                setPreview(await parseStudyWorkbook(file));
              } catch (caughtError) {
                setPreview(null);
                setError(caughtError instanceof Error ? caughtError.message : "Unable to import workbook.");
              }
            })();
          }}
        />
        <p id={fileHelpId} className="mt-3 text-sm text-slate-500">
          The importer tolerates Excel serial dates, mixed time formats, and small header variations.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("merge")}
          aria-pressed={mode === "merge"}
          className={`rounded-[22px] border p-4 text-left transition ${
            mode === "merge"
              ? "border-cyan-300/25 bg-cyan-300/10"
              : "border-white/10 bg-slate-900/55 hover:bg-slate-900"
          }`}
        >
          <p className="text-sm font-semibold text-white">Merge into planner</p>
          <p className="mt-2 text-sm text-slate-400">Keep what is already in the app and add imported tasks around it.</p>
        </button>
        <button
          type="button"
          onClick={() => setMode("replace")}
          aria-pressed={mode === "replace"}
          className={`rounded-[22px] border p-4 text-left transition ${
            mode === "replace"
              ? "border-cyan-300/25 bg-cyan-300/10"
              : "border-white/10 bg-slate-900/55 hover:bg-slate-900"
          }`}
        >
          <p className="text-sm font-semibold text-white">Replace planner data</p>
          <p className="mt-2 text-sm text-slate-400">Use the workbook as a one-time migration source and clear current planner tasks.</p>
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}

      {preview ? (
        <div className="mt-6 rounded-[24px] border border-white/10 bg-slate-900/55 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Tasks</p>
              <p className="mt-2 text-2xl font-semibold text-white">{preview.summary.blockCount}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Start</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {preview.summary.startDate ? formatShortDate(preview.summary.startDate) : "--"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">End</p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {preview.summary.endDate ? formatShortDate(preview.summary.endDate) : "--"}
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {preview.summary.categories.map((category) => (
              <CategoryBadge key={category} category={category} />
            ))}
          </div>
          {preview.summary.warnings.length ? (
            <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
              {preview.summary.warnings[0]}
              {preview.summary.warnings.length > 1 ? ` (+${preview.summary.warnings.length - 1} more skipped rows)` : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button type="button" className={secondaryButtonClassName} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!preview || isPending}
          onClick={() =>
            startTransition(() => {
              if (!preview) {
                return;
              }
              onImport(preview.studyBlocks, mode);
              onClose();
            })
          }
          className={`${primaryButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isPending ? "Importing…" : "Import into planner"}
        </button>
      </div>
    </ModalShell>
  );
}

export function PlannerView() {
  const { state, importStudyBlocks, setPlannerFocusDate, trashStudyBlock, updatePlannerFilters, upsertStudyBlock } = useAppStore();
  const [editorTask, setEditorTask] = useState<StudyBlock | undefined>();
  const [editorSeedDate, setEditorSeedDate] = useState<string | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const id = useId();
  const deferredSearch = useDeferredValue(state.preferences.plannerFilters.search);
  const searchId = `${id}-search`;
  const categoryFilterId = `${id}-category-filter`;
  const selectedDate = state.preferences.plannerFocusDate;
  const weekStart = startOfWeek(selectedDate, 1);
  const weekDates = getWeekDates(selectedDate);
  const allSelectedDateTasks = state.studyBlocks
    .filter((task) => task.date === selectedDate)
    .sort(compareStudyBlocks);
  const selectedDateTasks = allSelectedDateTasks.filter((task) => {
    if (!matchesSearch(task, deferredSearch)) {
      return false;
    }
    if (state.preferences.plannerFilters.category !== "All" && task.category !== state.preferences.plannerFilters.category) {
      return false;
    }
    return true;
  });
  const plannedMinutes = allSelectedDateTasks.reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completedCount = allSelectedDateTasks.filter((task) => task.completed).length;

  function openNewTask(seedDate = selectedDate) {
    setEditorTask(undefined);
    setEditorSeedDate(seedDate);
    setShowEditor(true);
  }

  async function toggleTask(task: StudyBlock, completed: boolean) {
    await upsertStudyBlock({
      ...task,
      completed,
    });
  }

  async function moveTask(task: StudyBlock, direction: -1 | 1) {
    const index = allSelectedDateTasks.findIndex((entry) => entry.id === task.id);
    const target = allSelectedDateTasks[index + direction];

    if (index === -1 || !target) {
      return;
    }

    await upsertStudyBlock({
      ...task,
      order: target.order,
    });
    await upsertStudyBlock({
      ...target,
      order: task.order,
    });
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Planner"
        subtitle="One day at a time. Add, edit, reorder, and complete daily study tasks here."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={secondaryButtonClassName} onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" />
              Import legacy
            </button>
            <button type="button" className={primaryButtonClassName} onClick={() => openNewTask(selectedDate)}>
              <Plus className="h-4 w-4" />
              New task
            </button>
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label htmlFor={searchId} className="relative block">
            <span className="sr-only">Search planner tasks</span>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id={searchId}
              value={state.preferences.plannerFilters.search}
              onChange={(event) => {
                void updatePlannerFilters({ search: event.target.value });
              }}
              placeholder="Search task, category, or date"
              className={`${fieldClassName} pl-11`}
            />
          </label>

          <select
            id={categoryFilterId}
            value={state.preferences.plannerFilters.category}
            onChange={(event) => {
              void updatePlannerFilters({ category: event.target.value });
            }}
            className={fieldClassName}
          >
            <option value="All">All categories</option>
            {STUDY_TASK_CATEGORY_VALUES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel
          title="Dates"
          action={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={iconButtonClassName}
                onClick={() => {
                  void setPlannerFocusDate(addDays(weekStart, -7));
                }}
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => {
                  void setPlannerFocusDate(addDays(weekStart, 7));
                }}
              >
                <ChevronRight className="h-4 w-4" />
                Next week
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            {weekDates.map((date) => {
              const dayTasks = state.studyBlocks.filter((task) => task.date === date);
              const dayCompleted = dayTasks.filter((task) => task.completed).length;
              const isSelected = date === selectedDate;

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => {
                    void setPlannerFocusDate(date);
                  }}
                  className={`w-full rounded-[20px] border px-4 py-4 text-left transition ${
                    isSelected
                      ? "border-cyan-300/30 bg-cyan-300/10"
                      : "border-white/10 bg-slate-900/55 hover:border-white/15"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">{getDayName(date)}</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatShortDate(date)}</p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{dayTasks.length} tasks</div>
                      <div>{dayCompleted}/{dayTasks.length || 0} done</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`${secondaryButtonClassName} mt-4 w-full justify-center`}
            onClick={() => {
              void setPlannerFocusDate(getTodayKey());
            }}
          >
            Back to today
          </button>
        </Panel>

        <Panel
          title={formatLongDate(selectedDate)}
          subtitle={`${allSelectedDateTasks.length} tasks · ${completedCount} done · ${formatMinutes(plannedMinutes)}`}
          action={
            <button type="button" className={primaryButtonClassName} onClick={() => openNewTask(selectedDate)}>
              <Plus className="h-4 w-4" />
              Add task
            </button>
          }
        >
          {selectedDateTasks.length ? (
            <div className="space-y-3">
              {selectedDateTasks.map((task) => {
                const index = allSelectedDateTasks.findIndex((entry) => entry.id === task.id);
                const durationLabel = formatMinutes(getStudyBlockMinutes(task));

                return (
                  <article
                    key={task.id}
                    className={`rounded-[22px] border border-white/10 bg-slate-900/55 p-4 transition ${
                      task.completed ? "opacity-60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={(event) => {
                          void toggleTask(task, event.target.checked);
                        }}
                        aria-label={`Mark ${task.task} complete`}
                        className="mt-1 h-5 w-5 rounded border-white/15 bg-slate-950 text-cyan-300"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <CategoryBadge category={task.category} />
                          <span className="inline-flex items-center rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                            {durationLabel}
                          </span>
                          {task.reminderAt ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100">
                              <Bell className="h-3.5 w-3.5" />
                              {formatDateTimeLabel(task.reminderAt)}
                            </span>
                          ) : null}
                        </div>

                        <h4 className={`mt-3 text-lg font-semibold text-white ${task.completed ? "line-through decoration-white/45" : ""}`}>
                          {task.task}
                        </h4>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={iconButtonClassName}
                            disabled={index <= 0}
                            onClick={() => {
                              void moveTask(task, -1);
                            }}
                            aria-label={`Move ${task.task} up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className={iconButtonClassName}
                            disabled={index === -1 || index >= allSelectedDateTasks.length - 1}
                            onClick={() => {
                              void moveTask(task, 1);
                            }}
                            aria-label={`Move ${task.task} down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={secondaryButtonClassName}
                            onClick={() => {
                              setEditorTask(task);
                              setEditorSeedDate(undefined);
                              setShowEditor(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className={iconButtonClassName}
                            onClick={() => {
                              if (window.confirm(`Move "${task.task}" to planner trash?`)) {
                                void trashStudyBlock(task.id);
                              }
                            }}
                            aria-label={`Delete task ${task.task}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Quiet day"
              description={
                state.preferences.plannerFilters.search || state.preferences.plannerFilters.category !== "All"
                  ? "No tasks match the current filter for this day."
                  : "Add a task and build the day from a blank list."
              }
              action={
                <button type="button" className={primaryButtonClassName} onClick={() => openNewTask(selectedDate)}>
                  <Plus className="h-4 w-4" />
                  Add task
                </button>
              }
            />
          )}
        </Panel>
      </div>

      {showEditor ? (
        <StudyTaskEditorSheet
          key={editorTask?.id ?? editorSeedDate ?? "new-task"}
          task={editorTask}
          seedDate={editorSeedDate}
          onClose={() => setShowEditor(false)}
          onSave={(draft) => {
            void (async () => {
              const maxOrderForDate = Math.max(
                -1,
                ...state.studyBlocks
                  .filter((task) => task.date === draft.date && task.id !== draft.id)
                  .map((task) => task.order),
              );
              const saved = await upsertStudyBlock({
                ...draft,
                order:
                  typeof draft.order === "number" && editorTask && draft.date === editorTask.date
                    ? draft.order
                    : maxOrderForDate + 1,
              });
              if (saved) {
                void setPlannerFocusDate(draft.date);
                setShowEditor(false);
              }
            })();
          }}
        />
      ) : null}

      {showImport ? (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImport={(tasks, mode) => {
            void (async () => {
              const imported = await importStudyBlocks(tasks, mode);
              if (imported) {
                setShowImport(false);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
