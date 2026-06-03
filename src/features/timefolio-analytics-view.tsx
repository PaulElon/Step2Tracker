import { useMemo, useState } from "react";
import { EmptyState, Panel } from "../components/ui";
import { formatMinutes, getTodayKey, parseDateKey } from "../lib/datetime";
import { allocationByMethodDisplay, totalsByDay } from "../lib/tf-session-adapters";
import {
  buildUrgeAnalytics,
  URGE_TRIGGER_LABELS,
  type UrgeWindow,
} from "../lib/urge-analytics";
import { TimeFolioStoreProvider, useTimeFolioStore } from "../state/tf-store";
import type { TfSessionLog, UrgeLog } from "../types/models";

type TrendPoint = {
  dateKey: string;
  label: string;
  weekday: number;
  hours: number;
};

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
});

const BEST_DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
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
      weekday: date.getDay(),
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

function formatHoursShort(hours: number): string {
  return formatMinutes(Math.round(hours * 60));
}

function formatSignedHoursShort(hours: number): string {
  if (Math.abs(hours) < 0.05) {
    return "Flat vs prior 7d";
  }
  const sign = hours > 0 ? "+" : "−";
  return `${sign}${formatHoursShort(Math.abs(hours))} vs prior 7d`;
}

function FocusRing({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;
  return (
    <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0" aria-hidden="true">
      <circle
        cx={20}
        cy={20}
        r={radius}
        fill="none"
        stroke="rgba(148,163,184,0.18)"
        strokeWidth={3.5}
      />
      <circle
        cx={20}
        cy={20}
        r={radius}
        fill="none"
        stroke="url(#analytics-focus-ring)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeDasharray={`${dash.toFixed(2)} ${circumference.toFixed(2)}`}
        transform="rotate(-90 20 20)"
      />
      <defs>
        <linearGradient id="analytics-focus-ring" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="rgb(94,234,212)" />
          <stop offset="100%" stopColor="rgb(56,189,248)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function StatChip({
  label,
  value,
  meta,
  viz,
}: {
  label: string;
  value: string;
  meta?: string;
  viz?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 truncate text-[1.15rem] font-semibold tabular-nums text-white">{value}</p>
        {meta ? <p className="mt-0.5 truncate text-[11px] text-slate-400">{meta}</p> : null}
      </div>
      {viz ? <div className="shrink-0">{viz}</div> : null}
    </div>
  );
}

function MethodAllocationRow({
  hours,
  method,
  percent,
  rank,
  sessionCount,
}: {
  hours: number;
  method: string;
  percent: number;
  rank: number;
  sessionCount: number;
}) {
  const barWidth = Math.max(percent, hours > 0 ? 3 : 0);
  return (
    <li className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 py-2">
      <span className="text-[11px] font-medium tabular-nums text-slate-500">{rank}</span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] font-medium text-slate-100">{method}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
            {percent.toFixed(0)}%
          </span>
        </div>
        <div className="mt-1.5 h-[5px] w-full overflow-hidden rounded-full bg-white/[0.05]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-indigo-400"
            style={{ width: `${Math.min(100, barWidth)}%` }}
          />
        </div>
        <p className="mt-1 text-[10.5px] text-slate-500">
          {sessionCount} session{sessionCount === 1 ? "" : "s"}
        </p>
      </div>
      <span className="self-center text-[12px] font-semibold tabular-nums text-slate-200">
        {formatHoursShort(hours)}
      </span>
    </li>
  );
}

