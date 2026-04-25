import { Activity, Clock3, Flame, ListTodo, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  getGoalAlerts,
  getPracticeMetrics,
  getRemediationLinks,
  getStudyBlockMinutes,
  getTodayBlocks,
} from "../lib/analytics";
import { formatLongDate, formatMinutes, getTodayKey } from "../lib/datetime";
import { primaryButtonClassName, secondaryButtonClassName } from "../lib/ui";
import { useAppStore } from "../state/app-store";
import type { ExamTimer } from "../types/models";
import { StudyTaskCard } from "../components/study-task-card";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { EmptyState, MetricCard, Panel } from "../components/ui";

type ExamDisplayMode = "days" | "weeks+days" | "months+weeks+days";

function getCountdown(examDate: string, mode: ExamDisplayMode): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(examDate + "T00:00:00");
  const diffMs = target.getTime() - today.getTime();
  if (diffMs <= 0) return "";
  const totalDays = Math.ceil(diffMs / 86_400_000);
  if (mode === "days") return `${totalDays}d`;
  if (mode === "weeks+days") {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    return `${weeks}w ${days}d`;
  }
  const months = Math.floor(totalDays / 30);
  const rem = totalDays - months * 30;
  const weeks = Math.floor(rem / 7);
  const days = rem % 7;
  return `${months}mo ${weeks}w ${days}d`;
}

function isExamPassed(examDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(examDate + "T00:00:00") < today;
}

