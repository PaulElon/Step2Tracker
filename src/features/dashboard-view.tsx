import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  BookOpen,
  CheckCircle2,
  Clock3,
  Flame,
  ListTodo,
  NotebookPen,
  Play,
  Plus,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGoalAlerts,
  getRemediationLinks,
  getStudyBlockMinutes,
  getTodayBlocks,
} from "../lib/analytics";
import { formatLongDate, formatMinutes, getLocalDateKeyFromIso, getTodayKey } from "../lib/datetime";
import { FF } from "../lib/feature-flags";
import { launchResource } from "../lib/launcher";
import { buildPortfolioUrgeSummary, URGE_TRIGGER_LABELS } from "../lib/portfolio-urge-awareness";
import { allocationByMethodDisplay } from "../lib/tf-session-adapters";
import { cn, primaryButtonClassName, secondaryButtonClassName, themeAwareWarmAccent } from "../lib/ui";
import { useAppStore } from "../state/app-store";
import { useTimeFolioStore } from "../state/tf-store";
import { getTrackedStudyMinutesForDate } from "../lib/tf-session-metrics";
import { PomodoroTimerCard } from "./timefolio/pomodoro-timer-card";
import { ModalShell } from "../components/modal-shell";
import { StudyTaskCard } from "../components/study-task-card";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { TaskLaunchButton } from "../components/task-launch-button";
import { NotebookEditorAdapter } from "../components/notebook-editor-adapter";
import { CategoryBadge, EmptyState, FlatList, FlatListRow } from "../components/ui";
import type {
  NotebookDocument,
  NotebookPage,
  ResourceLink,
  SectionId,
  StudyBlock,
  TfSessionLog,
  UrgeLog,
  WeakTopicPriority,
} from "../types/models";

const TODAY_NOTES_DOC_ID = "system-today-notes-v1";
const TODAY_NOTES_PAGE_ID = "system-today-notes-page-v1";

const PRIORITY_RANK: Record<WeakTopicPriority, number> = { High: 0, Medium: 1, Low: 2 };

const todayPanelClassName = "glass-panel min-w-0";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}


function ProgressRing({ percent, size = 132, stroke = 12 }: { percent: number; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(percent, 100));
  const offset = circumference * (1 - clamped / 100);
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="var(--ring-track)"
        strokeWidth={stroke}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="var(--ring-progress)"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        style={{ fontSize: size * 0.24, fontWeight: 600 }}
      >
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

const heroPalette = [
  { bg: "bg-cyan-400/15 border-cyan-300/20", text: "text-cyan-200" },
  { bg: "bg-blue-400/15 border-blue-300/20", text: "text-blue-200" },
  { bg: "bg-violet-400/15 border-violet-300/20", text: "text-violet-200" },
  { bg: "bg-pink-400/15 border-pink-300/20", text: "text-pink-200" },
  { bg: "bg-amber-400/15 border-amber-300/20", text: "text-amber-200" },
  { bg: "bg-emerald-400/15 border-emerald-300/20", text: "text-emerald-200" },
];

function categoryTileStyle(category: string) {
  const hash = [...category].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return heroPalette[hash % heroPalette.length];
}

function categoryShortLabel(category: string) {
  const first = category.split(/[\s_-]/)[0] ?? category;
  return first.length > 6 ? first.slice(0, 5) : first;
}

function findMatchingResource(taskName: string, category: string, resourceLinks: ResourceLink[]): ResourceLink | null {
  const haystack = `${taskName} ${category}`.toLowerCase();
  let best: ResourceLink | null = null;
  for (const link of resourceLinks) {
    if (haystack.includes(link.label.toLowerCase())) {
      if (!best || link.label.length > best.label.length) {
        best = link;
      }
    }
  }
  return best;
}

function looksLikeImportedTaskNotes(notes: string) {
  const normalized = notes.trim().toLowerCase();
  return (
    normalized.startsWith("study schedule task for") ||
    normalized.includes("all-day event") ||
    normalized.includes("no alert") ||
    normalized.includes("calendar metadata")
  );
}

function getHeroSubtitle(task: { notes?: string | null; reminderAt?: string | null }, openCount: number) {
  const notes = task.notes?.trim();
  if (notes && !looksLikeImportedTaskNotes(notes)) {
    return notes;
  }

  if (task.reminderAt) {
    return "Reminder set. Open this task when you are ready to begin.";
  }

  if (openCount > 1) {
    return `${openCount - 1} more task${openCount - 1 === 1 ? "" : "s"} are queued. Start here first.`;
  }

  return "Open the task and get the first block done.";
}


function SnapshotRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-slate-400">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        {label}
      </span>
      <span className="tabular-nums text-white">{value}</span>
    </div>
  );
}

