import { Activity, Clock3, Flame, ListTodo } from "lucide-react";
import { useState } from "react";
import { getGoalAlerts, getPracticeMetrics, getStudyBlockMinutes, getTodayBlocks } from "../lib/analytics";
import { formatHoursValue, formatLongDate, formatMinutes, getTodayKey } from "../lib/datetime";
import { secondaryButtonClassName } from "../lib/ui";
import { useAppStore } from "../state/app-store";
import { StudyTaskCard } from "../components/study-task-card";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { EmptyState, MetricCard, Panel } from "../components/ui";

export function DashboardView() {
  const { state, upsertStudyBlock, setActiveSection } = useAppStore();
  const [showTaskEditor, setShowTaskEditor] = useState(false);
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today"
          value={todayTasks.length ? formatHoursValue(plannedMinutes) : "Clear"}
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Panel
          title="Today"
          subtitle={todayTasks.length ? formatLongDate(todayKey) : undefined}
          action={
            <button type="button" className={secondaryButtonClassName} onClick={() => setShowTaskEditor(true)}>
              Add task
            </button>
          }
        >
          {todayTasks.length ? (
            <div className="space-y-3">
              {todayTasks.map((task) => (
                <StudyTaskCard
                  key={task.id}
                  block={task}
                  onToggleComplete={(completed) => {
                    void upsertStudyBlock({
                      ...task,
                      completed,
                    });
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

        <div className="space-y-4">
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
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => {
                    void setActiveSection("settings");
                  }}
                >
                  Goal
                </button>
              </div>
            </div>
          </Panel>

          <Panel title="Attention">
            {alerts.length ? (
              <div className="space-y-3">
                {alerts.map((alert) => (
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
                    <p className="mt-2 text-sm text-slate-200">{alert.body}</p>
                  </div>
                ))}
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
