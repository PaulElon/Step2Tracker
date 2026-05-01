import { AlertTriangle, ArrowDown, ArrowUp, Bell, ChevronLeft, ChevronRight, Pencil, Plus, Search, Upload } from "lucide-react";
import { useDeferredValue, useId, useRef, useState, useTransition } from "react";
import { getStudyBlockMinutes, getWeekDates } from "../lib/analytics";
import {
  addDays,
  addMonths,
  compareStudyBlocks,
  formatDateTimeLabel,
  formatLongDate,
  formatMinutes,
  formatMonthLabel,
  formatShortDate,
  getTodayKey,
  getMonthGridDates,
  getDayName,
  startOfWeek,
} from "../lib/datetime";
import { parseIcsImport } from "../lib/ics-import";
import { parseStudyWorkbook } from "../lib/excel";
import { useAppStore } from "../state/app-store";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { ModalShell } from "../components/modal-shell";
import { CategoryBadge, EmptyState, Panel } from "../components/ui";
import {
  fieldClassName,
  iconButtonClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "../lib/ui";
import type { ImportMode, StudyBlock, StudyBlockInput, WorkbookImportPreview } from "../types/models";
import type { IcsImportPreview } from "../lib/ics-import";

function matchesSearch(task: StudyBlock, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [task.date, task.day, task.category, task.task, task.notes].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
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

function IcsImportDialog({
  onClose,
  onImport,
  existingImportSourceIds,
}: {
  onClose: () => void;
  onImport: (tasks: StudyBlockInput[]) => Promise<boolean>;
  existingImportSourceIds: string[];
}) {
  const [preview, setPreview] = useState<IcsImportPreview | null>(null);
  const [error, setError] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileButtonRef = useRef<HTMLButtonElement>(null);
  const parseRequestRef = useRef(0);
  const [selectedFileName, setSelectedFileName] = useState("");
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const fileId = `${id}-file`;
  const fileHelpId = `${id}-file-help`;

  async function handleFileChange(file: File) {
    const requestId = ++parseRequestRef.current;
    setError("");
    setPreview(null);
    setIsParsing(true);

    try {
      const nextPreview = await parseIcsImport(file, existingImportSourceIds);
      if (parseRequestRef.current !== requestId) {
        return;
      }
      setPreview(nextPreview);
    } catch (caughtError) {
      if (parseRequestRef.current !== requestId) {
        return;
      }
      setPreview(null);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to import .ics file.");
    } finally {
      if (parseRequestRef.current === requestId) {
        setIsParsing(false);
      }
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      position="center"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={fileButtonRef}
      contentClassName="max-h-[calc(100vh-3rem)] overflow-hidden p-0"
    >
      <div className="flex max-h-[calc(100vh-3rem)] flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Calendar import</p>
            <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
              Import .ics
            </h3>
            <p id={descriptionId} className="mt-2 text-sm text-slate-400">
              Imports all-day VEVENTs as Planner tasks on their DTSTART date. Existing UID matches are skipped.
            </p>
          </div>
          <button type="button" onClick={onClose} className={secondaryButtonClassName} aria-label="Close import dialog">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 scrollbar-subtle">
          <div className="rounded-[24px] border border-dashed border-white/10 bg-slate-900/55 p-6">
            <label htmlFor={fileId} className="text-sm font-medium text-white">
              Select .ics file
            </label>
            <input
              ref={fileRef}
              id={fileId}
              type="file"
              accept=".ics,text/calendar"
              aria-describedby={fileHelpId}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }

                setSelectedFileName(file.name);
                void handleFileChange(file);
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                ref={fileButtonRef}
                type="button"
                className={secondaryButtonClassName}
                onClick={() => {
                  if (!fileRef.current) {
                    return;
                  }

                  fileRef.current.value = "";
                  fileRef.current.click();
                }}
              >
                Choose .ics file
              </button>
              <p className="min-w-0 flex-1 text-sm text-slate-300">
                <span className="block truncate">{selectedFileName || "No file selected"}</span>
              </p>
            </div>
            <p id={fileHelpId} className="mt-3 text-sm text-slate-500">
              All-day DTSTART values are imported locally. Timed events, alarms, attendees, and timezone metadata are ignored.
            </p>
          </div>

          {preview ? (
            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-[22px] border border-white/10 bg-slate-900/55 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">VEVENTs</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{preview.totalEvents}</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-900/55 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Importable</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{preview.importableCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-900/55 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Duplicates</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{preview.duplicateCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-900/55 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Skipped</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{preview.skippedCount}</p>
                </div>
              </div>

              {preview.issues.length ? (
                <div className="rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                  <p className="font-medium text-amber-50">Import notes</p>
                  <ul className="mt-2 space-y-1">
                    {preview.issues.slice(0, 4).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                    {preview.issues.length > 4 ? (
                      <li>+{preview.issues.length - 4} more notes</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-900/55">
                <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Preview</p>
                    <p className="mt-1 text-sm text-slate-400">{preview.fileName}</p>
                  </div>
                  <p className="text-sm text-slate-400">
                    {preview.groups.length} date{preview.groups.length === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="border-t border-white/10 px-5 pb-5 pt-4">
                  {preview.groups.length ? (
                    <div className="max-h-[min(22rem,40vh)] space-y-3 overflow-y-auto pr-2 scrollbar-subtle">
                      {preview.groups.map((group, groupIndex) => (
                        <section
                          key={`${group.date}-${groupIndex}`}
                          className="rounded-[20px] border border-white/10 bg-slate-950/40 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-medium text-white">{formatShortDate(group.date)}</p>
                            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">
                              {group.titles.length} task{group.titles.length === 1 ? "" : "s"}
                            </p>
                          </div>
                          <ul className="mt-3 space-y-2">
                            {group.titles.map((title, titleIndex) => (
                              <li
                                key={`${title}-${titleIndex}`}
                                className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm text-slate-200"
                              >
                                {title}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No importable all-day tasks"
                      description="The file parsed, but no VEVENTs met the all-day task requirements."
                    />
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-start gap-3 border-t border-white/10 bg-slate-950/20 px-6 py-4">
          <button type="button" className={secondaryButtonClassName} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!preview || !preview.importableCount || isParsing || isImporting}
            onClick={() => {
              if (!preview) {
                return;
              }

              void (async () => {
                setError("");
                setIsImporting(true);
                try {
                  const imported = await onImport(preview.studyBlocks);
                  if (imported) {
                    onClose();
                  } else {
                    setError("Unable to import the selected .ics file.");
                  }
                } finally {
                  setIsImporting(false);
                }
              })();
            }}
            className={`${primaryButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isImporting ? "Importing…" : isParsing ? "Parsing…" : "Import into planner"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

type MonthCategoryTone = {
  accentClassName: string;
  dotClassName: string;
  labelClassName: string;
};

function getMonthCategoryTone(category: string): MonthCategoryTone {
  const normalized = category.trim().toLowerCase();

  if (normalized.includes("uworld")) {
    return {
      accentClassName: "border-blue-400/40 bg-blue-400/10",
      dotClassName: "bg-blue-400",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("practice exam") || normalized.includes("nbme") || normalized.includes("comsae")) {
    return {
      accentClassName: "border-rose-400/40 bg-rose-400/10",
      dotClassName: "bg-rose-400",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("break") || normalized.includes("meal")) {
    return {
      accentClassName: "border-emerald-400/40 bg-emerald-400/10",
      dotClassName: "bg-emerald-400",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("work") || normalized.includes("gym")) {
    return {
      accentClassName: "border-teal-400/40 bg-teal-400/10",
      dotClassName: "bg-teal-400",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("anki")) {
    return {
      accentClassName: "border-amber-400/40 bg-amber-400/10",
      dotClassName: "bg-amber-400",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("review")) {
    return {
      accentClassName: "border-violet-400/40 bg-violet-400/10",
      dotClassName: "bg-violet-400",
      labelClassName: "text-slate-100",
    };
  }

  return {
    accentClassName: "border-slate-500/40 bg-white/[0.02]",
    dotClassName: "bg-slate-500",
    labelClassName: "text-slate-300",
  };
}

export function PlannerView() {
  const {
    state,
    importStudyBlocks,
    setPlannerFocusDate,
    setPlannerMode,
    trashStudyBlock,
    updatePlannerFilters,
    upsertStudyBlock,
  } = useAppStore();
  const [editorTask, setEditorTask] = useState<StudyBlock | undefined>();
  const [editorSeedDate, setEditorSeedDate] = useState<string | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showIcsImport, setShowIcsImport] = useState(false);

  const id = useId();
  const deferredSearch = useDeferredValue(state.preferences.plannerFilters.search);
  const searchId = `${id}-search`;
  const categoryFilterId = `${id}-category-filter`;
  const selectedDate = state.preferences.plannerFocusDate;
  const plannerMode = state.preferences.plannerMode;
  const weekStart = startOfWeek(selectedDate, 1);
  const weekDates = getWeekDates(selectedDate);
  const monthDates = getMonthGridDates(selectedDate, 1);
  const allSelectedDateTasks = state.studyBlocks.filter((task) => task.date === selectedDate).sort(compareStudyBlocks);
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
  const todayKey = getTodayKey();
  const selectedMonthKey = selectedDate.slice(0, 7);
  const tasksByDate = new Map<string, StudyBlock[]>();

  for (const task of state.studyBlocks) {
    const existing = tasksByDate.get(task.date);
    if (existing) {
      existing.push(task);
    } else {
      tasksByDate.set(task.date, [task]);
    }
  }

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

  const periodDates = plannerMode === "week" ? weekDates : monthDates;
  const periodLabel = plannerMode === "week" ? `Week of ${formatLongDate(weekStart)}` : formatMonthLabel(selectedDate);
  const periodPreviousLabel = plannerMode === "week" ? "Previous week" : "Previous month";
  const periodNextLabel = plannerMode === "week" ? "Next week" : "Next month";
  const periodPreviousDate = plannerMode === "week" ? addDays(weekStart, -7) : addMonths(selectedDate, -1);
  const periodNextDate = plannerMode === "week" ? addDays(weekStart, 7) : addMonths(selectedDate, 1);

  return (
    <div className="flex h-full flex-col gap-4">
      <Panel
        className="shrink-0"
        title="Planner"
        subtitle="Weekly and monthly calendar for scheduled tasks."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => {
                setShowIcsImport(false);
                setShowImport(true);
              }}
            >
              <Upload className="h-4 w-4" />
              Import legacy
            </button>
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => {
                setShowImport(false);
                setShowIcsImport(true);
              }}
            >
              <Upload className="h-4 w-4" />
              Import .ics
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
            {state.preferences.customCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
      </Panel>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2 xl:items-stretch">
        <Panel
          className="flex flex-col xl:h-full"
          title={periodLabel}
          action={
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-[18px] border border-white/10 bg-slate-900/55 p-1">
                <button
                  type="button"
                  onClick={() => { void setPlannerMode("week"); }}
                  className={`rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${
                    plannerMode === "week" ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Week
                </button>
                <button
                  type="button"
                  onClick={() => { void setPlannerMode("month"); }}
                  className={`rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${
                    plannerMode === "month" ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  Month
                </button>
              </div>
              <button
                type="button"
                className={iconButtonClassName}
                onClick={() => { void setPlannerFocusDate(periodPreviousDate); }}
                aria-label={periodPreviousLabel}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={iconButtonClassName}
                onClick={() => { void setPlannerFocusDate(periodNextDate); }}
                aria-label={periodNextLabel}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
              {plannerMode === "week" ? (
                <div className="space-y-2">
                  {periodDates.map((date) => {
                    const dayTasks = tasksByDate.get(date) ?? [];
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
                            <div>
                              {dayCompleted}/{dayTasks.length || 0} done
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col gap-2">
                  <div className="grid grid-cols-7 text-center">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                      <div key={day} className="py-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        {day}
                      </div>
                    ))}
                  </div>
                  <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-[16px]">
                    {periodDates.map((date) => {
                      const dayTasks = tasksByDate.get(date) ?? [];
                      const isSelected = date === selectedDate;
                      const isCurrentMonth = date.slice(0, 7) === selectedMonthKey;
                      const isToday = date === todayKey;
                      const visibleTasks = dayTasks.slice(0, 4);
                      const hiddenCount = Math.max(dayTasks.length - visibleTasks.length, 0);
                      const isPast = date < todayKey;
                      const overdueCount = isPast ? dayTasks.filter((task) => !task.completed).length : 0;
                      const isOverdue = overdueCount > 0;

                      return (
                        <button
                          key={date}
                          type="button"
                          onClick={() => void setPlannerFocusDate(date)}
                          className={[
                            "flex h-full min-h-0 flex-col overflow-hidden p-1.5 text-left transition",
                            isSelected
                              ? "bg-cyan-300/15 ring-1 ring-inset ring-cyan-300/30"
                              : isToday
                              ? "bg-white/[0.07] ring-1 ring-inset ring-cyan-300/20"
                              : isOverdue
                              ? "bg-rose-500/12 hover:bg-rose-500/16"
                              : "bg-slate-900/55 hover:bg-white/5",
                            !isCurrentMonth ? "opacity-40" : "",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-[11px] font-medium leading-none text-slate-300">
                              {Number(date.slice(8))}
                            </span>
                            {isOverdue ? (
                              <span className="flex items-center gap-0.5 text-[9px] leading-none text-rose-300">
                                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                {overdueCount}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 min-h-0 flex-1 overflow-hidden">
                            <div className="flex h-full min-h-0 flex-col gap-0.5 overflow-hidden">
                              {visibleTasks.map((task) => {
                                const tone = getMonthCategoryTone(task.category);

                                return (
                                  <div
                                    key={task.id}
                                    className={`flex min-w-0 items-center gap-1 overflow-hidden border-l-2 pl-1 ${tone.accentClassName}`}
                                  >
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dotClassName}`} />
                                    <span className={`min-w-0 truncate text-[10px] leading-4 ${tone.labelClassName}`}>
                                      {task.task}
                                    </span>
                                  </div>
                                );
                              })}
                              {hiddenCount > 0 ? (
                                <div className="mt-auto text-[10px] leading-none text-slate-500">+{hiddenCount} more</div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className={`${secondaryButtonClassName} mt-4 w-full justify-center shrink-0`}
            onClick={() => {
              void setPlannerFocusDate(getTodayKey());
            }}
          >
            Back to today
          </button>
        </Panel>

        <Panel
          className="flex flex-col xl:h-full"
          title={formatLongDate(selectedDate)}
          subtitle={`${allSelectedDateTasks.length} tasks · ${completedCount} done · ${formatMinutes(plannedMinutes)}`}
          action={
            <button type="button" className={primaryButtonClassName} onClick={() => openNewTask(selectedDate)}>
              <Plus className="h-4 w-4" />
              Add task
            </button>
          }
        >
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
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

                        <h4
                          className={`mt-3 text-lg font-semibold text-white ${
                            task.completed ? "line-through decoration-white/45" : ""
                          }`}
                        >
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
                        <button
                          type="button"
                          className={iconButtonClassName}
                          aria-label={`Edit ${task.task}`}
                          onClick={() => {
                            setEditorTask(task);
                            setEditorSeedDate(undefined);
                            setShowEditor(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
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
          </div>
        </Panel>
      </div>

      {showEditor ? (
        <StudyTaskEditorSheet
          key={editorTask?.id ?? editorSeedDate ?? "new-task"}
          task={editorTask}
          seedDate={editorSeedDate}
          onClose={() => setShowEditor(false)}
          onDelete={editorTask ? () => {
            void trashStudyBlock(editorTask.id);
            setShowEditor(false);
          } : undefined}
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

      {showIcsImport ? (
        <IcsImportDialog
          onClose={() => setShowIcsImport(false)}
          existingImportSourceIds={state.studyBlocks
            .map((block) => block.importSourceId)
            .filter((value): value is string => typeof value === "string" && value.length > 0)}
          onImport={(tasks) => importStudyBlocks(tasks, "merge")}
        />
      ) : null}
    </div>
  );
}