function TodayTimeLogSummary({
  sessionLogs,
}: {
  sessionLogs: TfSessionLog[];
}) {
  const focusLogs = sessionLogs.filter((log) => !log.isDistraction);
  const distractionLogs = sessionLogs.filter((log) => log.isDistraction);
  const allowedMinutes = focusLogs.reduce((total, log) => total + Math.round(log.hours * 60), 0);
  const distractionMinutes = distractionLogs.reduce((total, log) => total + Math.round(log.hours * 60), 0);
  const totalMinutes = allowedMinutes + distractionMinutes;
  const topFocusMethod = allocationByMethodDisplay(focusLogs)[0] ?? null;
  const topDistractionMethod = allocationByMethodDisplay(distractionLogs)[0] ?? null;
  const allowedShare = totalMinutes > 0 ? (allowedMinutes / totalMinutes) * 100 : 0;
  const distractionShare = totalMinutes > 0 ? (distractionMinutes / totalMinutes) * 100 : 0;

  if (sessionLogs.length === 0) {
    return (
      <div className="mt-3 flex flex-col border-t border-white/[0.06] pt-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">Today&apos;s Total</p>
            <p className="mt-1 text-sm font-semibold text-white">0m</p>
          </div>
          <div className="min-w-0 text-center">
            <p className="text-[11px] text-slate-500">Focused</p>
            <p className="mt-1 text-sm font-semibold text-white">0%</p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[11px] text-slate-500">Distractions</p>
            <p className="mt-1 text-sm font-semibold text-white">0%</p>
          </div>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="bar-focused bg-cyan-300/70" style={{ width: "0%" }} />
          <div className="bar-distractions bg-rose-300/70" style={{ width: "0%" }} />
        </div>
        <div className="mt-3 space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">Top focus</span>
              <span className="min-w-0 flex-1 truncate text-right text-slate-300">No focused study yet</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">Top distraction</span>
              <span className="min-w-0 flex-1 truncate text-right text-slate-300">No distractions logged</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">Open the timer when you start a block.</p>
      </div>
    );
  }

  const topFocusMinutes = topFocusMethod ? Math.round(topFocusMethod.hours * 60) : 0;
  const topDistractionMinutes = topDistractionMethod ? Math.round(topDistractionMethod.hours * 60) : 0;
  const topFocusShare = allowedMinutes > 0 ? (topFocusMinutes / allowedMinutes) * 100 : 0;
  const topDistractionShare = distractionMinutes > 0 ? (topDistractionMinutes / distractionMinutes) * 100 : 0;

  return (
    <div className="mt-3 flex flex-col border-t border-white/[0.06] pt-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500">Today&apos;s Total</p>
          <p className="mt-1 text-sm font-semibold text-white">{formatMinutes(totalMinutes)}</p>
        </div>
        <div className="min-w-0 text-center">
          <p className="text-[11px] text-slate-500">Focused</p>
          <p className="mt-1 text-sm font-semibold text-white">{allowedShare.toFixed(0)}%</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] text-slate-500">Distractions</p>
          <p className="mt-1 text-sm font-semibold text-white">{distractionShare.toFixed(0)}%</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="bar-focused bg-cyan-300/70" style={{ width: `${allowedShare}%` }} />
          <div className="bar-distractions bg-rose-300/70" style={{ width: `${distractionShare}%` }} />
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">Top focus</span>
            <div className="min-w-0 flex flex-1 items-center justify-end gap-2">
              <span className="truncate text-slate-200">{topFocusMethod?.method ?? "No focused study yet"}</span>
              <span className="shrink-0 tabular-nums text-slate-400">{formatMinutes(topFocusMinutes)}</span>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bar-focused h-full rounded-full bg-cyan-300/70"
              style={{ width: `${Math.max(topFocusShare, topFocusMinutes > 0 ? 8 : 0)}%` }}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-500">Top distraction</span>
            <div className="min-w-0 flex flex-1 items-center justify-end gap-2">
              <span className="truncate text-slate-200">
                {topDistractionMethod?.method ?? "No distractions logged"}
              </span>
              <span className="shrink-0 tabular-nums text-slate-400">{formatMinutes(topDistractionMinutes)}</span>
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bar-distractions h-full rounded-full bg-rose-300/70"
              style={{ width: `${Math.max(topDistractionShare, topDistractionMinutes > 0 ? 8 : 0)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatUrgeTimeLabel(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function UrgeAwarenessCard({
  urgeLogs,
}: {
  urgeLogs: UrgeLog[];
}) {
  const urgeSummary = buildPortfolioUrgeSummary(urgeLogs);
  const totalCount = urgeSummary.totalCount;
  const averageIntensity = urgeSummary.averageIntensity;
  const topTrigger = urgeSummary.topTrigger;

  return (
    <section className={cn(todayPanelClassName, "flex min-h-0 flex-1 flex-col overflow-hidden p-4")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-white">Urge Awareness</h3>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Total</p>
          <p className="mt-1 text-sm font-semibold text-white">{totalCount}</p>
        </div>
        <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Avg intensity</p>
          <p className="mt-1 text-sm font-semibold text-white">{totalCount ? averageIntensity.toFixed(1) : "0.0"}</p>
        </div>
        <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Top trigger</p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {topTrigger ? URGE_TRIGGER_LABELS[topTrigger] : "None"}
          </p>
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-[16px] border border-white/[0.06] bg-white/[0.02]">
        {urgeLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <p className="text-sm font-medium text-slate-300">No urges logged today.</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
              When you log one during a session, it will appear here.
            </p>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 scrollbar-subtle">
            <section className="shrink-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  By trigger
                </p>
                <p className="text-[10px] text-slate-500">Count and average intensity</p>
              </div>
              <div className="mt-2 space-y-2">
                {urgeSummary.breakdown.slice(0, 3).map((entry) => (
                  <div
                    key={entry.trigger}
                    className="rounded-[14px] border border-violet-400/15 bg-violet-500/[0.04] px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[12px] font-medium text-slate-100">{entry.label}</p>
                      <p className="shrink-0 text-[11px] tabular-nums text-slate-400">
                        {entry.count} · {entry.averageIntensity.toFixed(1)}/5
                      </p>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400"
                        style={{ width: `${Math.max(entry.sharePercent, 6)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex shrink-0 flex-col overflow-hidden rounded-[16px] border border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Recent examples
                </p>
              </div>
              <div className="p-3 pr-2">
                <div className="space-y-2">
                  {urgeSummary.examples.map((urgeLog) => {
                    const subject = urgeLog.subject?.trim();
                    const note = urgeLog.note?.trim();
                    const isHighIntensity = urgeLog.intensity >= 4;
                    return (
                      <div
                        key={urgeLog.id}
                        className="rounded-[14px] border border-violet-400/12 bg-violet-500/[0.035] px-3 py-2.5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="text-[11px] font-medium tabular-nums text-slate-500">
                                {formatUrgeTimeLabel(urgeLog.timestamp)}
                              </span>
                              <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-[11px] text-violet-100">
                                {URGE_TRIGGER_LABELS[urgeLog.trigger]}
                              </span>
                              {subject ? (
                                <span className="min-w-0 truncate text-xs text-slate-400">{subject}</span>
                              ) : null}
                            </div>
                            {note ? (
                              <p className="mt-1 truncate text-xs leading-5 text-slate-300">{note}</p>
                            ) : null}
                          </div>
                          <span
                            className={cn(
                              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                              isHighIntensity
                                ? "border-amber-400/30 bg-amber-400/12 text-amber-200"
                                : "border-violet-400/20 bg-violet-400/10 text-violet-100",
                            )}
                          >
                            {urgeLog.intensity}/5
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

export function DashboardView({ onOpenNotebook }: { onOpenNotebook?: () => void }) {
  const {
    state,
    persistenceStatus,
    upsertStudyBlock,
    setDailyGoalMinutes,
    setActiveSection,
    setNotebookDocuments,
  } = useAppStore();
  const { state: tfState } = useTimeFolioStore();
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [editingTask, setEditingTask] = useState<StudyBlock | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);
  const [goalHoursValue, setGoalHoursValue] = useState("");
  const [goalMinsValue, setGoalMinsValue] = useState("");

  // Today Notes — backed by the system notebook document
  const [todayNotesHtml, setTodayNotesHtml] = useState("");
  const [notesEditorKey, setNotesEditorKey] = useState("today-notes-v1-empty");
  const notesInitializedRef = useRef(false);
  const notesSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notebookDocumentsRef = useRef(state.preferences.notebookDocuments);

  useEffect(() => {
    notebookDocumentsRef.current = state.preferences.notebookDocuments;
  }, [state.preferences.notebookDocuments]);

  useEffect(() => {
    if (persistenceStatus !== "ready") return;
    if (notesInitializedRef.current) return;
    notesInitializedRef.current = true;

    const documents = notebookDocumentsRef.current;
    const existing = documents.find((d) => d.id === TODAY_NOTES_DOC_ID);
    if (existing) {
      const html = existing.pages[0]?.contentHtml ?? "";
      setTodayNotesHtml(html);
      setNotesEditorKey("today-notes-v1-loaded");
      return;
    }

    const now = new Date().toISOString();
    const firstPage: NotebookPage = {
      id: TODAY_NOTES_PAGE_ID,
      title: "Today's Notes",
      contentHtml: "",
      order: 0,
      createdAt: now,
      updatedAt: now,
    };
    const newDoc: NotebookDocument = {
      id: TODAY_NOTES_DOC_ID,
      title: "Today's Notes",
      systemKind: "today-notes",
      order: 0,
      pages: [firstPage],
      createdAt: now,
      updatedAt: now,
    };
    void setNotebookDocuments([...documents, newDoc]);
    setNotesEditorKey("today-notes-v1-loaded");
  }, [persistenceStatus, setNotebookDocuments]);

  const handleNotesChange = useCallback(
    (html: string) => {
      setTodayNotesHtml(html);
      if (notesSaveTimerRef.current) clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = setTimeout(() => {
        notesSaveTimerRef.current = null;
        const docs = notebookDocumentsRef.current;
        const now = new Date().toISOString();
        const existingIdx = docs.findIndex((d) => d.id === TODAY_NOTES_DOC_ID);
        let nextDocs: NotebookDocument[];
        if (existingIdx >= 0) {
          nextDocs = docs.map((d, i) =>
            i === existingIdx
              ? {
                  ...d,
                  pages: d.pages.map((p, pi) =>
                    pi === 0 ? { ...p, contentHtml: html, updatedAt: now } : p,
                  ),
                  updatedAt: now,
                }
              : d,
          );
        } else {
          const page: NotebookPage = {
            id: TODAY_NOTES_PAGE_ID,
            title: "Today's Notes",
            contentHtml: html,
            order: 0,
            createdAt: now,
            updatedAt: now,
          };
          const newDoc: NotebookDocument = {
            id: TODAY_NOTES_DOC_ID,
            title: "Today's Notes",
            systemKind: "today-notes",
            order: 0,
            pages: [page],
            createdAt: now,
            updatedAt: now,
          };
          nextDocs = [...docs, newDoc];
        }
        void setNotebookDocuments(nextDocs);
      }, 1000);
    },
    [setNotebookDocuments],
  );

  const todayKey = getTodayKey();
  const trackedStudyMinutes = FF.timefolio
    ? getTrackedStudyMinutesForDate(tfState.sessionLogs, todayKey)
    : 0;
  const todaySessionLogs = FF.timefolio ? tfState.sessionLogs.filter((log) => log.date === todayKey) : [];
  const todayUrgeLogs = FF.timefolio
    ? (tfState.urgeLogs ?? []).filter((log) => getLocalDateKeyFromIso(log.timestamp) === todayKey)
    : [];
  const todayTasks = getTodayBlocks(state.studyBlocks, todayKey);
  const plannedMinutes = todayTasks.reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completedMinutes = todayTasks
    .filter((task) => task.completed)
    .reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const todayGoalMinutes = state.preferences.dailyGoalMinutes;
  const themeId = state.preferences.themeId;
  const dailyGoalProgress = todayGoalMinutes ? Math.min((completedMinutes / todayGoalMinutes) * 100, 100) : 0;
  const alerts = getGoalAlerts(state.studyBlocks, state.practiceTests, todayGoalMinutes).slice(0, 3);
  const activeWeakTopics = state.weakTopicEntries.filter((entry) => entry.status !== "Resolved");
  const nextTask = todayTasks.find((task) => !task.completed) ?? null;
  const nextOpenTaskId = nextTask?.id ?? "";
  const openCount = todayTasks.filter((task) => !task.completed).length;
  const completedCount = todayTasks.length - openCount;
  const remediationLinks = getRemediationLinks(state.practiceTests, state.studyBlocks);
  const uncoveredTopicNamesRaw = [...new Set(remediationLinks.flatMap((l) => l.uncoveredTopics))];
  // Sort weak-topic pills: High → Medium → Low, then by manualOccurrenceCount desc, then lastSeenAt desc.
  const sortedUncoveredTopicNames = [...uncoveredTopicNamesRaw].sort((a, b) => {
    const ea = state.weakTopicEntries.find((e) => e.topic === a && e.status !== "Resolved");
    const eb = state.weakTopicEntries.find((e) => e.topic === b && e.status !== "Resolved");
    const ra = ea ? PRIORITY_RANK[ea.priority] : 1;
    const rb = eb ? PRIORITY_RANK[eb.priority] : 1;
    if (ra !== rb) return ra - rb;
    const oa = ea?.manualOccurrenceCount ?? 0;
    const ob = eb?.manualOccurrenceCount ?? 0;
    if (ob !== oa) return ob - oa;
    return (eb?.lastSeenAt ?? "").localeCompare(ea?.lastSeenAt ?? "");
  });
  const greeting = getGreeting();
  const heroTile = nextTask ? categoryTileStyle(nextTask.category) : null;
  const heroNextTaskMinutes = nextTask ? getStudyBlockMinutes(nextTask) : 0;
  const resourceLinks = state.preferences.resourceLinks;

  const commitGoalMinutes = () => {
    const hours = Math.max(0, Math.floor(Number(goalHoursValue) || 0));
    const mins = Math.max(0, Math.floor(Number(goalMinsValue) || 0));
    const totalMinutes = hours * 60 + mins;
    if (totalMinutes >= 1 && totalMinutes <= 1440) {
      void setDailyGoalMinutes(totalMinutes);
    }
    setEditingGoal(false);
  };

  const goToSection = (section: SectionId) => {
    void setActiveSection(section);
  };

  const openNewTaskEditor = () => {
    setEditingTask(null);
    setShowTaskEditor(true);
  };

  async function startNextTask(task: StudyBlock) {
    setShowTaskEditor(false);
    setEditingTask(null);
    const resource = findMatchingResource(task.task, task.category, resourceLinks);
    if (resource) {
      try {
        await launchResource(resource.url);
        return;
      } catch {
        // Fall back to the task editor if the resource cannot launch.
      }
    }

    setEditingTask(task);
  }

  type BestMove = {
    icon: typeof AlertCircle;
    iconBgClass: string;
    iconColorClass: string;
    title: string;
    subtitle: string;
    action: () => void;
  };

  const bestMoves: BestMove[] = [];

  if (nextTask) {
    bestMoves.push({
      icon: Play,
      iconBgClass: "border-violet-300/20 bg-violet-300/10",
      iconColorClass: "text-violet-300",
      title: "Start your next task",
      subtitle: nextTask.task,
      action: () => {
        void startNextTask(nextTask);
      },
    });
  } else if (todayTasks.length === 0) {
    bestMoves.push({
      icon: Plus,
      iconBgClass: "border-slate-300/20 bg-slate-300/10",
      iconColorClass: "text-slate-300",
      title: "Plan your day",
      subtitle: "Add tasks to get started",
      action: openNewTaskEditor,
    });
  }

  if (activeWeakTopics.length > 0) {
    bestMoves.push({
      icon: Flame,
      iconBgClass: "border-amber-300/20 bg-amber-300/10",
      iconColorClass: "text-amber-300",
      title: "Review weak topics",
      subtitle: `${activeWeakTopics.length} topic${activeWeakTopics.length === 1 ? "" : "s"} need attention`,
      action: () => goToSection("weakTopics"),
    });
  }

  bestMoves.push({
    icon: AlertCircle,
    iconBgClass: "border-rose-300/20 bg-rose-300/10",
    iconColorClass: "text-rose-300",
    title: "Log your errors",
    subtitle: "Review and learn",
    action: () => goToSection("errorLog"),
  });

  if (openCount > 0) {
    bestMoves.push({
      icon: TrendingUp,
      iconBgClass: "border-cyan-300/20 bg-cyan-300/10",
      iconColorClass: "text-cyan-300",
      title: "Stay on track",
      subtitle: "Focus for a study block",
      action: () => goToSection("planner"),
    });
  } else {
    bestMoves.push({
      icon: TrendingUp,
      iconBgClass: "border-blue-300/20 bg-blue-300/10",
      iconColorClass: "text-blue-300",
      title: "Plan tomorrow",
      subtitle: "Schedule your next session",
      action: () => goToSection("planner"),
    });
  }

  if (FF.notebook && onOpenNotebook) {
    bestMoves.push({
      icon: BookOpen,
      iconBgClass: "border-slate-300/20 bg-slate-300/10",
      iconColorClass: "text-slate-300",
      title: "Open Notebook",
      subtitle: "Capture notes and references",
      action: onOpenNotebook,
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col pr-1">
        <div className="mb-5 flex shrink-0 flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Today</h2>
            <p className="mt-1 text-sm text-slate-400">{formatLongDate(todayKey)}</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-sm text-slate-300">
              <span className="text-slate-500">{greeting}.</span>{" "}
              {nextTask ? "Keep your momentum going." : completedCount > 0 ? "You finished today's plan." : "Plan your day to get started."}
            </p>
          </div>
        </div>

        <div className="grid min-h-0 w-full flex-1 gap-4 xl:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]">
          {/* MAIN COLUMN */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            {/* HERO: Your Next Task */}
            {nextTask ? (
              <section className={cn(todayPanelClassName, "shrink-0 p-5")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[0.65rem] text-slate-500">Your next task</p>
                    <CategoryBadge category={nextTask.category} />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {todayTasks.length === 1
                      ? "Only task today"
                      : `${completedCount} of ${todayTasks.length} done`}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-start gap-4">
                  {heroTile ? (
                    <div
                      className={cn(
                        "flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border",
                        heroTile.bg,
                      )}
                    >
                      <span className={cn("text-[0.62rem] font-bold uppercase tracking-wider", heroTile.text)}>
                        {categoryShortLabel(nextTask.category)}
                      </span>
                    </div>
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <h3 className="text-[1.9rem] font-bold leading-tight tracking-[-0.03em] text-white">
                      {nextTask.task}
                    </h3>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                        {formatMinutes(heroNextTaskMinutes)}
                      </span>
                      {nextTask.reminderAt ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Bell className="h-3.5 w-3.5 text-cyan-300" />
                          Reminder set
                        </span>
                      ) : null}
                      {openCount > 1 ? <span className="text-slate-500">{openCount - 1} more queued</span> : null}
                    </div>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                      {getHeroSubtitle(nextTask, openCount)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2.5">
                    <TaskLaunchButton taskTitle={nextTask.task} taskCategory={nextTask.category} />
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => {
                        void upsertStudyBlock({ ...nextTask, completed: true });
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Mark done
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section className={cn(todayPanelClassName, "shrink-0 p-5")}>
                <p className="text-[0.65rem] text-slate-500">Your next task</p>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold tracking-[-0.02em] text-white">
                      {todayTasks.length ? "Day complete" : "Today is clear"}
                    </h3>
                    <p className="mt-2 text-sm text-slate-400">
                      {todayTasks.length
                        ? "Every task today is checked off. Plan ahead or take a breather."
                        : "Nothing scheduled yet. Add a task to start your day."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primaryButtonClassName}
                      onClick={openNewTaskEditor}
                    >
                      <Plus className="h-4 w-4" />
                      Add task
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => goToSection("planner")}
                    >
                      Plan tomorrow
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Today's Plan + Today Snapshot */}
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section className={cn(todayPanelClassName, "flex min-h-0 flex-col overflow-hidden p-5")}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">Today's Plan</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {todayTasks.length
                        ? `${openCount} open · ${completedCount} done`
                        : "No tasks scheduled"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={openNewTaskEditor}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>

                <div className="mt-4 min-h-0 min-w-0 flex-1 overflow-y-auto pr-0.5 scrollbar-subtle">
                  {todayTasks.length ? (
                    <div className="space-y-2 pr-0.5">
                      {[
                        ...todayTasks.filter((t) => !t.completed),
                        ...todayTasks.filter((t) => t.completed),
                      ].map((task) => (
                        <StudyTaskCard
                          key={task.id}
                          block={task}
                          compact
                          onToggleComplete={(completed) => {
                            void upsertStudyBlock({ ...task, completed });
                          }}
                          actionSlot={
                            task.id === nextOpenTaskId && !task.completed ? (
                              <span className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
                                Up next
                              </span>
                            ) : null
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="Nothing planned"
                      description="Add a task or use Plan to schedule the week."
                      compact
                      action={
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={openNewTaskEditor}
                        >
                          Add task
                        </button>
                      }
                    />
                  )}
                </div>
              </section>

              {/* Today Snapshot + Timer box */}
              <div className="flex min-h-0 min-w-0 flex-col gap-4">
                <section className={cn(todayPanelClassName, "flex shrink-0 flex-col p-4")}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-white">Today Snapshot</h3>
                    <span className="text-xs text-slate-500">Goal {formatMinutes(todayGoalMinutes)}</span>
                  </div>

                  <div className="mt-3 flex items-center gap-4">
                    <ProgressRing percent={dailyGoalProgress} size={88} stroke={8} />
                    <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                      <SnapshotRow icon={Clock3} label="Done time" value={formatMinutes(completedMinutes)} />
                      {FF.timefolio ? (
                        <SnapshotRow icon={Timer} label="Tracked study" value={formatMinutes(trackedStudyMinutes)} />
                      ) : null}
                      <SnapshotRow
                        icon={ListTodo}
                        label="Tasks done"
                        value={`${completedCount} / ${todayTasks.length}`}
                      />
                      <SnapshotRow icon={Timer} label="Remaining" value={String(openCount)} />
                      <SnapshotRow icon={Timer} label="Planned" value={formatMinutes(plannedMinutes)} />
                    </div>
                  </div>

                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    {editingGoal ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          autoFocus
                          min="0"
                          max="23"
                          step="1"
                          className="w-14 rounded-[12px] border border-white/20 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
                          value={goalHoursValue}
                          onChange={(e) => setGoalHoursValue(e.target.value)}
                          onBlur={commitGoalMinutes}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingGoal(false);
                          }}
                          placeholder="0"
                        />
                        <span className="text-[10px] text-slate-500">h</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="59"
                          step="1"
                          className="w-14 rounded-[12px] border border-white/20 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
                          value={goalMinsValue}
                          onChange={(e) => setGoalMinsValue(e.target.value)}
                          onBlur={commitGoalMinutes}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingGoal(false);
                          }}
                          placeholder="0"
                        />
                        <span className="text-[10px] text-slate-500">m</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                        onClick={() => {
                          setGoalHoursValue(String(Math.floor(todayGoalMinutes / 60)));
                          setGoalMinsValue(String(todayGoalMinutes % 60));
                          setEditingGoal(true);
                        }}
                      >
                        Edit goal
                      </button>
                    )}
                  </div>
                </section>

                <section className={cn(todayPanelClassName, "flex shrink-0 flex-col p-4")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Timer className="h-4 w-4 text-cyan-200" />
                      <h3 className="text-base font-semibold text-white">Time your study session</h3>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="launch-button max-w-none shrink-0"
                        onClick={() => goToSection("sessionLog")}
                      >
                        Open Timer
                      </button>
                      <button
                        type="button"
                        className="inline-flex max-w-none items-center overflow-hidden rounded-full border border-white/[0.12] px-2.5 py-1 text-[11px] font-medium text-slate-300 transition hover:border-white/20 hover:text-slate-100"
                        onClick={() => setShowPomodoroModal(true)}
                        aria-haspopup="dialog"
                        aria-expanded={showPomodoroModal}
                      >
                        Pomodoro
                      </button>
                    </div>
                  </div>

                  <TodayTimeLogSummary sessionLogs={todaySessionLogs} />
                </section>

                <UrgeAwarenessCard urgeLogs={todayUrgeLogs} />
              </div>
            </div>
          </div>

          {/* RIGHT RAIL */}
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            {/* Needs Attention — compact, no footer metrics */}
            <section className={cn(todayPanelClassName, "shrink-0 p-4")}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle
                    className={themeAwareWarmAccent(themeId, "h-4 w-4 text-orange-300/80", "h-4 w-4 text-amber-300/80")}
                  />
                  <h3 className="text-base font-semibold text-white">Needs Attention</h3>
                </div>
                {activeWeakTopics.length ? (
                  <button
                    type="button"
                    className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                    onClick={() => goToSection("weakTopics")}
                  >
                    View all
                  </button>
                ) : null}
              </div>

              <div className="mt-3 space-y-2.5">
                {alerts.length ? (
                  alerts.map((alert) => {
                    const isWeakTopicAlert = alert.title === "Weak topics are not scheduled";
                    return (
                      <div
                        key={alert.title}
                        className={cn(
                          "rounded-[14px] border p-3",
                          alert.tone === "critical"
                            ? "border-rose-300/25 bg-rose-300/[0.06]"
                            : alert.tone === "warning"
                              ? "border-amber-300/25 bg-amber-300/[0.06]"
                              : "border-white/10 bg-white/[0.03]",
                        )}
                      >
                        <p className="text-sm font-semibold text-white">{alert.title}</p>
                        {isWeakTopicAlert ? (
                          <div className="mt-2 max-h-[3.5rem] overflow-hidden">
                            <div className="flex flex-wrap gap-1.5">
                              {sortedUncoveredTopicNames.map((topic) => {
                                const entry = state.weakTopicEntries.find(
                                  (e) => e.topic === topic && e.status !== "Resolved",
                                );
                                const priority = entry?.priority ?? "Medium";
                                const pillClass =
                                  priority === "High"
                                    ? "border-rose-300/30 bg-rose-300/15 text-rose-200"
                                    : priority === "Low"
                                      ? "border-slate-300/20 bg-slate-300/10 text-slate-300"
                                      : "border-amber-300/30 bg-amber-300/15 text-amber-200";
                                return (
                                  <span
                                    key={topic}
                                    className={cn(
                                      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
                                      pillClass,
                                    )}
                                  >
                                    {topic}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-xs leading-5 text-slate-300">{alert.body}</p>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="rounded-[14px] border border-dashed border-white/10 bg-white/[0.02] p-3 text-sm text-slate-400">
                    Nothing flagged right now.
                  </p>
                )}
              </div>
            </section>

            {/* Next Best Moves */}
            <section className={cn(todayPanelClassName, "shrink-0 p-4")}>
              <div className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-slate-500" />
                <h3 className="text-base font-semibold text-white">Next Best Moves</h3>
              </div>
              <FlatList className="mt-3">
                {bestMoves.slice(0, 4).map((move) => (
                  <FlatListRow key={move.title} onClick={move.action}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                          move.iconBgClass,
                        )}
                      >
                        <move.icon className={cn("h-4 w-4", move.iconColorClass)} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{move.title}</p>
                        <p className="truncate text-xs text-slate-400">{move.subtitle}</p>
                      </div>
                    </div>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
                  </FlatListRow>
                ))}
              </FlatList>
            </section>

            {/* Today's Notes — notebook-backed sticky note, fills remaining rail space */}
            <section className={cn(todayPanelClassName, "flex min-h-0 flex-1 flex-col p-4")}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <NotebookPen
                    className={themeAwareWarmAccent(themeId, "h-4 w-4 text-orange-300/70", "h-4 w-4 text-amber-300/70")}
                  />
                  <h3 className="text-base font-semibold text-white">Today's Notes</h3>
                </div>
                {FF.notebook ? (
                  <button
                    type="button"
                    className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                    onClick={() => {
                      if (onOpenNotebook) {
                        onOpenNotebook();
                      } else {
                        goToSection("notebook");
                      }
                    }}
                  >
                    Open full
                  </button>
                ) : null}
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-[14px]">
                <NotebookEditorAdapter
                  editorKey={notesEditorKey}
                  value={todayNotesHtml}
                  onChange={handleNotesChange}
                  placeholder="Quick notes for today…"
                  fillParent
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      {showTaskEditor ? (
        <StudyTaskEditorSheet
          key={`today-${todayKey}`}
          seedDate={todayKey}
          onClose={() => setShowTaskEditor(false)}
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
                order: maxOrderForDate + 1,
              });
              if (saved) {
                setShowTaskEditor(false);
              }
            })();
          }}
        />
      ) : null}
      {editingTask ? (
        <StudyTaskEditorSheet
          key={editingTask.id}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={(draft) => {
            void (async () => {
              const saved = await upsertStudyBlock(draft);
              if (saved) {
                setEditingTask(null);
              }
            })();
          }}
        />
      ) : null}
      {showPomodoroModal ? (
        <ModalShell
          onClose={() => setShowPomodoroModal(false)}
          position="center"
          titleId="today-pomodoro-modal-title"
          contentClassName="max-w-[760px] border-none bg-transparent p-0 shadow-none"
        >
          <h2 id="today-pomodoro-modal-title" className="sr-only">
            Pomodoro timer
          </h2>
          <PomodoroTimerCard />
        </ModalShell>
      ) : null}
    </div>
  );
}