function TrendBar({
  hours,
  isLatest,
  isWeekend,
  label,
  maxHours,
}: {
  hours: number;
  isLatest: boolean;
  isWeekend: boolean;
  label: string;
  maxHours: number;
}) {
  const height = maxHours > 0 ? Math.max((hours / maxHours) * 100, hours > 0 ? 12 : 3) : 3;
  const surface = isLatest
    ? "bg-gradient-to-t from-cyan-400 via-sky-400 to-indigo-400"
    : isWeekend
      ? "bg-gradient-to-t from-cyan-500/35 via-sky-400/35 to-indigo-300/35"
      : "bg-gradient-to-t from-cyan-400/65 via-sky-400/55 to-indigo-400/55";

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div
        className="flex h-36 w-full items-end justify-center"
        title={`${label}: ${formatHoursShort(hours)}`}
      >
        <div
          className={`w-full max-w-[22px] rounded-t-[6px] ${surface}`}
          style={{ height: `${height}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums ${isLatest ? "font-semibold text-cyan-200" : "text-slate-500"}`}>
        {label.charAt(0)}
      </span>
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

function UrgeStatTile({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-[1.05rem] font-semibold tabular-nums text-white">{value}</p>
      {meta ? <p className="mt-0.5 truncate text-[11px] text-slate-400">{meta}</p> : null}
    </div>
  );
}

function UrgeTrendBar({
  count,
  isPeak,
  label,
  maxCount,
}: {
  count: number;
  isPeak: boolean;
  label: string;
  maxCount: number;
}) {
  const height = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 12 : 3) : 3;
  const surface = isPeak
    ? "bg-gradient-to-t from-violet-400 via-indigo-400 to-sky-400"
    : "bg-gradient-to-t from-violet-400/60 via-indigo-400/55 to-sky-400/55";
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <div className="flex h-24 w-full items-end justify-center" title={`${label}: ${count} urge${count === 1 ? "" : "s"}`}>
        <div className={`w-full max-w-[18px] rounded-t-[5px] ${surface}`} style={{ height: `${height}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-slate-500">{count}</span>
    </div>
  );
}

function UrgeAnalyticsSection({ urgeLogs }: { urgeLogs: UrgeLog[] }) {
  const [urgeWindow, setUrgeWindow] = useState<UrgeWindow>(14);
  const todayKey = getTodayKey();
  const analytics = useMemo(
    () => buildUrgeAnalytics(urgeLogs, urgeWindow, todayKey),
    [urgeLogs, urgeWindow, todayKey],
  );

  const windowLabel = urgeWindow === "all" ? "all-time" : `last ${urgeWindow} days`;
  const trendPeak = analytics.dailyTrend.reduce((max, point) => Math.max(max, point.count), 0);
  const triggerMax = analytics.triggerBreakdown.reduce((max, entry) => Math.max(max, entry.count), 0);
  const visibleTriggers = analytics.triggerBreakdown.slice(0, 5);
  const hiddenTriggerCount = analytics.triggerBreakdown.length - visibleTriggers.length;
  const intensityMax = analytics.intensityDistribution.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const timeMax = analytics.timeBuckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const highIntensityCount =
    analytics.intensityDistribution[3].count + analytics.intensityDistribution[4].count;

  return (
    <section className="glass-panel flex flex-col gap-3 p-4 xl:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Urge Analytics</p>
          <p className="mt-0.5 text-[12px] text-slate-400">
            Awareness patterns from urges logged during focus sessions · {windowLabel}
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          {URGE_WINDOW_OPTIONS.map((option) => {
            const isActive = option.value === urgeWindow;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setUrgeWindow(option.value)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                  isActive
                    ? "bg-gradient-to-r from-violet-500/30 to-sky-500/30 text-white"
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
        <div className="flex flex-col items-center justify-center rounded-[16px] border border-dashed border-white/[0.08] bg-white/[0.015] px-6 py-10 text-center">
          <p className="text-sm font-medium text-slate-200">No urges logged in this period.</p>
          <p className="mt-1 max-w-sm text-[12px] leading-5 text-slate-500">
            Use Log urge during a focus session to start building awareness.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <UrgeStatTile label="Total urges" value={String(analytics.totalCount)} meta={windowLabel} />
            <UrgeStatTile
              label="Avg intensity"
              value={`${analytics.averageIntensity.toFixed(1)}/5`}
              meta={`Peak ${analytics.highestIntensity}/5`}
            />
            <UrgeStatTile
              label="Highest"
              value={`${analytics.highestIntensity}/5`}
              meta={`${highIntensityCount} high (4–5)`}
            />
            <UrgeStatTile
              label="Top trigger"
              value={analytics.topTrigger ? URGE_TRIGGER_LABELS[analytics.topTrigger] : "—"}
              meta={
                analytics.triggerBreakdown[0]
                  ? `${analytics.triggerBreakdown[0].count} time${analytics.triggerBreakdown[0].count === 1 ? "" : "s"}`
                  : undefined
              }
            />
            <UrgeStatTile
              label="Urges / day"
              value={analytics.urgesPerDay.toFixed(1)}
              meta={`over ${analytics.windowDays} day${analytics.windowDays === 1 ? "" : "s"}`}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">14-day urge trend</p>
                <span className="text-[11px] tabular-nums text-slate-500">Peak {trendPeak}</span>
              </div>
              {trendPeak === 0 ? (
                <div className="mt-3 flex h-24 items-center justify-center rounded-[12px] border border-dashed border-white/[0.08] text-[12px] text-slate-500">
                  No urges in the last 14 days.
                </div>
              ) : (
                <div className="mt-3 flex items-end gap-1.5">
                  {analytics.dailyTrend.map((point) => (
                    <UrgeTrendBar
                      key={point.dateKey}
                      count={point.count}
                      isPeak={point.count === trendPeak && trendPeak > 0}
                      label={URGE_TREND_DAY_FORMATTER.format(parseDateKey(point.dateKey))}
                      maxCount={trendPeak}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Trigger breakdown</p>
              <div className="mt-3 flex flex-col gap-2.5">
                {visibleTriggers.map((entry) => (
                  <div key={entry.trigger}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[13px] text-slate-100">{entry.label}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                        {entry.count} · avg {entry.averageIntensity.toFixed(1)}/5
                      </span>
                    </div>
                    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400"
                        style={{ width: `${triggerMax > 0 ? Math.max((entry.count / triggerMax) * 100, 6) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {hiddenTriggerCount > 0 ? (
                <p className="mt-2.5 text-[11px] text-slate-500">
                  + {hiddenTriggerCount} more trigger{hiddenTriggerCount === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Intensity</p>
                <span className="text-[11px] tabular-nums text-slate-500">{highIntensityCount} high (4–5)</span>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {analytics.intensityDistribution.map((bucket) => (
                  <div key={bucket.intensity} className="flex items-center gap-3">
                    <span className="w-6 shrink-0 text-[11px] tabular-nums text-slate-500">{bucket.intensity}/5</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className={`h-full rounded-full ${
                          bucket.intensity >= 4
                            ? "bg-gradient-to-r from-amber-400 to-orange-400"
                            : "bg-gradient-to-r from-violet-400 to-sky-400"
                        }`}
                        style={{ width: `${intensityMax > 0 ? Math.max((bucket.count / intensityMax) * 100, bucket.count > 0 ? 6 : 0) : 0}%` }}
                      />
                    </div>
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Time of day</p>
                <span className="truncate text-[11px] text-slate-400">
                  {analytics.topTimeBucket ? `Peak ${analytics.topTimeBucket.label}` : "—"}
                </span>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {analytics.timeBuckets.map((bucket) => (
                  <div key={bucket.bucket} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 text-[11px] text-slate-400">{bucket.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400"
                        style={{ width: `${timeMax > 0 ? Math.max((bucket.count / timeMax) * 100, bucket.count > 0 ? 6 : 0) : 0}%` }}
                      />
                    </div>
                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-slate-400">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex max-h-60 flex-col rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {urgeWindow === "all" ? "Recent examples" : "Examples"}
              </p>
              <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-subtle">
                {analytics.examples.map((entry) => {
                  const note = entry.note?.trim();
                  return (
                    <div
                      key={entry.id}
                      className="rounded-[12px] border border-violet-400/12 bg-violet-500/[0.035] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-slate-500">
                            {entry.dateKey ? URGE_TREND_DAY_FORMATTER.format(parseDateKey(entry.dateKey)) : "—"}
                          </span>
                          <span className="truncate text-[12px] text-slate-200">{URGE_TRIGGER_LABELS[entry.trigger]}</span>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] tabular-nums ${entry.intensity >= 4 ? "text-amber-200" : "text-violet-100"}`}
                        >
                          {entry.intensity}/5
                        </span>
                      </div>
                      {note ? <p className="mt-0.5 truncate text-[11px] leading-4 text-slate-500">{note}</p> : null}
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

function TimeFolioAnalyticsContent() {
  const { error, isLoading, state } = useTimeFolioStore();
  const sessions = state.sessionLogs;

  const analytics = useMemo(() => {
    const today = new Date();
    const todayKey = toDateKey(today);
    const last7StartKey = toDateKey(shiftDate(today, -6));
    const prev7StartKey = toDateKey(shiftDate(today, -13));
    const prev7EndKey = toDateKey(shiftDate(today, -7));
    const last30StartKey = toDateKey(shiftDate(today, -29));
    const dailyTotals = totalsByDay(sessions);
    const methodRows = allocationByMethodDisplay(sessions);
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
    const prev7DaysHours = sumHoursInRange(sessions, prev7StartKey, prev7EndKey);
    const last30DaysHours = sumHoursInRange(sessions, last30StartKey, todayKey);
    const bestDayEntry = Object.entries(dailyTotals).sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return right[0].localeCompare(left[0]);
    })[0] ?? null;
    const activeDayAverageHours = activeDays > 0 ? totalHours / activeDays : 0;

    return {
      activeDayAverageHours,
      activeDays,
      bestDayEntry,
      distractionHours,
      focusHours,
      focusRate,
      last30DaysHours,
      last7DaysHours,
      methodRows,
      prev7DaysHours,
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
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Analytics</h2>
        <EmptyState
          title="No study time analytics yet"
          description="Log your first session in Session Log to unlock allocation, summary, and trend views."
        />
      </div>
    );
  }

  const visibleMethods = analytics.methodRows.slice(0, 6);
  const trendPeakHours = analytics.trend.reduce((max, point) => Math.max(max, point.hours), 0);
  const trendAxisMax = Math.max(1, Math.ceil(trendPeakHours * 2) / 2);
  const trendAxisTicks = [trendAxisMax, trendAxisMax / 2, 0];
  const bestDayLabel = analytics.bestDayEntry
    ? BEST_DAY_FORMATTER.format(new Date(`${analytics.bestDayEntry[0]}T12:00:00`))
    : null;
  const bestDayHours = analytics.bestDayEntry ? analytics.bestDayEntry[1] : 0;
  const topMethod = analytics.methodRows[0] ?? null;
  const topMethodShare = topMethod && analytics.totalHours > 0
    ? (topMethod.hours / analytics.totalHours) * 100
    : 0;
  const showMomentum = sessions.length >= 4 && analytics.last7DaysHours + analytics.prev7DaysHours > 0;
  const hasDistraction = analytics.distractionHours > 0;
  const focusMeta = hasDistraction
    ? `${formatHoursShort(analytics.distractionHours)} distraction`
    : "Distraction-free";
  const momentumLabel = showMomentum
    ? formatSignedHoursShort(analytics.last7DaysHours - analytics.prev7DaysHours)
    : `${formatHoursShort(analytics.last7DaysHours)} in last 7 days`;

  return (
    <div className="flex flex-col gap-3 pb-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Analytics</h2>
        <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] tabular-nums text-slate-400">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} · {analytics.activeDays} active day{analytics.activeDays === 1 ? "" : "s"}
        </span>
      </div>

      <section className="glass-panel p-4 xl:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(240px,0.78fr)_minmax(0,1.42fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Summary</p>
              <p className="mt-2 font-display text-[3rem] font-semibold leading-none tracking-[-0.04em] text-white tabular-nums">
                {formatHoursShort(analytics.totalHours)}
              </p>
              <p className="mt-2 text-[12px] font-medium text-slate-300">{momentumLabel}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatChip label="Last 7 days" value={formatHoursShort(analytics.last7DaysHours)} />
              <StatChip label="Last 30 days" value={formatHoursShort(analytics.last30DaysHours)} />
              <StatChip label="Active days" value={String(analytics.activeDays)} />
              <StatChip label="Focus rate" value={`${analytics.focusRate.toFixed(0)}%`} meta={focusMeta} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">14-day activity</p>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  Hours per day · peak {formatHoursShort(trendPeakHours)}
                </p>
              </div>
              <p className="text-[11px] text-slate-500">
                7d {formatHoursShort(analytics.last7DaysHours)}
              </p>
            </div>
            {trendPeakHours === 0 ? (
              <div className="mt-4 flex h-40 items-center justify-center rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.015] text-[12px] text-slate-500">
                Log more sessions to see a trend.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
                <div className="flex h-40 flex-col justify-between border-r border-white/[0.08] pr-2 text-right text-[10px] tabular-nums text-slate-500">
                  {trendAxisTicks.map((tick) => (
                    <span key={tick}>{formatHoursShort(tick)}</span>
                  ))}
                </div>
                <div className="flex h-40 items-end gap-1.5">
                  {analytics.trend.map((point, index) => (
                    <TrendBar
                      key={point.dateKey}
                      hours={point.hours}
                      isLatest={index === analytics.trend.length - 1}
                      isWeekend={point.weekday === 0 || point.weekday === 6}
                      label={point.label}
                      maxHours={trendAxisMax}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <section className="glass-panel flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Method allocation</p>
            <p className="text-[11px] text-slate-500">
              {analytics.methodRows.length} method{analytics.methodRows.length === 1 ? "" : "s"}
            </p>
          </div>
          <ol className="grid gap-x-6 divide-y divide-white/[0.05] md:grid-cols-2 md:divide-y-0">
            {visibleMethods.map((row, index) => {
              const percent = analytics.totalHours > 0 ? (row.hours / analytics.totalHours) * 100 : 0;
              return (
                <MethodAllocationRow
                  key={row.methodKey}
                  hours={row.hours}
                  method={row.method}
                  percent={percent}
                  rank={index + 1}
                  sessionCount={row.sessionCount}
                />
              );
            })}
          </ol>
          {analytics.methodRows.length > visibleMethods.length ? (
            <p className="text-[11px] text-slate-500">
              + {analytics.methodRows.length - visibleMethods.length} more method{analytics.methodRows.length - visibleMethods.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </section>

        <section className="glass-panel flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Focus quality</p>
            <p className="text-[11px] text-slate-500">{focusMeta}</p>
          </div>
          <div className="flex items-center gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.02] px-3 py-3">
            <FocusRing percent={analytics.focusRate} />
            <div className="min-w-0">
              <p className="text-[1.7rem] font-semibold leading-none text-white tabular-nums">
                {analytics.focusRate.toFixed(0)}%
              </p>
              <p className="mt-1 text-[12px] text-slate-400">Focused study time</p>
            </div>
          </div>
          <div className="grid gap-2">
            <StatChip
              label="Daily pace"
              value={formatHoursShort(analytics.activeDayAverageHours)}
              meta={`avg on active days`}
            />
            <StatChip
              label="Top method"
              value={topMethod ? topMethod.method : "—"}
              meta={
                topMethod
                  ? `${formatHoursShort(topMethod.hours)} · ${topMethodShare.toFixed(0)}% share`
                  : "No method data yet"
              }
            />
            <StatChip
              label="Best day"
              value={bestDayLabel ?? "—"}
              meta={bestDayLabel ? `${formatHoursShort(bestDayHours)} logged` : "No daily totals"}
            />
          </div>
        </section>
      </div>

      <UrgeAnalyticsSection urgeLogs={state.urgeLogs ?? []} />
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
