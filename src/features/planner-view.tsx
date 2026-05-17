import { AlertTriangle, ArrowDown, ArrowUp, Bell, CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Plus, Search, Upload } from "lucide-react";
import { useDeferredValue, useEffect, useId, useRef, useState, useTransition } from "react";
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
import { FF } from "../lib/feature-flags";
import { getTrackedStudyMinutesForDate } from "../lib/tf-session-metrics";
import { useAppStore } from "../state/app-store";
import { TimeFolioStoreProvider, useTimeFolioStore } from "../state/tf-store";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { ModalShell } from "../components/modal-shell";
import { CategoryBadge, EmptyState, Panel } from "../components/ui";
import {
  cn,
  fieldClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "../lib/ui";
import type { ExamTimer, ImportMode, StudyBlock, StudyBlockInput, WorkbookImportPreview } from "../types/models";
import type { IcsImportPreview } from "../lib/ics-import";

const compactPlannerButtonClassName =
  "inline-flex h-8 items-center justify-center rounded-[12px] border border-white/10 bg-slate-900/70 px-3 text-[11px] font-medium text-slate-200 transition hover:border-cyan-300/25 hover:bg-slate-800/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-45";
const compactPlannerDangerButtonClassName =
  "inline-flex h-8 items-center justify-center rounded-[12px] border border-rose-400/20 bg-rose-500/10 px-3 text-[11px] font-medium text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-500/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-45";
const compactPlannerFieldClassName =
  "h-8 rounded-[12px] border border-white/10 bg-slate-950/70 px-3 text-[11px] font-medium text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35";

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
      accentClassName: "border-blue-400/50 bg-blue-400/12",
      dotClassName: "bg-blue-300",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("practice exam") || normalized.includes("nbme") || normalized.includes("comsae")) {
    return {
      accentClassName: "border-rose-400/50 bg-rose-400/12",
      dotClassName: "bg-rose-300",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("break") || normalized.includes("meal")) {
    return {
      accentClassName: "border-emerald-400/50 bg-emerald-400/12",
      dotClassName: "bg-emerald-300",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("work") || normalized.includes("gym")) {
    return {
      accentClassName: "border-teal-400/50 bg-teal-400/12",
      dotClassName: "bg-teal-300",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("anki")) {
    return {
      accentClassName: "border-amber-400/50 bg-amber-400/12",
      dotClassName: "bg-amber-300",
      labelClassName: "text-slate-100",
    };
  }

  if (normalized.includes("review")) {
    return {
      accentClassName: "border-violet-400/50 bg-violet-400/12",
      dotClassName: "bg-violet-300",
      labelClassName: "text-slate-100",
    };
  }

  return {
    accentClassName: "border-slate-500/50 bg-white/[0.03]",
    dotClassName: "bg-slate-400",
    labelClassName: "text-slate-200",
  };
}

type WorkloadIntensity = {
  barClassName: string;
  label: string;
};

function getWorkloadIntensity(minutes: number): WorkloadIntensity {
  if (minutes <= 0) {
    return { barClassName: "bg-white/10", label: "" };
  }
  if (minutes < 60) {
    return { barClassName: "bg-emerald-400/65", label: "Light" };
  }
  if (minutes < 180) {
    return { barClassName: "bg-cyan-400/65", label: "Steady" };
  }
  if (minutes < 300) {
    return { barClassName: "bg-amber-400/70", label: "Heavy" };
  }
  return { barClassName: "bg-rose-400/70", label: "Intense" };
}

function getDayMonth(dateKey: string) {
  return dateKey.slice(0, 7);
}

function PlannerTrackedStudyStat({ selectedDateKey }: { selectedDateKey: string }) {
  const { state: tfState } = useTimeFolioStore();
  const trackedStudyMinutes = getTrackedStudyMinutesForDate(tfState.sessionLogs, selectedDateKey);

  return (
    <div className="px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Tracked study</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">
        {formatMinutes(trackedStudyMinutes)}
      </p>
    </div>
  );
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
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkDurationHours, setBulkDurationHours] = useState("0");
  const [bulkDurationMinutes, setBulkDurationMinutes] = useState("0");
  const [isBulkPending, setIsBulkPending] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

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
  const visibleTaskIds = selectedDateTasks.map((task) => task.id);
  const visibleTaskIdSet = new Set(visibleTaskIds);
  const selectedVisibleTaskIds = selectedTaskIds.filter((taskId) => visibleTaskIdSet.has(taskId));
  const selectedVisibleTaskIdSet = new Set(selectedVisibleTaskIds);
  const selectedVisibleTasks = selectedDateTasks.filter((task) => selectedVisibleTaskIdSet.has(task.id));
  const selectedVisibleCount = selectedVisibleTasks.length;
  const allVisibleSelected = selectedDateTasks.length > 0 && selectedVisibleCount === selectedDateTasks.length;
  const categoryOptions = [...state.preferences.customCategories];
  for (const task of allSelectedDateTasks) {
    if (!categoryOptions.includes(task.category)) {
      categoryOptions.push(task.category);
    }
  }
  const plannedMinutes = allSelectedDateTasks.reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completedCount = allSelectedDateTasks.filter((task) => task.completed).length;
  const todayKey = getTodayKey();
  const selectedMonthKey = selectedDate.slice(0, 7);
  const tasksByDate = new Map<string, StudyBlock[]>();
  const parsedBulkDurationHours =
    bulkDurationHours.trim() === "" ? null : Number.isInteger(Number(bulkDurationHours)) && Number(bulkDurationHours) >= 0 ? Number(bulkDurationHours) : null;
  const parsedBulkDurationMinutes =
    bulkDurationMinutes.trim() === "" ? null : Number.isInteger(Number(bulkDurationMinutes)) && Number(bulkDurationMinutes) >= 0 ? Number(bulkDurationMinutes) : null;
  const isBulkDurationValid = parsedBulkDurationHours !== null && parsedBulkDurationMinutes !== null;

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

  function clearBulkSelection() {
    setSelectedTaskIds([]);
  }

  function exitSelectionMode() {
    setIsSelectionMode(false);
    clearBulkSelection();
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

  async function runBulkUpdate(transform: (task: StudyBlock, updatedAt: string) => StudyBlock) {
    if (!selectedVisibleTasks.length || isBulkPending) {
      return;
    }

    setIsBulkPending(true);
    const updatedAt = new Date().toISOString();

    try {
      for (const task of selectedVisibleTasks) {
        await upsertStudyBlock(transform(task, updatedAt));
      }
    } finally {
      setIsBulkPending(false);
    }
  }

  async function handleBulkTrash() {
    const tasksToTrash = selectedDateTasks.filter((task) => selectedTaskIds.includes(task.id));

    if (!tasksToTrash.length || isBulkPending) {
      return;
    }

    const taskLabel = tasksToTrash.length === 1 ? "task" : "tasks";
    if (!window.confirm(`Move ${tasksToTrash.length} selected ${taskLabel} to trash?`)) {
      return;
    }

    setIsBulkPending(true);
    try {
      for (const task of tasksToTrash) {
        await trashStudyBlock(task.id);
      }
      exitSelectionMode();
    } finally {
      setIsBulkPending(false);
    }
  }

  function handlePlannerFocusDate(date: string) {
    clearBulkSelection();
    void setPlannerFocusDate(date);
  }

  const periodLabel = plannerMode === "week" ? `Week of ${formatLongDate(weekStart)}` : formatMonthLabel(selectedDate);
  const periodPreviousLabel = plannerMode === "week" ? "Previous week" : "Previous month";
  const periodNextLabel = plannerMode === "week" ? "Next week" : "Next month";
  const periodPreviousDate = plannerMode === "week" ? addDays(weekStart, -7) : addMonths(selectedDate, -1);
  const periodNextDate = plannerMode === "week" ? addDays(weekStart, 7) : addMonths(selectedDate, 1);

  const studiedMinutes = allSelectedDateTasks
    .filter((task) => task.completed)
    .reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completionPercent = allSelectedDateTasks.length
    ? Math.round((completedCount / allSelectedDateTasks.length) * 100)
    : 0;

  const eventsByDate = new Map<string, ExamTimer[]>();
  for (const timer of state.preferences.examTimers) {
    if (!timer.examDate) {
      continue;
    }
    const existing = eventsByDate.get(timer.examDate);
    if (existing) {
      existing.push(timer);
    } else {
      eventsByDate.set(timer.examDate, [timer]);
    }
  }

  const weekTotalMinutes = weekDates.reduce(
    (total, date) =>
      total + (tasksByDate.get(date) ?? []).reduce((sum, task) => sum + getStudyBlockMinutes(task), 0),
    0,
  );
  const weekTotalTasks = weekDates.reduce((total, date) => total + (tasksByDate.get(date)?.length ?? 0), 0);

  let monthMinutesInScope = 0;
  let monthTasksInScope = 0;
  for (const date of monthDates) {
    if (getDayMonth(date) !== selectedMonthKey) {
      continue;
    }
    const dayTasks = tasksByDate.get(date) ?? [];
    monthTasksInScope += dayTasks.length;
    for (const task of dayTasks) {
      monthMinutesInScope += getStudyBlockMinutes(task);
    }
  }

  useEffect(() => {
    if (!showMore) {
      return;
    }
    function handleMouseDown(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setShowMore(false);
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowMore(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [showMore]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Plan</h2>
          <p className="mt-1 text-sm text-slate-400">
            Your schedule at a glance. Plan your weeks.{" "}
            <span className="text-slate-200">Execute your days.</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              handlePlannerFocusDate(todayKey);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[14px] border border-white/10 bg-slate-900/55 px-3.5 text-xs font-medium text-slate-200 transition hover:border-cyan-300/25 hover:bg-slate-800/80 hover:text-white"
          >
            <CalendarDays className="h-4 w-4 text-slate-400" />
            Today
          </button>

          <div className="inline-flex rounded-[14px] border border-white/10 bg-slate-900/55 p-1">
            <button
              type="button"
              onClick={() => {
                void setPlannerMode("week");
              }}
              aria-pressed={plannerMode === "week"}
              className={cn(
                "rounded-[10px] px-3 py-1.5 text-xs font-medium transition",
                plannerMode === "week" ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:text-white",
              )}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => {
                void setPlannerMode("month");
              }}
              aria-pressed={plannerMode === "month"}
              className={cn(
                "rounded-[10px] px-3 py-1.5 text-xs font-medium transition",
                plannerMode === "month" ? "bg-cyan-300/15 text-white" : "text-slate-400 hover:text-white",
              )}
            >
              Month
            </button>
          </div>

          <div ref={moreRef} className="relative">
            <button
              type="button"
              onClick={() => setShowMore((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={showMore}
              className="inline-flex h-9 items-center gap-1.5 rounded-[14px] border border-white/10 bg-slate-900/55 px-3 text-xs font-medium text-slate-200 transition hover:border-cyan-300/25 hover:bg-slate-800/80 hover:text-white"
            >
              <MoreHorizontal className="h-4 w-4" />
              More
            </button>
            {showMore ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-30 mt-1.5 w-48 overflow-hidden rounded-[12px] border border-white/10 bg-slate-950/95 p-1 shadow-xl backdrop-blur"
              >
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">Import</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMore(false);
                    setShowIcsImport(false);
                    setShowImport(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs text-slate-200 transition hover:bg-white/[0.06]"
                >
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  Legacy workbook
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowMore(false);
                    setShowImport(false);
                    setShowIcsImport(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-xs text-slate-200 transition hover:bg-white/[0.06]"
                >
                  <Upload className="h-3.5 w-3.5 text-slate-400" />
                  Calendar (.ics)
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[18px] border border-white/8 bg-slate-950/35 px-3 py-2.5">
        <label htmlFor={searchId} className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search planner tasks</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            id={searchId}
            value={state.preferences.plannerFilters.search}
            onChange={(event) => {
              clearBulkSelection();
              void updatePlannerFilters({ search: event.target.value });
            }}
            placeholder="Search task, category, or date"
            className="h-9 w-full rounded-[12px] border border-white/10 bg-slate-900/55 pl-9 pr-3 text-xs font-medium text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35"
          />
        </label>

        <select
          id={categoryFilterId}
          value={state.preferences.plannerFilters.category}
          onChange={(event) => {
            clearBulkSelection();
            void updatePlannerFilters({ category: event.target.value });
          }}
          className="h-9 min-w-[10rem] rounded-[12px] border border-white/10 bg-slate-900/55 px-3 text-xs font-medium text-white outline-none transition focus:border-cyan-300/35"
        >
          <option value="All">All categories</option>
          {state.preferences.customCategories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            aria-label={periodPreviousLabel}
            onClick={() => {
              handlePlannerFocusDate(periodPreviousDate);
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/10 bg-slate-900/55 text-slate-200 transition hover:border-cyan-300/25 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-[12rem] text-center text-sm font-semibold tracking-[-0.01em] text-white">{periodLabel}</p>
          <button
            type="button"
            aria-label={periodNextLabel}
            onClick={() => {
              handlePlannerFocusDate(periodNextDate);
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border border-white/10 bg-slate-900/55 text-slate-200 transition hover:border-cyan-300/25 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,0.85fr)] xl:items-stretch">
        <Panel className="flex min-h-0 flex-col xl:h-full">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {plannerMode === "week" ? "7-day plan" : `${formatMonthLabel(selectedDate)} overview`}
            </p>
            <p className="text-xs text-slate-400">
              {plannerMode === "week" ? (
                <>
                  <span className="font-semibold text-white">{weekTotalTasks}</span> task{weekTotalTasks === 1 ? "" : "s"}
                  {" · "}
                  <span className="font-semibold text-white">{formatMinutes(weekTotalMinutes)}</span> planned
                </>
              ) : (
                <>
                  <span className="font-semibold text-white">{monthTasksInScope}</span> task{monthTasksInScope === 1 ? "" : "s"}
                  {" · "}
                  <span className="font-semibold text-white">{formatMinutes(monthMinutesInScope)}</span> planned
                </>
              )}
            </p>
          </div>

          {plannerMode === "week" ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 xl:gap-0 xl:rounded-[16px] xl:border xl:border-white/10 xl:bg-slate-950/40">
              {weekDates.map((date, index) => {
                const dayTasks = (tasksByDate.get(date) ?? []).slice().sort(compareStudyBlocks);
                const dayMinutes = dayTasks.reduce((sum, task) => sum + getStudyBlockMinutes(task), 0);
                const isSelected = date === selectedDate;
                const isTodayDate = date === todayKey;
                const intensity = getWorkloadIntensity(dayMinutes);
                const dayEvents = eventsByDate.get(date) ?? [];
                const widthPercent = Math.min(100, Math.round((dayMinutes / 360) * 100));

                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => handlePlannerFocusDate(date)}
                    className={cn(
                      "group flex min-h-[14rem] min-w-0 flex-col overflow-hidden rounded-[14px] border border-white/8 bg-slate-950/35 text-left transition xl:min-h-0 xl:rounded-none xl:border-0 xl:border-l xl:border-white/10",
                      index === 0 ? "xl:border-l-0" : "",
                      isSelected
                        ? "ring-1 ring-inset ring-cyan-300/40"
                        : isTodayDate
                        ? "hover:bg-white/[0.03]"
                        : "hover:bg-white/[0.03]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2.5",
                        isSelected ? "bg-cyan-300/12" : isTodayDate ? "bg-white/[0.04]" : "",
                      )}
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-[10px] font-medium uppercase tracking-[0.18em]",
                            isTodayDate ? "text-cyan-300" : isSelected ? "text-cyan-200/80" : "text-slate-500",
                          )}
                        >
                          {getDayName(date).slice(0, 3)}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[22px] font-semibold leading-none tracking-[-0.03em]",
                            isTodayDate ? "text-cyan-100" : "text-white",
                          )}
                        >
                          {Number(date.slice(8))}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[12px] font-semibold tabular-nums text-slate-100">
                          {dayTasks.length}
                          <span className="ml-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">
                            {dayTasks.length === 1 ? "task" : "tasks"}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                          {dayTasks.length ? formatMinutes(dayMinutes) : "Quiet day"}
                        </p>
                      </div>
                    </div>

                    <div className="h-[3px] w-full overflow-hidden bg-white/[0.04]">
                      <div
                        className={cn("h-full transition-[width]", intensity.barClassName)}
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>

                    {dayEvents.length ? (
                      <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2">
                        {dayEvents.slice(0, 1).map((timer) => (
                          <span
                            key={timer.id}
                            className="inline-flex max-w-full items-center truncate rounded-[7px] border border-violet-300/25 bg-violet-300/12 px-1.5 py-0.5 text-[10px] font-medium text-violet-100"
                          >
                            {timer.label || "Exam"}
                          </span>
                        ))}
                        {dayEvents.length > 1 ? (
                          <span className="text-[10px] font-medium text-violet-200/80">
                            +{dayEvents.length - 1}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 scrollbar-subtle">
                      {dayTasks.length ? (
                        dayTasks.map((task) => {
                          const tone = getMonthCategoryTone(task.category);
                          const taskMinutes = getStudyBlockMinutes(task);
                          return (
                            <div
                              key={task.id}
                              className={cn(
                                "relative flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[9px] border border-white/8 bg-[color:var(--surface-muted)] pl-2 pr-2 py-1.5",
                                task.completed ? "opacity-60" : "",
                              )}
                            >
                              <span
                                className={cn("absolute inset-y-1 left-0 w-[2px] rounded-r-full", tone.dotClassName)}
                                aria-hidden="true"
                              />
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate pl-1 text-[12px] leading-[1.2]",
                                  task.completed ? "text-slate-400 line-through decoration-white/25" : "text-slate-100",
                                )}
                              >
                                {task.task}
                              </span>
                              {taskMinutes ? (
                                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                                  {formatMinutes(taskMinutes)}
                                </span>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex flex-1 items-center justify-center py-4">
                          <p className="text-[11px] text-slate-600">Quiet day</p>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="grid grid-cols-7 gap-px text-center">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                  <div key={day} className="py-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-px overflow-hidden rounded-[16px] border border-white/10 bg-[color:var(--panel-bg)]">
                {monthDates.map((date) => {
                  const dayTasks = tasksByDate.get(date) ?? [];
                  const dayMinutes = dayTasks.reduce((sum, task) => sum + getStudyBlockMinutes(task), 0);
                  const isSelected = date === selectedDate;
                  const isCurrentMonth = getDayMonth(date) === selectedMonthKey;
                  const isTodayDate = date === todayKey;
                  const isPast = date < todayKey;
                  const overdueCount = isPast ? dayTasks.filter((task) => !task.completed).length : 0;
                  const isOverdue = overdueCount > 0;
                  const intensity = getWorkloadIntensity(dayMinutes);
                  const widthPercent = Math.min(100, Math.round((dayMinutes / 360) * 100));
                  const dayEvents = eventsByDate.get(date) ?? [];

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => handlePlannerFocusDate(date)}
                      className={cn(
                        "flex min-h-0 flex-col gap-1 bg-[color:var(--panel-bg)] px-2 py-2 text-left transition-colors",
                        isSelected
                          ? "bg-cyan-300/12 ring-1 ring-inset ring-cyan-300/45"
                          : isTodayDate
                          ? "bg-[color:var(--surface-muted)] ring-1 ring-inset ring-cyan-300/25"
                          : isOverdue
                          ? "bg-rose-500/10 hover:bg-rose-500/14"
                          : "hover:bg-[color:var(--surface-muted)]",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "text-[13px] font-semibold leading-none tracking-[-0.01em]",
                            !isCurrentMonth
                              ? "text-slate-600"
                              : isTodayDate
                              ? "text-cyan-100"
                              : "text-slate-100",
                          )}
                        >
                          {Number(date.slice(8))}
                        </span>
                        {isOverdue ? (
                          <span
                            className="flex items-center gap-0.5 rounded-full border border-rose-300/20 bg-rose-500/12 px-1.5 py-0.5 text-[9px] font-medium leading-none text-rose-100"
                            title={`${overdueCount} overdue task${overdueCount === 1 ? "" : "s"}`}
                          >
                            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                            Overdue {overdueCount}
                          </span>
                        ) : null}
                      </div>

                      {dayEvents.length ? (
                        <div className="truncate rounded-[6px] border border-violet-300/30 bg-violet-300/15 px-1.5 py-0.5 text-[10px] font-medium text-violet-100">
                          {dayEvents[0].label || "Exam"}
                          {dayEvents.length > 1 ? ` +${dayEvents.length - 1}` : ""}
                        </div>
                      ) : null}

                      <div className="mt-auto space-y-1">
                        {dayTasks.length ? (
                          <div
                            className={cn(
                              "flex items-baseline gap-1 leading-none",
                              isCurrentMonth ? "text-slate-200" : "text-slate-500",
                            )}
                          >
                            <span className="text-[12px] font-semibold tabular-nums">{dayTasks.length}</span>
                            <span className="text-[9px] uppercase tracking-[0.12em] text-slate-500">
                              {dayTasks.length === 1 ? "task" : "tasks"}
                            </span>
                            <span className="ml-auto text-[10px] tabular-nums text-slate-400">
                              {formatMinutes(dayMinutes)}
                            </span>
                          </div>
                        ) : (
                          <div className="h-[12px]" aria-hidden="true" />
                        )}
                        <div className="h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--surface-muted)]">
                          <div
                            className={cn("h-full rounded-full", intensity.barClassName)}
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-6 rounded-full bg-emerald-400/65" aria-hidden="true" />
                  Light
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-6 rounded-full bg-cyan-400/65" aria-hidden="true" />
                  Steady
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-6 rounded-full bg-amber-400/70" aria-hidden="true" />
                  Heavy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-6 rounded-full bg-rose-400/70" aria-hidden="true" />
                  Intense
                </span>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3 text-rose-300" aria-hidden="true" />
                  Overdue
                </span>
                {state.preferences.examTimers.length ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-6 rounded-full bg-violet-300/60" aria-hidden="true" />
                    Exam
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </Panel>

        <Panel className="flex min-h-0 flex-col xl:h-full">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Selected day</p>
              <h3 className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.01em] text-white">
                {formatLongDate(selectedDate)}
              </h3>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isSelectionMode ? (
                <>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center rounded-[10px] border border-white/10 bg-slate-900/55 px-2.5 text-[11px] font-medium text-slate-200 transition hover:border-cyan-300/25 hover:text-white"
                    onClick={exitSelectionMode}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-[10px] bg-cyan-300/90 px-3 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-200"
                    onClick={exitSelectionMode}
                  >
                    Exit bulk edit
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-8 items-center rounded-[10px] border border-white/10 bg-slate-900/55 px-2.5 text-[11px] font-medium text-slate-300 transition hover:border-cyan-300/25 hover:text-white"
                  onClick={() => {
                    setIsSelectionMode(true);
                    clearBulkSelection();
                  }}
                >
                  Select tasks
                </button>
              )}
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1 rounded-[10px] bg-cyan-300/90 px-3 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-200"
                onClick={() => openNewTask(selectedDate)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add task
              </button>
            </div>
          </div>

          <div
            className={`mb-3 grid ${FF.timefolio ? "grid-cols-5" : "grid-cols-4"} divide-x divide-white/8 overflow-hidden rounded-[12px] border border-white/8 bg-slate-950/45`}
          >
            <div className="px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Tasks</p>
              <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">{allSelectedDateTasks.length}</p>
            </div>
            <div className="px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Planned</p>
              <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">{formatMinutes(plannedMinutes)}</p>
            </div>
            <div className="px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Done</p>
              <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">{completionPercent}%</p>
            </div>
            <div className="px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Done time</p>
              <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-white">{formatMinutes(studiedMinutes)}</p>
            </div>
            {FF.timefolio ? (
              <TimeFolioStoreProvider>
                <PlannerTrackedStudyStat selectedDateKey={selectedDate} />
              </TimeFolioStoreProvider>
            ) : null}
          </div>

          {isSelectionMode ? (
            <div className="mb-3 rounded-[12px] border border-white/10 bg-slate-950/45 p-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 border-b border-white/8 px-0.5 pb-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                  Bulk edit · {selectedVisibleCount} selected
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={compactPlannerButtonClassName}
                    disabled={!selectedVisibleCount || isBulkPending}
                    onClick={clearBulkSelection}
                  >
                    Clear selection
                  </button>
                  <button
                    type="button"
                    className={compactPlannerDangerButtonClassName}
                    disabled={!selectedVisibleCount || isBulkPending}
                    onClick={() => {
                      void handleBulkTrash();
                    }}
                  >
                    Move selected to trash
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={compactPlannerButtonClassName}
                  disabled={!selectedDateTasks.length || allVisibleSelected || isBulkPending}
                  onClick={() => {
                    setSelectedTaskIds(visibleTaskIds);
                  }}
                >
                  Select all visible
                </button>
                <button
                  type="button"
                  className={compactPlannerButtonClassName}
                  disabled={!selectedVisibleCount || isBulkPending}
                  onClick={() => {
                    void runBulkUpdate((task, updatedAt) => ({
                      ...task,
                      completed: true,
                      updatedAt,
                    }));
                  }}
                >
                  Mark complete
                </button>
                <button
                  type="button"
                  className={compactPlannerButtonClassName}
                  disabled={!selectedVisibleCount || isBulkPending}
                  onClick={() => {
                    void runBulkUpdate((task, updatedAt) => ({
                      ...task,
                      completed: false,
                      updatedAt,
                    }));
                  }}
                >
                  Mark incomplete
                </button>
                <select
                  value={bulkCategory}
                  onChange={(event) => setBulkCategory(event.target.value)}
                  className={`${compactPlannerFieldClassName} min-w-[8.5rem] pr-8`}
                  aria-label="Bulk category"
                  disabled={!categoryOptions.length || isBulkPending}
                >
                  <option value="">Category</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={compactPlannerButtonClassName}
                  disabled={!selectedVisibleCount || !bulkCategory || isBulkPending}
                  onClick={() => {
                    void runBulkUpdate((task, updatedAt) => ({
                      ...task,
                      category: bulkCategory,
                      updatedAt,
                    }));
                  }}
                >
                  Change category
                </button>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bulkDurationHours}
                  onChange={(event) => setBulkDurationHours(event.target.value)}
                  className={`${compactPlannerFieldClassName} w-[4.5rem]`}
                  aria-label="Bulk duration hours"
                  placeholder="Hr"
                  disabled={isBulkPending}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={bulkDurationMinutes}
                  onChange={(event) => setBulkDurationMinutes(event.target.value)}
                  className={`${compactPlannerFieldClassName} w-[4.75rem]`}
                  aria-label="Bulk duration minutes"
                  placeholder="Min"
                  disabled={isBulkPending}
                />
                <button
                  type="button"
                  className={compactPlannerButtonClassName}
                  disabled={!selectedVisibleCount || !isBulkDurationValid || isBulkPending}
                  onClick={() => {
                    if (parsedBulkDurationHours === null || parsedBulkDurationMinutes === null) {
                      return;
                    }

                    void runBulkUpdate((task, updatedAt) => ({
                      ...task,
                      durationHours: parsedBulkDurationHours,
                      durationMinutes: parsedBulkDurationMinutes,
                      updatedAt,
                    }));
                  }}
                >
                  Change duration
                </button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle pr-0.5">
            {selectedDateTasks.length ? (
              <div className="space-y-1.5">
                {selectedDateTasks.map((task) => {
                  const index = allSelectedDateTasks.findIndex((entry) => entry.id === task.id);
                  const durationLabel = formatMinutes(getStudyBlockMinutes(task));
                  const tone = getMonthCategoryTone(task.category);
                  const isFirst = index <= 0;
                  const isLast = index === -1 || index >= allSelectedDateTasks.length - 1;

                  return (
                    <article
                      key={task.id}
                      className={cn(
                        "group relative rounded-[12px] border border-white/8 bg-slate-900/45 px-2.5 py-2 transition",
                        task.completed ? "opacity-65" : "hover:border-white/15 hover:bg-slate-900/65",
                      )}
                    >
                      <span
                        className={cn("absolute inset-y-1.5 left-0 w-[2px] rounded-r-full", tone.dotClassName)}
                        aria-hidden="true"
                      />
                      <div className="flex items-center gap-2 pl-1.5">
                        {isSelectionMode ? (
                          <input
                            type="checkbox"
                            checked={selectedVisibleTaskIdSet.has(task.id)}
                            onChange={(event) => {
                              setSelectedTaskIds((current) =>
                                event.target.checked
                                  ? current.includes(task.id)
                                    ? current
                                    : [...current, task.id]
                                  : current.filter((taskId) => taskId !== task.id),
                              );
                            }}
                            aria-label={`Select ${task.task}`}
                            className="h-4 w-4 shrink-0 rounded border-white/15 bg-slate-950 text-cyan-300"
                            disabled={isBulkPending}
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={(event) => {
                              void toggleTask(task, event.target.checked);
                            }}
                            aria-label={`Mark ${task.task} complete`}
                            className="h-4 w-4 shrink-0 rounded border-white/15 bg-slate-950 text-cyan-300"
                          />
                        )}

                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-slate-300",
                            )}
                          >
                            {task.category}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[13px] leading-5",
                              task.completed ? "text-slate-400 line-through decoration-white/25" : "text-white",
                            )}
                            title={task.task}
                          >
                            {task.task}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{durationLabel}</span>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={isFirst}
                            onClick={() => {
                              void moveTask(task, -1);
                            }}
                            aria-label={`Move ${task.task} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                            disabled={isLast}
                            onClick={() => {
                              void moveTask(task, 1);
                            }}
                            aria-label={`Move ${task.task} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-white"
                            aria-label={`Edit ${task.task}`}
                            onClick={() => {
                              setEditorTask(task);
                              setEditorSeedDate(undefined);
                              setShowEditor(true);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {task.reminderAt ? (
                        <p className="mt-1 flex items-center gap-1 pl-[1.875rem] text-[10.5px] text-cyan-200/80">
                          <Bell className="h-3 w-3" aria-hidden="true" />
                          <span className="truncate">{formatDateTimeLabel(task.reminderAt)}</span>
                        </p>
                      ) : null}
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
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1 rounded-[10px] bg-cyan-300/90 px-3 text-[11px] font-semibold text-slate-950 transition hover:bg-cyan-200"
                    onClick={() => openNewTask(selectedDate)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add task
                  </button>
                }
                compact
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
                clearBulkSelection();
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
