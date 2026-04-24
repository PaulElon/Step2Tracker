import {
  getCategoryBreakdown,
  getGoalAlerts,
  getMomentumPoints,
  getPracticeMetrics,
  getRemediationLinks,
  getStudyBlockMinutes,
  getWeakTopicPlannerInsights,
  sumStudyMinutes,
} from "../lib/analytics";
import { formatHoursValue, formatShortDate, getTodayKey } from "../lib/datetime";
import { getTheme } from "../lib/themes";
import { useAppStore } from "../state/app-store";
import { ConsistencyHeatmap } from "../components/consistency-heatmap";
import { FocusOrbit } from "../components/focus-orbit";
import { MomentumRibbon } from "../components/momentum-ribbon";
import { EmptyState, MetricCard, Panel } from "../components/ui";

export function AnalyticsView() {
  const { state } = useAppStore();
  const theme = getTheme(state.preferences.themeId);
  const totalMinutes = sumStudyMinutes(state.studyBlocks);
  const categoryBreakdown = getCategoryBreakdown(state.studyBlocks).slice(0, 5);
  const momentumPoints = getMomentumPoints(
    state.studyBlocks,
    getTodayKey(),
    10,
    state.preferences.dailyGoalMinutes,
  );
  const practiceMetrics = getPracticeMetrics(state.practiceTests);
  const remediationLinks = getRemediationLinks(state.practiceTests, state.studyBlocks).slice(0, 4);
  const activityByDate = state.studyBlocks.reduce<Record<string, number>>((map, block) => {
    const minutes = getStudyBlockMinutes(block);
    map[block.date] = (map[block.date] ?? 0) + minutes;
    return map;
  }, {});
  const alerts = getGoalAlerts(state.studyBlocks, state.practiceTests, state.preferences.dailyGoalMinutes);
  const weakInsights = getWeakTopicPlannerInsights(
    state.weakTopicEntries,
    state.practiceTests,
    state.studyBlocks,
  ).sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.topic.localeCompare(right.topic));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Planned time"
          value={formatHoursValue(totalMinutes)}
          meta={`${state.studyBlocks.length} blocks in the schedule`}
        />
        <MetricCard
          label="Study categories"
          value={`${categoryBreakdown.length}`}
          meta="Categories with scheduled study time"
        />
        <MetricCard
          label="Weak topics"
          value={`${state.weakTopicEntries.length}`}
          meta={`${state.weakTopicEntries.filter((entry) => entry.status !== "Resolved").length} still active`}
        />
        <MetricCard
          label="Practice average"
          value={practiceMetrics.averageScore == null ? "Awaiting log" : `${practiceMetrics.averageScore.toFixed(1)}%`}
          meta={practiceMetrics.averageScore == null ? "No test average yet" : "From logged tests"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Study mix">
          <FocusOrbit
            slices={categoryBreakdown.map((entry) => ({
              label: entry.category,
              minutes: entry.minutes,
              completedMinutes: entry.completedMinutes,
            }))}
            totalMinutes={totalMinutes}
            activeWeakTopics={state.weakTopicEntries.filter((entry) => entry.status !== "Resolved").length}
            theme={theme}
          />
        </Panel>

        <Panel className="p-0">
          <MomentumRibbon points={momentumPoints} theme={theme} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Panel title="Consistency">
          <ConsistencyHeatmap activityByDate={activityByDate} />
        </Panel>

        <Panel title="Weak topics">
          {weakInsights.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {weakInsights.slice(0, 6).map((entry) => (
                <div key={entry.id} className="panel-subtle">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{entry.topic}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                        {entry.priority} priority · {entry.status}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-white">{entry.occurrenceCount}x</p>
                  </div>
                  <p className="mt-3 text-sm text-slate-300">
                    {entry.linkedBlockCount
                      ? `${entry.linkedBlockCount} future blocks linked${entry.nextTouchDate ? ` · next ${formatShortDate(entry.nextTouchDate)}` : ""}`
                      : "No future block is clearly linked yet"}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">{entry.notes || `Latest from ${entry.sourceLabel}`}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No topic signal yet"
              description="Weak-topic analytics will appear here."
              compact
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Panel title="Coverage gaps">
          {remediationLinks.length ? (
            <div className="space-y-4">
              {remediationLinks.map((link) => (
                <div key={link.testId} className="panel-subtle">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{link.assessment}</p>
                      <p className="mt-1 text-xs text-slate-400">{formatShortDate(link.date)}</p>
                    </div>
                    <p className="text-lg font-semibold text-white">{Math.round(link.coverage * 100)}%</p>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${
                        link.coverage >= 0.75
                          ? "bg-gradient-to-r from-emerald-300 to-cyan-300"
                          : link.coverage >= 0.4
                            ? "bg-gradient-to-r from-amber-300 to-orange-300"
                            : "bg-gradient-to-r from-rose-300 to-orange-300"
                      }`}
                      style={{ width: `${Math.max(link.coverage * 100, 8)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {link.uncoveredTopics.length
                      ? `Missing: ${link.uncoveredTopics.join(", ")}`
                      : "All recent weak topics are mapped to future blocks."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No coverage data"
              description="Log tests with weak topics to see coverage."
              compact
            />
          )}
        </Panel>

        <Panel title="Alerts">
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.title}
                className={`rounded-[20px] border p-4 ${
                  alert.tone === "critical"
                    ? "border-rose-300/25 bg-rose-300/10"
                    : alert.tone === "warning"
                      ? "border-amber-300/25 bg-amber-300/10"
                      : "border-cyan-300/20 bg-cyan-300/10"
                }`}
              >
                <p className="text-sm font-semibold text-white">{alert.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-200">{alert.body}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