export function DashboardView() {
  const { state, upsertStudyBlock, setDailyGoalMinutes, setExamTimers } = useAppStore();
  const [showTaskEditor, setShowTaskEditor] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInputValue, setGoalInputValue] = useState("");
  const [timerDisplayModes, setTimerDisplayModes] = useState<Record<string, ExamDisplayMode>>({});
  const [showAddTimer, setShowAddTimer] = useState(false);
  const [newTimerLabel, setNewTimerLabel] = useState("");
  const [newTimerDate, setNewTimerDate] = useState("");

  const todayKey = getTodayKey();
  const todayTasks = getTodayBlocks(state.studyBlocks, todayKey);
  const plannedMinutes = todayTasks.reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const completedMinutes = todayTasks
    .filter((task) => task.completed)
    .reduce((total, task) => total + getStudyBlockMinutes(task), 0);
  const todayGoalMinutes = state.preferences.dailyGoalMinutes;
  const dailyGoalProgress = todayGoalMinutes ? Math.min((completedMinutes / todayGoalMinutes) * 100, 100) : 0;
  const alerts = getGoalAlerts(state.studyBlocks, state.practiceTests, todayGoalMinutes).slice(0, 4);
  const activeWeakTopics = state.weakTopicEntries.filter((entry) => entry.status !== "Resolved");
  const nextOpenTaskId = todayTasks.find((task) => !task.completed)?.id ?? "";
  const openCount = todayTasks.filter((task) => !task.completed).length;
  const practiceMetrics = getPracticeMetrics(state.practiceTests);
  const remediationLinks = getRemediationLinks(state.practiceTests, state.studyBlocks);
  const uncoveredTopicNames = [...new Set(remediationLinks.flatMap((l) => l.uncoveredTopics))];
  const examTimers = state.preferences.examTimers;

  function getTimerMode(id: string): ExamDisplayMode {
    return timerDisplayModes[id] ?? "days";
  }

  function setTimerMode(id: string, mode: ExamDisplayMode) {
    setTimerDisplayModes((prev) => ({ ...prev, [id]: mode }));
  }

  function handleAddTimer() {
    if (!newTimerLabel.trim() || !newTimerDate) return;
    const newTimer: ExamTimer = {
      id: crypto.randomUUID(),
      label: newTimerLabel.trim(),
      examDate: newTimerDate,
    };
    void setExamTimers([...examTimers, newTimer]);
    setNewTimerLabel("");
    setNewTimerDate("");
    setShowAddTimer(false);
  }

  function handleDeleteTimer(id: string) {
    void setExamTimers(examTimers.filter((t) => t.id !== id));
  }

  const goalHours = Math.round(todayGoalMinutes / 60);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today"
          value={todayTasks.length ? `${Math.round(plannedMinutes / 60 * 10) / 10}h` : "Clear"}
          meta={todayTasks.length ? `${todayTasks.length} tasks planned` : "No tasks yet"}
          icon={Clock3}
          accentClassName="border-cyan-300/20 bg-cyan-300/10"
        />
        <MetricCard
          label="Done"
          value={`${Math.round(dailyGoalProgress)}%`}
          meta={`${formatMinutes(completedMinutes)} of ${formatMinutes(todayGoalMinutes)}`}
          icon={Activity}
          accentClassName="border-emerald-300/20 bg-emerald-300/10"
        />
        <MetricCard
          label="Open"
          value={`${openCount}`}
          meta={openCount ? "Still on deck" : "Day complete"}
          icon={ListTodo}
          accentClassName="border-blue-300/20 bg-blue-300/10"
        />
        <MetricCard
          label="Weak Topics"
          value={`${activeWeakTopics.length}`}
          meta={
            practiceMetrics.averageScore == null
              ? "No test baseline"
              : `Practice avg ${practiceMetrics.averageScore.toFixed(1)}%`
          }
          icon={Flame}
          accentClassName="border-amber-300/20 bg-amber-300/10"
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Panel
          className="flex min-h-0 flex-col"
          title="Today"
          subtitle={todayTasks.length ? formatLongDate(todayKey) : undefined}
          action={
            <button type="button" className={secondaryButtonClassName} onClick={() => setShowTaskEditor(true)}>
              Add task
            </button>
          }
        >
          {todayTasks.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
              <div className="space-y-3">
                {todayTasks.map((task) => (
                  <StudyTaskCard
                    key={task.id}
                    block={task}
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
            </div>
          ) : (
            <EmptyState
              title="No tasks today"
              description="Today is clear."
              action={
                <button type="button" className={secondaryButtonClassName} onClick={() => setShowTaskEditor(true)}>
                  Add task
                </button>
              }
            />
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto scrollbar-subtle">
          {/* Progress */}
          <Panel title="Progress">
            <div className="panel-subtle p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Target</p>
                  <p className="mt-2 text-3xl font-semibold text-white">{Math.round(dailyGoalProgress)}%</p>
                </div>
                <p className="text-sm text-slate-300">{formatMinutes(completedMinutes)} done</p>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300"
                  style={{ width: `${Math.max(dailyGoalProgress, todayTasks.length ? 8 : 0)}%` }}
                />
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-300">
                <span>{openCount} open</span>
                {editingGoal ? (
                  <input
                    type="number"
                    autoFocus
                    min="0.5"
                    max="24"
                    step="0.5"
                    className="w-20 rounded-[14px] border border-white/20 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
                    value={goalInputValue}
                    onChange={(e) => setGoalInputValue(e.target.value)}
                    onBlur={() => {
                      const hours = parseFloat(goalInputValue);
                      if (!isNaN(hours) && hours > 0) {
                        void setDailyGoalMinutes(hours * 60);
                      }
                      setEditingGoal(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingGoal(false);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={secondaryButtonClassName}
                    onClick={() => {
                      setGoalInputValue(String(goalHours));
                      setEditingGoal(true);
                    }}
                  >
                    {goalHours}h goal
                  </button>
                )}
              </div>
            </div>
          </Panel>

          {/* Exam timers */}
          <Panel title="Exams">
            <div className="space-y-3">
              {examTimers.map((timer) => {
                const mode = getTimerMode(timer.id);
                const passed = isExamPassed(timer.examDate);
                const countdown = passed ? null : getCountdown(timer.examDate, mode);
                return (
                  <div key={timer.id} className="panel-subtle p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs text-slate-400">{timer.label}</p>
                      <button
                        type="button"
                        onClick={() => handleDeleteTimer(timer.id)}
                        className="shrink-0 text-slate-500 transition-colors hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {passed ? (
                      <p className="mt-2 text-sm text-slate-500">Exam passed</p>
                    ) : (
                      <>
                        <p className="mt-1 text-3xl font-bold text-white">{countdown}</p>
                        <div className="mt-3 flex gap-1.5">
                          {(["days", "weeks+days", "months+weeks+days"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setTimerMode(timer.id, m)}
                              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                mode === m
                                  ? "border-cyan-300/30 bg-cyan-300/20 text-cyan-200"
                                  : "border-transparent text-slate-500 hover:text-slate-300"
                              }`}
                            >
                              {m === "days" ? "d" : m === "weeks+days" ? "w+d" : "mo+w+d"}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {examTimers.length === 0 && !showAddTimer ? (
                <p className="text-sm text-slate-500">No exams tracked yet.</p>
              ) : null}

              {showAddTimer ? (
                <div className="space-y-3 rounded-[18px] border border-white/10 bg-slate-950/45 p-4">
                  <input
                    type="text"
                    placeholder="Exam name"
                    autoFocus
                    className="field bg-slate-950"
                    value={newTimerLabel}
                    onChange={(e) => setNewTimerLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddTimer();
                      if (e.key === "Escape") {
                        setShowAddTimer(false);
                        setNewTimerLabel("");
                        setNewTimerDate("");
                      }
                    }}
                  />
                  <input
                    type="date"
                    className="field bg-slate-950"
                    value={newTimerDate}
                    onChange={(e) => setNewTimerDate(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={primaryButtonClassName}
                      onClick={handleAddTimer}
                      disabled={!newTimerLabel.trim() || !newTimerDate}
                    >
                      Add
                    </button>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => {
                        setShowAddTimer(false);
                        setNewTimerLabel("");
                        setNewTimerDate("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : examTimers.length < 5 ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-[18px] border border-dashed border-white/10 p-3 text-sm text-slate-500 transition-colors hover:border-white/20 hover:text-slate-400"
                  onClick={() => setShowAddTimer(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add exam
                </button>
              ) : null}
            </div>
          </Panel>

          {/* Attention */}
          <Panel title="Attention">
            {alerts.length ? (
              <div className="space-y-3">
                {alerts.map((alert) => {
                  const isWeakTopicAlert = alert.title === "Weak topics are not scheduled";
                  return (
                    <div
                      key={alert.title}
                      className={`rounded-[18px] border p-4 ${
                        alert.tone === "critical"
                          ? "border-rose-300/25 bg-rose-300/10"
                          : alert.tone === "warning"
                            ? "border-amber-300/25 bg-amber-300/10"
                            : "border-cyan-300/20 bg-cyan-300/10"
                      }`}
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
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${pillClass}`}
                              >
                                {topic}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-200">{alert.body}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Quiet board" description="No plan changes flagged right now." compact />
            )}
          </Panel>
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
