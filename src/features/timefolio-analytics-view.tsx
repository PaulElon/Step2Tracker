import { useMemo } from "react";
import { EmptyState, MetricCard, Panel } from "../components/ui";
import { formatMinutes } from "../lib/datetime";
import { allocationByMethod, totalsByDay } from "../lib/tf-session-adapters";
import { TimeFolioStoreProvider, useTimeFolioStore } from "../state/tf-store";
import type { TfSessionLog } from "../types/models";

type TrendPoint = {
  dateKey: string;
  label: string;
  hours: number;
};

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
});

const BEST_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function buildTrendPoints(dailyTotals: Record<string, number>): TrendPoint[] {
  const today = new Date();
  return Array.from({ length: 14 }, (_, index) => {
    const date = shiftDate(today, index - 13);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      label: DAY_LABEL_FORMATTER.format(date),
      hours: dailyTotals[dateKey] ?? 0,
    };
  });
}

function sumHoursInRange(logs: TfSessionLog[], startKey: string, endKey: string): number {
  return logs.reduce((total, log) => {
    if (log.date < startKey || log.date > endKey) {
      return total;
    }
    return total + log.hours;
  }, 0);
}

function buildNarrative(params: {
  totalHours: number;
  sessionCount: number;
  topMethod: string | null;
  focusRate: number;
  last7DaysHours: number;
  last30DaysHours: number;
}) {
  const { totalHours, sessionCount, topMethod, focusRate, last7DaysHours, last30DaysHours } = params;

  if (sessionCount === 0) {
    return "No sessions logged yet. Analytics will populate once study time is recorded.";
  }

  const totalHoursText = formatMinutes(Math.round(totalHours * 60));
  const last7DaysText = formatMinutes(Math.round(last7DaysHours * 60));
  const last30DaysText = formatMinutes(Math.round(last30DaysHours * 60));

  let narrative = `You have logged ${totalHoursText} across ${sessionCount} session${sessionCount === 1 ? "" : "s"}.`;

  if (topMethod) {
    narrative += ` ${topMethod} is your leading method so far.`;
  }

  if (last7DaysHours === last30DaysHours) {
    narrative += ` ${last7DaysText} logged in the last 7 days.`;
  } else {
    narrative += ` ${last7DaysText} in the last 7 days, ${last30DaysText} in the last 30 days.`;
  }

  if (focusRate >= 90) {
    narrative += ` Focus quality is excellent at ${focusRate.toFixed(0)}% distraction-free time.`;
  } else if (focusRate >= 70) {
    narrative += ` Focus quality is solid at ${focusRate.toFixed(0)}% distraction-free time.`;
  } else {
    narrative += ` Focus quality is ${focusRate.toFixed(0)}%, so distraction cleanup is the clearest next lever.`;
  }

  return narrative;
}

function TrendBar({
  hours,
  isLatest,
  label,
  maxHours,
}: {
  hours: number;
  isLatest: boolean;
  label: string;
  maxHours: number;
}) {
  const height = maxHours > 0 ? Math.max((hours / maxHours) * 100, hours > 0 ? 10 : 2) : 2;

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="flex h-40 w-full items-end rounded-[18px] border border-white/10 bg-slate-950/45 px-1.5 py-1.5">
        <div
          className={`relative w-full overflow-hidden rounded-[14px] ${isLatest ? "bg-cyan-400/20" : "bg-slate-700/40"}`}
          style={{ height: `${height}%` }}
          title={`${label}: ${formatMinutes(Math.round(hours * 60))}`}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-400 via-sky-400 to-indigo-400 opacity-90" />
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-white/10" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">{label}</div>
        <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">{formatMinutes(Math.round(hours * 60))}</div>
      </div>
    </div>
  );
}

