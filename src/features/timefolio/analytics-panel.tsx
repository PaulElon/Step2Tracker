import { useMemo, useState } from "react";
import { allocationByMethod, totalsByDay } from "../../lib/tf-session-adapters";
import { formatMinutes, getTodayKey, parseDateKey } from "../../lib/datetime";
import { useTimeFolioStore } from "../../state/tf-store";
import {
  buildUrgeAnalytics,
  URGE_TRIGGER_LABELS,
  type UrgeWindow,
} from "../../lib/urge-analytics";
import type { TfSessionLog, UrgeLog } from "../../types/models";

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

function fromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDurationHours(hours: number): string {
  return formatMinutes(Math.round(hours * 60));
}

function buildTrendPoints(dailyTotals: Record<string, number>): TrendPoint[] {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(today, index - 6);
    const dateKey = toDateKey(date);
    return {
      dateKey,
      label: DAY_LABEL_FORMATTER.format(date),
      hours: dailyTotals[dateKey] ?? 0,
    };
  });
}

function sumHoursInRange(logs: TfSessionLog[], startKey: string, endKey: string): number {
  let total = 0;
  for (const log of logs) {
    if (log.date >= startKey && log.date <= endKey) {
      total += log.hours;
    }
  }
  return total;
}

function MetricCard({
  label,
  value,
  sub,
  accentClass,
}: {
  label: string;
  value: string;
  sub?: string;
  accentClass: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)]">
      <div className={`mb-3 h-1.5 w-12 rounded-full ${accentClass}`} />
      <span className="text-[11px] font-semibold text-slate-500">
        {label}
      </span>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function TrendBar({
  label,
  hours,
  maxHours,
  isLatest,
}: {
  label: string;
  hours: number;
  maxHours: number;
  isLatest: boolean;
}) {
  const height = maxHours > 0 ? Math.max((hours / maxHours) * 100, hours > 0 ? 8 : 2) : 2;

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="flex h-36 w-full items-end rounded-xl border border-slate-800/80 bg-slate-950/40 px-1.5 py-1">
        <div
          className={`relative w-full overflow-hidden rounded-lg ${isLatest ? "bg-indigo-500/25" : "bg-slate-700/40"}`}
          style={{ height: `${height}%` }}
          title={`${label}: ${formatDurationHours(hours)}`}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-400 via-sky-400 to-indigo-500 opacity-90" />
          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-white/10" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-[11px] font-medium text-slate-500">
          {label}
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-slate-500">
          {formatDurationHours(hours)}
        </div>
      </div>
    </div>
  );
}

function MethodRow({
  method,
  hours,
  sessionCount,
  percent,
}: {
  method: string;
  hours: number;
  sessionCount: number;
  percent: number;
}) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-200">{method}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {sessionCount} session{sessionCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-slate-100">
            {formatDurationHours(hours)}
          </div>
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

const URGE_WINDOW_OPTIONS: Array<{ value: UrgeWindow; label: string }> = [
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
  { value: "all", label: "All time" },
];

const URGE_TREND_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

function UrgeStatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/35 p-4">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      <div className="mt-2 text-xl font-semibold tabular-nums text-slate-100">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function UrgeBar({
  label,
  count,
  maxCount,
  averageIntensity,
  isPeak,
}: {
  label: string;
  count: number;
  maxCount: number;
  averageIntensity: number;
  isPeak: boolean;
}) {
  const height = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 10 : 2) : 2;
  const title =
    count > 0 ? `${label}: ${count} urge${count === 1 ? "" : "s"}, avg ${averageIntensity.toFixed(1)}/5` : `${label}: no urges`;

  return (
    <div className="flex flex-1 flex-col items-center gap-1.5">
      <div className="flex h-28 w-full items-end rounded-lg border border-slate-800/80 bg-slate-950/40 px-1 py-1">
        <div
          className={`relative w-full overflow-hidden rounded-md ${isPeak ? "bg-rose-500/25" : "bg-slate-700/40"}`}
          style={{ height: `${height}%` }}
          title={title}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-cyan-400 via-sky-400 to-indigo-500 opacity-90" />
        </div>
      </div>
      <div className="text-[10px] tabular-nums text-slate-500">{count}</div>
    </div>
  );
}

