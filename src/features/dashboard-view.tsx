import { Activity, Clock3, Flame, ListTodo } from "lucide-react";
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
import { secondaryButtonClassName } from "../lib/ui";
import { useAppStore } from "../state/app-store";
import { StudyTaskCard } from "../components/study-task-card";
import { StudyTaskEditorSheet } from "../components/study-task-editor";
import { EmptyState, MetricCard, Panel } from "../components/ui";
import { RichTextEditor, RichTextRender, richTextToPlain } from "../components/rich-text-editor";

export function DashboardView({ onOpenNotebook }: { onOpenNotebook?: () => void }) {
  const { state, upsertStudyBlock, setDailyGoalMinutes, setNotesHtml } = useAppStore();
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
  const alerts = getGoalAlerts(state.studyBlocks, state.practiceTests, todayGoalMinutes).slice(0, 4);
  const activeWeakTopics = state.weakTopicEntries.filter((entry) => entry.status !== "Resolved");
  const nextOpenTaskId = todayTasks.find((task) => !task.completed)?.id ?? "";
  const openCount = todayTasks.filter((task) => !task.completed).length;
  const practiceMetrics = getPracticeMetrics(state.practiceTests);
  const remediationLinks = getRemediationLinks(state.practiceTests, state.studyBlocks);
  const uncoveredTopicNames = [...new Set(remediationLinks.flatMap((l) => l.uncoveredTopics))];
  const hasNotesPreview = !!richTextToPlain(state.preferences.notesHtml).trim();

  const commitGoalMinutes = () => {
    const parsedMinutes = Number(goalInputValue);
    if (Number.isInteger(parsedMinutes) && parsedMinutes >= 1 && parsedMinutes <= 1440) {
      void setDailyGoalMinutes(parsedMinutes);
    }

    setEditingGoal(false);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="grid shrink-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today"
          value={todayTasks.length ? formatMinutes(plannedMinutes) : "Clear"}
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

        <div className="flex min-h-0 flex-col gap-4">
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Minutes</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      min="1"
                      max="1440"
                      step="1"
                      className="w-20 rounded-[14px] border border-white/20 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
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
                    className={secondaryButtonClassName}
                    onClick={() => {
                      setGoalInputValue(String(todayGoalMinutes));
                      setEditingGoal(true);
                    }}
                  >
                    {`${formatMinutes(todayGoalMinutes)} goal`}
                  </button>
                )}
              </div>
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

          {FF.notebook ? (
            <Panel title="Notes" className="flex flex-col">
              <div className="panel-subtle flex flex-col gap-3 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Notebook is now primary</p>
                <p className="text-sm text-slate-300">
                  Use Notebook for multi-page notes and editing. Dashboard keeps a quick preview of legacy notes.
                </p>
                <div className="max-h-40 overflow-y-auto rounded-[18px] border border-white/10 bg-slate-950/45 p-3">
                  {hasNotesPreview ? (
                    <div className="rich-text-render text-sm text-slate-200 [&_p]:my-0 [&_li]:my-0.5 [&_ul]:my-1 [&_ol]:my-1">
                      <RichTextRender html={state.preferences.notesHtml} />
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No legacy dashboard notes yet. Open Notebook to start writing.</p>
                  )}
                </div>
                {onOpenNotebook ? (
                  <button type="button" className={secondaryButtonClassName} onClick={onOpenNotebook}>
                    Open Notebook
                  </button>
                ) : null}
              </div>
            </Panel>
          ) : (
            <Panel title="Notes" className="flex flex-col flex-1 min-h-0">
              <RichTextEditor
                value={state.preferences.notesHtml}
                onChange={(html) => {
                  void setNotesHtml(html);
                }}
                placeholder="Type freely. Cmd+B/I/U for bold/italic/underline. * → bullet, - → dashed, 1. → numbered."
                className="flex-1 min-h-0 overflow-y-auto scrollbar-subtle"
              />
            </Panel>
          )}
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
