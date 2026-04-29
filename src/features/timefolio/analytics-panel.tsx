import { useMemo } from "react";
import { allocationByMethod, totalsByDay } from "../../lib/tf-session-adapters";
import { formatMinutes } from "../../lib/datetime";
import { useTimeFolioStore } from "../../state/tf-store";
import type { TfSessionLog } from "../../types/models";

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
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
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
        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-400">
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
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
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
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-900/60 p-5 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.9)] xl:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-400">
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
    </div>
  );
}