function UrgeAnalyticsSection({ urgeLogs }: { urgeLogs: UrgeLog[] }) {
  const [window, setWindow] = useState<UrgeWindow>(14);
  const todayKey = getTodayKey();
  const analytics = useMemo(
    () => buildUrgeAnalytics(urgeLogs, window, todayKey),
    [urgeLogs, window, todayKey],
  );

  const windowLabel = window === "all" ? "all-time" : `last ${window} days`;
  const trendPeak = analytics.dailyTrend.reduce((max, point) => Math.max(max, point.count), 0);
  const visibleTriggers = analytics.triggerBreakdown.slice(0, 4);
  const hiddenTriggerCount = analytics.triggerBreakdown.length - visibleTriggers.length;
  const intensityMax = analytics.intensityDistribution.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const timeMax = analytics.timeBuckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);

  return (
    <section className="relative rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-300">Urge Analytics</h3>
          <p className="mt-1 text-sm text-slate-500">
            Awareness patterns derived from urges logged during focus sessions ({windowLabel}).
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-slate-700/80 bg-slate-950/60 p-0.5">
          {URGE_WINDOW_OPTIONS.map((option) => {
            const isActive = option.value === window;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setWindow(option.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  isActive
                    ? "bg-gradient-to-r from-cyan-500/30 to-indigo-500/30 text-slate-100"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {analytics.totalCount === 0 ? (
        <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-slate-700/60 bg-slate-950/35 px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-300">No urges logged in this period.</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
            Use Log urge during a focus session to start building awareness.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <UrgeStatCard label="Total Urges" value={String(analytics.totalCount)} sub={windowLabel} />
            <UrgeStatCard
              label="Avg Intensity"
              value={`${analytics.averageIntensity.toFixed(1)}/5`}
              sub={`Peak ${analytics.highestIntensity}/5`}
            />
            <UrgeStatCard
              label="Top Trigger"
              value={analytics.topTrigger ? URGE_TRIGGER_LABELS[analytics.topTrigger] : "—"}
              sub={
                analytics.triggerBreakdown[0]
                  ? `${analytics.triggerBreakdown[0].count} time${analytics.triggerBreakdown[0].count === 1 ? "" : "s"}`
                  : undefined
              }
            />
            <UrgeStatCard
              label="Urges / Day"
              value={analytics.urgesPerDay.toFixed(1)}
              sub={`over ${analytics.windowDays} day${analytics.windowDays === 1 ? "" : "s"}`}
            />
            <UrgeStatCard
              label="High-Risk Time"
              value={analytics.topTimeBucket ? analytics.topTimeBucket.label : "—"}
              sub={
                analytics.topTimeBucket
                  ? `${analytics.topTimeBucket.count} urge${analytics.topTimeBucket.count === 1 ? "" : "s"}`
                  : undefined
              }
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-5">
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-4 xl:col-span-3">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-semibold text-slate-400">14-Day Urge Trend</h4>
                <span className="text-xs tabular-nums text-slate-500">Peak {trendPeak}</span>
              </div>
              {trendPeak === 0 ? (
                <div className="mt-4 flex h-24 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-950/35 text-xs text-slate-500">
                  No urges in the last 14 days.
                </div>
              ) : (
                <div className="mt-4 flex items-end gap-1.5">
                  {analytics.dailyTrend.map((point) => (
                    <UrgeBar
                      key={point.dateKey}
                      label={URGE_TREND_DAY_FORMATTER.format(parseDateKey(point.dateKey))}
                      count={point.count}
                      maxCount={trendPeak}
                      averageIntensity={point.averageIntensity}
                      isPeak={point.count === trendPeak && trendPeak > 0}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-4 xl:col-span-2">
              <h4 className="text-sm font-semibold text-slate-400">Trigger Breakdown</h4>
              <div className="mt-3 flex flex-col gap-2.5">
                {visibleTriggers.map((entry) => (
                  <div key={entry.trigger}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm text-slate-200">{entry.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-slate-400">
                        {entry.count} · {entry.sharePercent.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-400"
                        style={{ width: `${Math.max(entry.sharePercent, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {hiddenTriggerCount > 0 ? (
                <p className="mt-3 text-xs text-slate-500">+ {hiddenTriggerCount} more trigger{hiddenTriggerCount === 1 ? "" : "s"}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-400">Intensity</h4>
                <span className="text-xs tabular-nums text-slate-500">
                  {analytics.intensityDistribution[3].count + analytics.intensityDistribution[4].count} high (4–5)
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {analytics.intensityDistribution.map((bucket) => (
                  <div key={bucket.intensity} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-xs tabular-nums text-slate-500">{bucket.intensity}/5</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${
                          bucket.intensity >= 4
                            ? "bg-gradient-to-r from-rose-500 to-orange-400"
                            : "bg-gradient-to-r from-indigo-500 to-sky-400"
                        }`}
                        style={{ width: `${intensityMax > 0 ? Math.max((bucket.count / intensityMax) * 100, bucket.count > 0 ? 6 : 0) : 0}%` }}
                      />
                    </div>
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-4">
              <h4 className="text-sm font-semibold text-slate-400">Time of Day</h4>
              <div className="mt-3 flex flex-col gap-2">
                {analytics.timeBuckets.map((bucket) => (
                  <div key={bucket.bucket} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-xs text-slate-400">{bucket.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500"
                        style={{ width: `${timeMax > 0 ? Math.max((bucket.count / timeMax) * 100, bucket.count > 0 ? 6 : 0) : 0}%` }}
                      />
                    </div>
                    <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex max-h-64 flex-col rounded-xl border border-slate-700/60 bg-slate-950/35 p-4">
              <h4 className="shrink-0 text-sm font-semibold text-slate-400">Recent Examples</h4>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {analytics.examples.map((entry) => {
                  const note = entry.note?.trim();
                  return (
                    <div key={entry.id} className="rounded-lg border border-slate-800/70 bg-slate-900/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-slate-500">
                            {entry.dateKey ? URGE_TREND_DAY_FORMATTER.format(parseDateKey(entry.dateKey)) : "—"}
                          </span>
                          <span className="truncate text-xs text-slate-300">{URGE_TRIGGER_LABELS[entry.trigger]}</span>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{entry.intensity}/5</span>
                      </div>
                      {note ? <p className="mt-1 truncate text-[11px] leading-4 text-slate-500">{note}</p> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function AnalyticsPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
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
    const focusPercent = totalHours > 0 ? (focusHours / totalHours) * 100 : 0;
    const last7DaysHours = sumHoursInRange(sessions, last7StartKey, todayKey);
    const last30DaysHours = sumHoursInRange(sessions, last30StartKey, todayKey);
    const bestDayEntry = Object.entries(dailyTotals).sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return b[0].localeCompare(a[0]);
    })[0] ?? null;

    return {
      activeDays,
      bestDayEntry,
      distractionHours,
      focusPercent,
      last30DaysHours,
      last7DaysHours,
      methodRows,
      totalHours,
      trend,
    };
  }, [sessions]);

  if (isLoading) {
    return (
      <div className="p-8 text-slate-400">
        Loading TimeFolio analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          Error loading analytics: {error}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-8">
        <div className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-6 text-slate-400 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)]">
          No TimeFolio session logs yet. Analytics will appear once sessions are recorded.
        </div>
      </div>
    );
  }

  const visibleMethods = analytics.methodRows.slice(0, 5);
  const topMethodTotal = analytics.totalHours > 0 ? analytics.methodRows[0]?.hours ?? 0 : 0;
  const trendPeakHours = analytics.trend.reduce((max, point) => Math.max(max, point.hours), 0);

  return (
    <div className="relative flex flex-col gap-6 p-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_70%)]" />

      <div className="relative flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Analytics</h2>
          <p className="text-sm text-slate-500">
            Read-only metrics derived from existing TimeFolio session logs.
          </p>
        </div>
        <div className="rounded-full border border-slate-700/80 bg-slate-950/60 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-slate-400">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="relative grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Last 7 Days"
          value={formatDurationHours(analytics.last7DaysHours)}
          sub="Total hours"
          accentClass="bg-gradient-to-r from-cyan-400 to-sky-500"
        />
        <MetricCard
          label="Last 30 Days"
          value={formatDurationHours(analytics.last30DaysHours)}
          sub="Total hours"
          accentClass="bg-gradient-to-r from-sky-400 to-indigo-500"
        />
        <MetricCard
          label="Active Day Avg"
          value={formatDurationHours(analytics.activeDays > 0 ? analytics.totalHours / analytics.activeDays : 0)}
          sub={`${analytics.activeDays} active day${analytics.activeDays === 1 ? "" : "s"}`}
          accentClass="bg-gradient-to-r from-indigo-400 to-violet-500"
        />
        <MetricCard
          label="Focus / Distraction"
          value={`${analytics.focusPercent.toFixed(0)}%`}
          sub={`${formatDurationHours(analytics.distractionHours)} distraction`}
          accentClass="bg-gradient-to-r from-emerald-400 to-teal-500"
        />
        <MetricCard
          label="Best Study Day"
          value={
            analytics.bestDayEntry
              ? BEST_DAY_FORMATTER.format(fromDateKey(analytics.bestDayEntry[0]))
              : "—"
          }
          sub={
            analytics.bestDayEntry ? `${formatDurationHours(analytics.bestDayEntry[1])} total` : "No daily totals"
          }
          accentClass="bg-gradient-to-r from-amber-400 to-orange-500"
        />
      </div>

      <div className="relative grid gap-4 xl:grid-cols-5">
        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)] xl:col-span-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">
                7-Day Activity Trend
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Bars represent daily session hours in the current rolling window.
              </p>
            </div>
            <div className="text-xs tabular-nums text-slate-500">
              Peak {formatDurationHours(trendPeakHours)}
            </div>
          </div>

          {trendPeakHours === 0 ? (
            <div className="mt-5 flex h-28 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-950/35 text-sm text-slate-500">
              Log more sessions to see a trend.
            </div>
          ) : (
            <div className="mt-5 flex items-end gap-2">
              {analytics.trend.map((point, index) => (
                <TrendBar
                  key={point.dateKey}
                  label={point.label}
                  hours={point.hours}
                  maxHours={trendPeakHours}
                  isLatest={index === analytics.trend.length - 1}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)] xl:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-500">
                Top Methods
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Derived from the same session logs and sorted by total hours.
              </p>
            </div>
            <div className="text-xs tabular-nums text-slate-500">
              {analytics.methodRows.length} method{analytics.methodRows.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            {visibleMethods.map((row) => (
              <MethodRow
                key={row.methodKey}
                method={row.method}
                hours={row.hours}
                sessionCount={row.sessionCount}
                percent={analytics.totalHours > 0 ? (row.hours / analytics.totalHours) * 100 : 0}
              />
            ))}
          </div>

          {analytics.methodRows.length > visibleMethods.length ? (
            <div className="mt-4 text-xs text-slate-500">
              Showing top {visibleMethods.length} of {analytics.methodRows.length} methods.
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border border-slate-700/60 bg-slate-950/35 p-4 text-sm text-slate-400">
            Top method share:{" "}
            <span className="font-semibold tabular-nums text-slate-200">
              {formatDurationHours(topMethodTotal)}
            </span>
            {analytics.totalHours > 0 ? ` of ${formatDurationHours(analytics.totalHours)} total.` : "."}
          </div>
        </section>
      </div>

      <UrgeAnalyticsSection urgeLogs={state.urgeLogs ?? []} />
    </div>
  );
}
