import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Flame,
  Lightbulb,
  ListTodo,
  Play,
  Plus,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState } from "react";
import {
  getGoalAlerts,
  getPracticeMetrics,
  getRemediationLinks,
  getStudyBlockMinutes,
  getTodayBlocks,
} from "../lib/analytics";
import { formatLongDate, formatMinutes, getTodayKey } from "../lib/datetime";
import { FF } from "../lib/feature-flags";
import { cn, primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import { useAppStore } from "../state/app-store";
import { StudyTaskCard } from "../components/study-task-card";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { TaskLaunchButton } from "../components/task-launch-button";
import { CategoryBadge, EmptyState } from "../components/ui";
import type { ExamTimer, SectionId } from "../types/models";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getSoonestUpcomingTimer(timers: ExamTimer[]): ExamTimer | null {
  const now = Date.now();
  const upcoming = timers
    .map((timer) => ({
      timer,
      time: new Date(`${timer.examDate}T${timer.examTime ?? "23:59"}`).getTime(),
    }))
    .filter((entry) => entry.time > now)
    .sort((left, right) => left.time - right.time);
  return upcoming[0]?.timer ?? null;
}

function daysUntilTimer(timer: ExamTimer): number {
  const target = new Date(`${timer.examDate}T${timer.examTime ?? "23:59"}`).getTime();
  return Math.max(0, Math.ceil((target - Date.now()) / 86_400_000));
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

const FOCUS_TIPS = [
  "Start with a 10-minute opening sprint. Momentum matters more than perfect conditions.",
  "Reduce switching costs: finish one task before opening the next tab.",
  "Capture distractions once, then return to the current block immediately.",
  "A clean first step beats a complicated plan. Make the next action obvious.",
];

function getDailyFocusTip(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return FOCUS_TIPS[hash % FOCUS_TIPS.length];
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

export function DashboardView({ onOpenNotebook }: { onOpenNotebook?: () => void }) {
  const { state, upsertStudyBlock, setDailyGoalMinutes, setActiveSection } = useAppStore();
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInputValue, setGoalInputValue] = useState("");

  const todayKey = getTodayKey();
  const todayTasks = getTodayBlocks(state.studyBlocks, todayKey);
  const plannedMinutes = todayTasks.reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completedMinutes = todayTasks
    .filter((task) => task.completed)
    .reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const todayGoalMinutes = state.preferences.dailyGoalMinutes;
  const dailyGoalProgress = todayGoalMinutes ? Math.min((completedMinutes / todayGoalMinutes) * 100, 100) : 0;
  const alerts = getGoalAlerts(state.studyBlocks, state.practiceTests, todayGoalMinutes).slice(0, 3);
  const activeWeakTopics = state.weakTopicEntries.filter((entry) => entry.status !== "Resolved");
  const nextTask = todayTasks.find((task) => !task.completed) ?? null;
  const nextOpenTaskId = nextTask?.id ?? "";
  const openCount = todayTasks.filter((task) => !task.completed).length;
  const completedCount = todayTasks.length - openCount;
  const practiceMetrics = getPracticeMetrics(state.practiceTests);
  const remediationLinks = getRemediationLinks(state.practiceTests, state.studyBlocks);
  const uncoveredTopicNames = [...new Set(remediationLinks.flatMap((l) => l.uncoveredTopics))];
  const upcomingTimer = getSoonestUpcomingTimer(state.preferences.examTimers);
  const greeting = getGreeting();
  const heroTile = nextTask ? categoryTileStyle(nextTask.category) : null;
  const heroNextTaskMinutes = nextTask ? getStudyBlockMinutes(nextTask) : 0;

  const commitGoalMinutes = () => {
    const parsedMinutes = Number(goalInputValue);
    if (Number.isInteger(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 1440) {
      void setDailyGoalMinutes(parsedMinutes);
    }
    setEditingGoal(false);
  };

  const goToSection = (section: SectionId) => {
    void setActiveSection(section);
  };

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
      action: () => {},
    });
  } else if (todayTasks.length === 0) {
    bestMoves.push({
      icon: Plus,
      iconBgClass: "border-slate-300/20 bg-slate-300/10",
      iconColorClass: "text-slate-300",
      title: "Plan your day",
      subtitle: "Add tasks to get started",
      action: () => setShowTaskEditor(true),
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-subtle">
        <div className="grid w-full gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(280px,1fr)]">
          {/* MAIN COLUMN */}
          <div className="flex min-w-0 flex-col gap-5">
            {/* Masthead */}
            <div className="flex flex-wrap items-end justify-between gap-3">
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

            {/* HERO: Your Next Task */}
            {nextTask ? (
              <section className="glass-panel min-w-0 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">Your next task</p>
                    <CategoryBadge category={nextTask.category} />
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {todayTasks.length === 1
                      ? "Only task today"
                      : `${completedCount} of ${todayTasks.length} done`}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-start gap-5">
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
              <section className="glass-panel min-w-0 p-6">
                <p className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">Your next task</p>
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
                      onClick={() => setShowTaskEditor(true)}
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
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section className="glass-panel flex min-w-0 flex-col p-5">
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
                    onClick={() => setShowTaskEditor(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>

                <div className="mt-4 min-w-0">
                  {todayTasks.length ? (
                    <div className="space-y-2.5">
                      {todayTasks.map((task) => (
                        <StudyTaskCard
                          key={task.id}
                          block={task}
                          compact
                          onToggleComplete={(completed) => {
                            void upsertStudyBlock({ ...task, completed });
                          }}
                          actionSlot={
                            task.id === nextOpenTaskId && !task.completed ? (
                              <span className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-xs text-cyan-100">
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
                          onClick={() => setShowTaskEditor(true)}
                        >
                          Add task
                        </button>
                      }
                    />
                  )}
                </div>
              </section>

              {/* Today Snapshot */}
              <section className="glass-panel flex min-w-0 flex-col p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-semibold text-white">Today Snapshot</h3>
                  <span className="text-xs text-slate-500">Goal {formatMinutes(todayGoalMinutes)}</span>
                </div>

                <div className="mt-3 flex items-center gap-4">
                  <ProgressRing percent={dailyGoalProgress} size={88} stroke={8} />
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <SnapshotRow icon={Clock3} label="Studied" value={formatMinutes(completedMinutes)} />
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
                      <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Min</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        autoFocus
                        min="1"
                        max="1440"
                        step="1"
                        className="w-20 rounded-[12px] border border-white/20 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
                        value={goalInputValue}
                        onChange={(e) => setGoalInputValue(e.target.value)}
                        onBlur={commitGoalMinutes}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingGoal(false);
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                      onClick={() => {
                        setGoalInputValue(String(todayGoalMinutes));
                        setEditingGoal(true);
                      }}
                    >
                      Edit goal
                    </button>
                  )}
                </div>
              </section>
            </div>

            {/* Next Best Moves */}
            <section className="glass-panel min-w-0 p-5">
              <div className="mb-4 flex items-center gap-2">
                <Zap className="h-4 w-4 text-slate-500" />
                <h3 className="text-base font-semibold text-white">Next Best Moves</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {bestMoves.slice(0, 4).map((move) => (
                  <button
                    type="button"
                    key={move.title}
                    onClick={move.action}
                    className="group flex items-start gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.02] p-3.5 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05]"
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                        move.iconBgClass,
                      )}
                    >
                      <move.icon className={cn("h-4 w-4", move.iconColorClass)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{move.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{move.subtitle}</p>
                    </div>
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors group-hover:text-slate-300" />
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                These recommendations are based on your plan and recent activity.
              </p>
            </section>
          </div>

          {/* RIGHT RAIL */}
          <div className="flex min-w-0 flex-col gap-5">
            {/* Needs Attention */}
            <section className="glass-panel min-w-0 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-300/80" />
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
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {uncoveredTopicNames.map((topic) => {
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

                {activeWeakTopics.length ? (
                  <div className="border-t border-white/[0.06] pt-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                      {activeWeakTopics.length} active weak topic{activeWeakTopics.length === 1 ? "" : "s"}
                    </p>
                    {practiceMetrics.averageScore != null ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Practice avg {practiceMetrics.averageScore.toFixed(1)}%
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>

            {/* Active Tracker */}
            <section className="glass-panel min-w-0 p-5">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-cyan-200" />
                <h3 className="text-base font-semibold text-white">Active Tracker</h3>
              </div>

              {upcomingTimer ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{upcomingTimer.label}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {daysUntilTimer(upcomingTimer)} day{daysUntilTimer(upcomingTimer) === 1 ? "" : "s"} until test
                    </p>
                  </div>
                  <div className="border-t border-white/[0.06] pt-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Today</p>
                    <p className="mt-1 text-sm text-slate-200">
                      <span className="tabular-nums text-white">{formatMinutes(completedMinutes)}</span>
                      <span className="text-slate-500"> studied · {formatMinutes(plannedMinutes)} planned</span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-slate-400">
                    No upcoming test set. Add a countdown from the sidebar to track an exam date.
                  </p>
                  <div className="border-t border-white/[0.06] pt-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Today</p>
                    <p className="mt-1 text-sm text-slate-200">
                      <span className="tabular-nums text-white">{formatMinutes(completedMinutes)}</span>
                      <span className="text-slate-500"> studied · {formatMinutes(plannedMinutes)} planned</span>
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Quick Actions */}
            <section className="glass-panel min-w-0 p-5">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-slate-500" />
                <h3 className="text-base font-semibold text-white">Quick Actions</h3>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <QuickAction
                  icon={ClipboardCheck}
                  label="Practice Tests"
                  onClick={() => goToSection("tests")}
                />
                <QuickAction
                  icon={Flame}
                  label="Weak Topics"
                  onClick={() => goToSection("weakTopics")}
                />
                <QuickAction
                  icon={AlertCircle}
                  label="Error Log"
                  onClick={() => goToSection("errorLog")}
                />
                {FF.notebook && onOpenNotebook ? (
                  <QuickAction icon={BookOpen} label="Notebook" onClick={onOpenNotebook} />
                ) : null}
                <QuickAction icon={Plus} label="Add Task" onClick={() => setShowTaskEditor(true)} />
              </div>
            </section>

            {/* Focus Tip */}
            <section className="glass-panel min-w-0 p-5">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-300/80" />
                <h3 className="text-base font-semibold text-white">Focus Tip</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">{getDailyFocusTip(todayKey)}</p>
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
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof ArrowUpRight;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-2.5 rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-left text-sm text-slate-200 transition-colors hover:border-white/15 hover:bg-white/[0.05] hover:text-white"
    >
      <Icon className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-cyan-200" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-colors group-hover:text-slate-300" />
    </button>
  );
}