function MethodRow({
  hours,
  method,
  percent,
  sessionCount,
}: {
  hours: number;
  method: string;
  percent: number;
  sessionCount: number;
}) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">{method}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {sessionCount} session{sessionCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-slate-100">{formatMinutes(Math.round(hours * 60))}</div>
          <div className="text-xs tabular-nums text-slate-400">{percent.toFixed(0)}%</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-400"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function TimeFolioAnalyticsContent() {
  const { error, isLoading, state } = useTimeFolioStore();
  const sessions = state.sessionLogs;

  const analytics = useMemo(() => {
    const today = new Date();
    const todayKey = toDateKey(today);
    const last7StartKey = toDateKey(shiftDate(today, -6));
    const last30StartKey = toDateKey(shiftDate(today, -29));
    const dailyTotals = totalsByDay(sessions);
    const methodRows = allocationByMethod(sessions);
    const trend = buildTrendPoints(dailyTotals);

    let totalHours = 0;
    let distractionHours = 0;

    for (const session of sessions) {
      totalHours += session.hours;
      if (session.isDistraction) {
        distractionHours += session.hours;
      }
    }

    const activeDays = Object.keys(dailyTotals).length;
    const focusHours = totalHours - distractionHours;
    const focusRate = totalHours > 0 ? (focusHours / totalHours) * 100 : 0;
    const last7DaysHours = sumHoursInRange(sessions, last7StartKey, todayKey);
    const last30DaysHours = sumHoursInRange(sessions, last30StartKey, todayKey);
    const bestDayEntry = Object.entries(dailyTotals).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return right[0].localeCompare(left[0]);
    })[0] ?? null;

    return {
      activeDays,
      bestDayEntry,
      distractionHours,
      focusRate,
      last30DaysHours,
      last7DaysHours,
      methodRows,
      narrative: buildNarrative({
        focusRate,
        last7DaysHours,
        last30DaysHours,
        sessionCount: sessions.length,
        topMethod: methodRows[0]?.method ?? null,
        totalHours,
      }),
      totalHours,
      trend,
    };
  }, [sessions]);

  if (isLoading) {
    return (
      <Panel title="Analytics" subtitle="Preparing your study time dashboard.">
        <div className="rounded-[18px] border border-white/10 bg-slate-950/35 px-4 py-5 text-sm text-slate-400">
          Loading TimeFolio analytics...
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Analytics" subtitle="Preparing your study time dashboard.">
        <div className="rounded-[18px] border border-rose-500/25 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
          Error loading analytics: {error}
        </div>
      </Panel>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Analytics</h2>
          <p className="text-sm text-slate-400">
            Combined study-time insights across method mix, focus quality, and recent activity.
          </p>
        </div>
        <EmptyState
          title="No study time analytics yet"
          description="Log your first session in Session Log to unlock allocation, summary, and trend views."
        />
      </div>
    );
  }

  const topMethods = analytics.methodRows.slice(0, 5);
  const trendPeakHours = analytics.trend.reduce((max, point) => Math.max(max, point.hours), 0);
  const bestDayLabel = analytics.bestDayEntry
    ? BEST_DAY_FORMATTER.format(new Date(`${analytics.bestDayEntry[0]}T12:00:00`))
    : "No sessions yet";
  const focusHours = analytics.totalHours - analytics.distractionHours;

  return (
    <div className="space-y-4 pb-2">
      <div className="space-y-1">
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Analytics</h2>
        <p className="text-sm text-slate-400">
          Combined study-time insights across method mix, focus quality, and recent activity.
        </p>
      </div>

      <Panel
        title="Study Time Dashboard"
        subtitle="A unified read on workload, focus quality, and how your methods are actually being used."
        action={
          <div className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-400">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </div>
        }
      >
        <p className="max-w-4xl text-sm leading-7 text-slate-300">{analytics.narrative}</p>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Time" value={formatMinutes(Math.round(analytics.totalHours * 60))} meta="Across all recorded study sessions." />
        <MetricCard label="Sessions" value={String(sessions.length)} meta={`${analytics.activeDays} active day${analytics.activeDays === 1 ? "" : "s"} captured.`} />
        <MetricCard label="Top Method" value={analytics.methodRows[0]?.method ?? "—"} meta={analytics.methodRows[0] ? `${formatMinutes(Math.round(analytics.methodRows[0].hours * 60))} logged` : "Waiting for session data."} />
        <MetricCard label="Focus Rate" value={`${analytics.focusRate.toFixed(0)}%`} meta={analytics.totalHours < 1 ? `Based on ${formatMinutes(Math.round(analytics.totalHours * 60))} total — log more for a reliable rate.` : `${formatMinutes(Math.round(analytics.distractionHours * 60))} marked as distraction.`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
        <Panel title="Activity Trend" subtitle="Last 14 days of recorded study time.">
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Last 7 Days</div>
                <div className="mt-2 text-2xl font-semibold text-white">{formatMinutes(Math.round(analytics.last7DaysHours * 60))}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Last 30 Days</div>
                <div className="mt-2 text-2xl font-semibold text-white">{formatMinutes(Math.round(analytics.last30DaysHours * 60))}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Best Day</div>
                <div className="mt-2 text-2xl font-semibold text-white">{bestDayLabel}</div>
              </div>
            </div>

            {trendPeakHours === 0 ? (
              <div className="flex h-32 items-center justify-center rounded-[18px] border border-white/10 bg-slate-950/35 text-sm text-slate-500">
                Log more sessions to see a trend.
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {analytics.trend.map((point, index) => (
                  <TrendBar
                    key={point.dateKey}
                    hours={point.hours}
                    isLatest={index === analytics.trend.length - 1}
                    label={point.label}
                    maxHours={trendPeakHours}
                  />
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Summary" subtitle="A quick narrative plus the biggest operating signals.">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Focus Time</div>
                <div className="mt-2 text-lg font-semibold text-white">{formatMinutes(Math.round(focusHours * 60))}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Method Count</div>
                <div className="mt-2 text-lg font-semibold text-white">{analytics.methodRows.length}</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Panel title="Allocation" subtitle="Study time grouped by method and session count.">
          <div className="space-y-3">
            {analytics.methodRows.map((row) => {
              const percent = analytics.totalHours > 0 ? (row.hours / analytics.totalHours) * 100 : 0;
              return (
                <MethodRow
                  key={row.methodKey}
                  hours={row.hours}
                  method={row.method}
                  percent={percent}
                  sessionCount={row.sessionCount}
                />
              );
            })}
          </div>
        </Panel>

        <Panel title="Top Methods" subtitle="Highest-share study methods right now.">
          <div className="space-y-3">
            {topMethods.map((row, index) => {
              const percent = analytics.totalHours > 0 ? (row.hours / analytics.totalHours) * 100 : 0;
              return (
                <div key={row.methodKey} className="rounded-[18px] border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">#{index + 1}</div>
                      <div className="mt-1 truncate text-sm font-medium text-slate-100">{row.method}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-white">{percent.toFixed(0)}%</div>
                      <div className="text-xs text-slate-400">{formatMinutes(Math.round(row.hours * 60))}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function TimeFolioAnalyticsView() {
  return (
    <TimeFolioStoreProvider>
      <TimeFolioAnalyticsContent />
    </TimeFolioStoreProvider>
  );
}
