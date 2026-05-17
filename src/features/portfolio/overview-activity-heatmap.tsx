import { useEffect, useMemo, useRef, useState } from "react";
import { MetricStrip, MetricStripItem } from "../../components/ui";
import { addDays, daysBetween, formatLongDate, formatMinutes, getTodayKey, startOfWeek } from "../../lib/datetime";
import { splitAutoSessionMethodLabel } from "../../lib/tf-session-adapters";
import { cn } from "../../lib/ui";
import { TimeFolioStoreProvider, useTimeFolioStore } from "../../state/tf-store";
import type { TfSessionLog } from "../../types/models";

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const DEFAULT_DAY_CELL_SIZE = 14;
const DEFAULT_DAY_CELL_GAP = 4;
const COMPACT_DAY_CELL_SIZE = 10;
const COMPACT_DAY_CELL_GAP = 2;

type MethodBreakdown = {
  method: string;
  minutes: number;
  sessionCount: number;
};

type DayActivity = {
  date: string;
  allSessions: TfSessionLog[];
  studyMinutes: number;
  studySessionCount: number;
  topMethod: string | null;
  methodBreakdown: MethodBreakdown[];
};

type HoverState = {
  date: string;
  left: number;
  top: number;
};

type DayDetailStats = {
  totalSessions: number;
  totalStudySessions: number;
  distractionSessions: number;
  distractionMinutes: number;
};

function dayIntensityLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes >= 240) return 4;
  if (minutes >= 120) return 3;
  if (minutes >= 60) return 2;
  if (minutes > 0) return 1;
  return 0;
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-slate-500/15",
  1: "bg-sky-500/35",
  2: "bg-blue-500/55",
  3: "bg-blue-500/80",
  4: "bg-cyan-300/95",
};

function getDisplayMethod(method: string): { label: string; isAuto: boolean } {
  return splitAutoSessionMethodLabel(method);
}

function computeDayDetailStats(activity: DayActivity | null | undefined): DayDetailStats {
  if (!activity) {
    return {
      totalSessions: 0,
      totalStudySessions: 0,
      distractionSessions: 0,
      distractionMinutes: 0,
    };
  }

  let totalStudySessions = 0;
  let distractionSessions = 0;
  let distractionMinutes = 0;

  for (const session of activity.allSessions) {
    if (session.isDistraction) {
      distractionSessions += 1;
      distractionMinutes += Math.max(0, Math.round(session.hours * 60));
      continue;
    }
    totalStudySessions += 1;
  }

  return {
    totalSessions: activity.allSessions.length,
    totalStudySessions,
    distractionSessions,
    distractionMinutes,
  };
}

function buildYearWeeks(year: number): { yearStart: string; yearEnd: string; weeks: string[][] } {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const firstWeekStart = startOfWeek(yearStart, 1);
  const lastWeekStart = startOfWeek(yearEnd, 1);
  const weekCount = Math.floor(daysBetween(firstWeekStart, lastWeekStart) / 7) + 1;

  const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => addDays(firstWeekStart, weekIndex * 7 + dayIndex)),
  );

  return { yearStart, yearEnd, weeks };
}

function buildActivityByDate(sessionLogs: TfSessionLog[]): Map<string, DayActivity> {
  const byDate = new Map<string, DayActivity>();

  for (const session of sessionLogs) {
    const existing = byDate.get(session.date) ?? {
      date: session.date,
      allSessions: [],
      studyMinutes: 0,
      studySessionCount: 0,
      topMethod: null,
      methodBreakdown: [],
    };

    existing.allSessions.push(session);

    if (!session.isDistraction) {
      const minutes = Math.max(0, Math.round(session.hours * 60));
      existing.studyMinutes += minutes;
      existing.studySessionCount += 1;
      const breakdownMatch = existing.methodBreakdown.find((entry) => entry.method === session.method);
      if (breakdownMatch) {
        breakdownMatch.minutes += minutes;
        breakdownMatch.sessionCount += 1;
      } else {
        existing.methodBreakdown.push({ method: session.method, minutes, sessionCount: 1 });
      }
    }

    byDate.set(session.date, existing);
  }

  byDate.forEach((activity) => {
    activity.methodBreakdown.sort((left, right) => {
      if (right.minutes !== left.minutes) {
        return right.minutes - left.minutes;
      }
      return left.method.localeCompare(right.method);
    });
    activity.topMethod = activity.methodBreakdown[0]?.method ?? null;
    activity.allSessions.sort((left, right) => left.startISO.localeCompare(right.startISO));
  });

  return byDate;
}

function computeStreaks(
  yearStart: string,
  endDate: string,
  activityByDate: Map<string, DayActivity>,
): { longest: number; current: number } {
  let longest = 0;
  let run = 0;

  const dayCount = daysBetween(yearStart, endDate) + 1;
  for (let index = 0; index < dayCount; index += 1) {
    const date = addDays(yearStart, index);
    const minutes = activityByDate.get(date)?.studyMinutes ?? 0;
    if (minutes > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  for (let index = 0; index < dayCount; index += 1) {
    const date = addDays(endDate, -index);
    const minutes = activityByDate.get(date)?.studyMinutes ?? 0;
    if (minutes <= 0) {
      break;
    }
    current += 1;
  }

  return { longest, current };
}

function buildMonthBands(weeks: string[][], yearStart: string, yearEnd: string) {
  const bands: Array<{ key: string; label: string; startWeek: number; span: number }> = [];

  weeks.forEach((week, weekIndex) => {
    const inYearDate = week.find((date) => date >= yearStart && date <= yearEnd);
    if (!inYearDate) {
      return;
    }

    const monthKey = inYearDate.slice(0, 7);
    const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleString("en-US", {
      month: "short",
    });
    const lastBand = bands[bands.length - 1];

    if (lastBand?.key === monthKey) {
      lastBand.span += 1;
      return;
    }

    bands.push({ key: monthKey, label: monthLabel, startWeek: weekIndex, span: 1 });
  });

  return bands;
}

function OverviewActivityHeatmapBody({ compact = false }: { compact?: boolean }) {
  const { state, isLoading, error } = useTimeFolioStore();
  const today = getTodayKey();
  const year = Number(today.slice(0, 4));
  const themeId = document.documentElement.dataset.theme;
  const isLightTheme = themeId === "light" || themeId === "maggiepink";
  const dayCellSize = compact ? COMPACT_DAY_CELL_SIZE : DEFAULT_DAY_CELL_SIZE;
  const dayCellGap = compact ? COMPACT_DAY_CELL_GAP : DEFAULT_DAY_CELL_GAP;

  const { yearStart, yearEnd, weeks } = useMemo(() => buildYearWeeks(year), [year]);
  const activityByDate = useMemo(() => buildActivityByDate(state.sessionLogs), [state.sessionLogs]);

  const trackedEndDate = today > yearEnd ? yearEnd : today;
  const totalStudyMinutes = useMemo(
    () => [...activityByDate.values()].reduce((total, day) => total + day.studyMinutes, 0),
    [activityByDate],
  );
  const activeDays = useMemo(
    () => [...activityByDate.values()].filter((day) => day.studyMinutes > 0).length,
    [activityByDate],
  );
  const daysElapsed = daysBetween(yearStart, trackedEndDate) + 1;
  const daysLearnedPercent = daysElapsed > 0 ? (activeDays / daysElapsed) * 100 : 0;
  const dailyAverageMinutes = activeDays > 0 ? totalStudyMinutes / activeDays : 0;
  const streaks = useMemo(
    () => computeStreaks(yearStart, trackedEndDate, activityByDate),
    [activityByDate, trackedEndDate, yearStart],
  );
  const monthBands = useMemo(() => buildMonthBands(weeks, yearStart, yearEnd), [weeks, yearEnd, yearStart]);

  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dayDetailsRef = useRef<HTMLDivElement | null>(null);
  const dayGridRef = useRef<HTMLDivElement | null>(null);

  const selectedActivity = selectedDate ? activityByDate.get(selectedDate) : null;
  const tooltipActivity = hovered ? activityByDate.get(hovered.date) : null;
  const selectedStats = computeDayDetailStats(selectedActivity);
  const tooltipTopMethod = tooltipActivity?.topMethod ? getDisplayMethod(tooltipActivity.topMethod) : null;
  const selectedTopMethod = selectedActivity?.topMethod ? getDisplayMethod(selectedActivity.topMethod) : null;
  const selectedStudyTotalMinutes = selectedActivity?.studyMinutes ?? 0;

  useEffect(() => {
    if (!selectedDate) {
      return;
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedDate(null);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedDate) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      dayDetailsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [selectedDate]);

  if (isLoading) {
    return (
      <section className={cn("glass-panel flex flex-col", compact ? "gap-2.5 p-3.5" : "gap-3 p-5 xl:p-6")}>
        <div>
          <h3 className={cn("font-semibold text-white", compact ? "text-[0.95rem]" : "text-base")}>
            Study Activity Heatmap
          </h3>
          <p className="mt-1 text-sm text-slate-400">Loading TimeFolio activity...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cn("glass-panel flex flex-col", compact ? "gap-2.5 p-3.5" : "gap-3 p-5 xl:p-6")}>
        <div>
          <h3 className={cn("font-semibold text-white", compact ? "text-[0.95rem]" : "text-base")}>
            Study Activity Heatmap
          </h3>
          <p className="mt-1 text-sm text-rose-300">{error}</p>
        </div>
      </section>
    );
  }

  const gridWidth = weeks.length * dayCellSize + (weeks.length - 1) * dayCellGap;
  const tooltipGridWidth = compact ? (dayGridRef.current?.clientWidth ?? gridWidth) : gridWidth;

  return (
    <section className={cn("glass-panel flex flex-col", compact ? "gap-2.5 p-3.5" : "gap-3 p-4 xl:p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className={cn("font-semibold text-white", compact ? "text-[0.95rem]" : "text-base")}>
            Study Activity Heatmap
          </h3>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
          {year}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className={cn("min-w-fit", compact ? "w-full" : "")}>
          <div className={cn("mb-1", compact ? "pl-6" : "pl-8")}>
            <div
              className="grid"
              style={{
                gridTemplateColumns: compact ? `repeat(${weeks.length}, minmax(0, 1fr))` : `repeat(${weeks.length}, ${dayCellSize}px)`,
                columnGap: `${dayCellGap}px`,
                width: compact ? "100%" : `${gridWidth}px`,
              }}
            >
              {monthBands.map((band) => (
                <span
                  key={band.key}
                  className="truncate text-[10px] text-slate-500"
                  style={{ gridColumn: `${band.startWeek + 1} / span ${band.span}` }}
                >
                  {band.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="flex gap-2">
              <div className="grid grid-rows-7 gap-1" style={{ rowGap: `${dayCellGap}px` }}>
                {ROW_LABELS.map((label, index) => (
                  <div
                    key={`${label}-${index}`}
                    className={cn("flex items-center justify-end text-slate-500", compact ? "text-[9px]" : "text-[10px]")}
                    style={{ height: `${dayCellSize}px` }}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div
                ref={dayGridRef}
                className="relative grid"
                style={{
                  gridTemplateColumns: compact ? `repeat(${weeks.length}, minmax(0, 1fr))` : `repeat(${weeks.length}, ${dayCellSize}px)`,
                  gridTemplateRows: `repeat(7, ${dayCellSize}px)`,
                  columnGap: `${dayCellGap}px`,
                  rowGap: `${dayCellGap}px`,
                  width: compact ? "100%" : `${gridWidth}px`,
                }}
                onMouseLeave={() => setHovered(null)}
              >
                {weeks.flatMap((week, weekIndex) =>
                  week.map((date, dayIndex) => {
                    const inYear = date >= yearStart && date <= yearEnd;
                    const minutes = inYear ? (activityByDate.get(date)?.studyMinutes ?? 0) : 0;
                    const level = dayIntensityLevel(minutes);
                    const isToday = date === today;
                    const isSelected = selectedDate === date;

                    return (
                      <button
                        key={date}
                        type="button"
                        disabled={!inYear}
                        onMouseEnter={(event) => {
                          if (!inYear) return;
                          setHovered({
                            date,
                            left: event.currentTarget.offsetLeft + event.currentTarget.offsetWidth / 2,
                            top: event.currentTarget.offsetTop,
                          });
                        }}
                        onClick={() => {
                          if (!inYear) return;
                          setHovered(null);
                          setSelectedDate(date);
                        }}
                        className={cn(
                          "rounded-[3px] border transition",
                          inYear
                            ? "cursor-pointer border-white/[0.08] hover:border-cyan-300/70 hover:brightness-110"
                            : "cursor-default border-transparent opacity-25",
                          LEVEL_CLASS[level],
                          isToday &&
                            (isLightTheme
                              ? "ring-2 ring-cyan-500 shadow-[0_0_0_1px_rgba(15,23,42,0.26)]"
                              : "ring-1 ring-cyan-200/80"),
                          isSelected && "ring-2 ring-white/80",
                        )}
                        style={{
                          gridColumn: weekIndex + 1,
                          gridRow: dayIndex + 1,
                          width: compact ? "100%" : `${dayCellSize}px`,
                          height: `${dayCellSize}px`,
                        }}
                        aria-label={
                          inYear
                            ? `${formatLongDate(date)}: ${minutes > 0 ? formatMinutes(minutes) : "No study activity"}`
                            : "Outside current year"
                        }
                      />
                    );
                  }),
                )}

                {hovered && !selectedDate ? (
                  <div
                    className="pointer-events-none absolute z-20 w-[230px] -translate-x-1/2 -translate-y-full rounded-xl border px-3 py-2.5 text-xs shadow-2xl"
                    style={{
                      left: `${Math.min(Math.max(hovered.left, 112), Math.max(tooltipGridWidth - 112, 112))}px`,
                      top: `${Math.max(hovered.top - 8, 8)}px`,
                      borderColor: "var(--panel-border)",
                      background: "var(--panel-support-bg)",
                      boxShadow: "0 14px 36px var(--panel-shadow)",
                    }}
                  >
                    <p className="font-semibold text-slate-100 [color:var(--rich-text,#e2e8f0)]">
                      {formatLongDate(hovered.date)}
                    </p>
                    <p className="mt-1 text-slate-200 [color:var(--rich-text,#e2e8f0)]">
                      Study: {formatMinutes(tooltipActivity?.studyMinutes ?? 0)}
                    </p>
                    <p className="text-slate-400 [color:var(--rich-text-muted,#94a3b8)]">
                      Sessions: {tooltipActivity?.studySessionCount ?? 0}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-slate-400 [color:var(--rich-text-muted,#94a3b8)]">
                      <span className="shrink-0">Top method:</span>
                      <span className="truncate [color:var(--rich-text,#e2e8f0)]">
                        {tooltipTopMethod ? tooltipTopMethod.label : "—"}
                      </span>
                    </p>
                    <span
                      className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r"
                      style={{
                        borderColor: "var(--panel-border)",
                        background: "var(--panel-support-bg)",
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div className={cn("flex flex-col gap-2 border-t border-white/10", compact ? "pt-2" : "pt-2")}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Less</span>
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-slate-500/15" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-sky-500/35" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-blue-500/55" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-blue-500/80" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-cyan-300/95" />
          <span>More</span>
        </div>

        {compact ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Daily avg", formatMinutes(Math.round(dailyAverageMinutes)), ""],
              ["Days learned", `${Math.round(daysLearnedPercent)}%`, `${activeDays}/${daysElapsed}`],
              ["Longest", `${streaks.longest}d`, ""],
              ["Current", `${streaks.current}d`, ""],
              ["Tracked", formatMinutes(totalStudyMinutes), ""],
            ].map(([label, value, meta]) => (
              <div key={label} className="rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                <p className="text-[10px] text-slate-500">{label}</p>
                <p className="mt-0.5 truncate text-[13px] font-semibold tabular-nums text-white">{value}</p>
                {meta ? <p className="text-[10px] text-slate-500">{meta}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <MetricStrip
            columns="grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
            className="text-[13px] text-slate-200"
          >
            <MetricStripItem label="Daily average" value={formatMinutes(Math.round(dailyAverageMinutes))} />
            <MetricStripItem
              label="Days learned"
              value={`${Math.round(daysLearnedPercent)}%`}
              meta={`${activeDays}/${daysElapsed} days`}
            />
            <MetricStripItem label="Longest streak" value={`${streaks.longest} day${streaks.longest === 1 ? "" : "s"}`} />
            <MetricStripItem label="Current streak" value={`${streaks.current} day${streaks.current === 1 ? "" : "s"}`} />
            <MetricStripItem label="Total tracked" value={formatMinutes(totalStudyMinutes)} />
          </MetricStrip>
        )}
      </div>

      {selectedDate ? (
        <div
          ref={dayDetailsRef}
          className={cn(
            "relative mt-1 overflow-hidden border border-white/10 bg-white/[0.02] shadow-[0_20px_60px_-32px_rgba(2,8,23,0.9)] scroll-mt-6 scroll-mb-6",
            compact ? "rounded-[16px]" : "rounded-[22px]",
          )}
        >
          <div className={cn("flex items-start justify-between gap-4 border-b border-white/10 bg-white/[0.02]", compact ? "px-3 py-2.5" : "px-4 py-3.5")}>
            <div>
              <p className="text-[11px] text-slate-500">Day details</p>
              <h4 id="overview-heatmap-day-title" className={cn("mt-1 font-semibold text-white", compact ? "text-base" : "text-xl")}>
                {formatLongDate(selectedDate)}
              </h4>
              <p className={cn("mt-1 text-slate-300", compact ? "hidden" : "text-sm")}>
                Review study and session details for the selected day.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="rounded-[10px] border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-slate-200 transition hover:border-white/20 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className={cn("overflow-y-auto", compact ? "max-h-[min(42vh,360px)] px-3 py-3" : "max-h-[min(70vh,720px)] px-4 py-4")}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Study Time" value={formatMinutes(selectedActivity?.studyMinutes ?? 0)} />
              <StatTile
                label="Sessions"
                value={`${selectedStats.totalStudySessions}`}
                meta={`${selectedStats.totalSessions} total logged`}
              />
              <StatTile
                label="Top Method"
                value={selectedTopMethod?.label ?? "—"}
                meta="Most-used method"
              />
              <StatTile
                label="Distraction"
                value={
                  selectedStats.distractionSessions > 0
                    ? `${selectedStats.distractionSessions} session${selectedStats.distractionSessions === 1 ? "" : "s"}`
                    : "None"
                }
                meta={
                  selectedStats.distractionMinutes > 0
                    ? `${formatMinutes(selectedStats.distractionMinutes)} logged`
                    : "No distraction time logged"
                }
                tone={selectedStats.distractionSessions > 0 ? "warn" : "default"}
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)]">
              <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] text-slate-500">Method breakdown</p>
                {selectedActivity?.methodBreakdown.length ? (
                  <ol className="mt-2 divide-y divide-white/10">
                    {selectedActivity.methodBreakdown.slice(0, 6).map((entry) => {
                      const display = getDisplayMethod(entry.method);
                      const percent =
                        selectedStudyTotalMinutes > 0 ? (entry.minutes / selectedStudyTotalMinutes) * 100 : 0;
                      return (
                        <li key={entry.method} className="py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-200">{display.label}</span>
                              <div className="mt-0.5 text-xs text-slate-500">
                                {entry.sessionCount} session{entry.sessionCount === 1 ? "" : "s"}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-semibold tabular-nums text-slate-100">
                                {formatMinutes(entry.minutes)}
                              </div>
                              <div className="text-xs tabular-nums text-slate-400">{percent.toFixed(0)}%</div>
                            </div>
                          </div>
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-cyan-400"
                              style={{ width: `${Math.max(percent, entry.minutes > 0 ? 6 : 0)}%` }}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No study sessions on this day.</p>
                )}
              </div>

              <div className="rounded-[16px] border border-white/10 bg-white/[0.02] p-4">
                <p className="text-[11px] text-slate-500">Session log</p>
                {selectedActivity?.allSessions.length ? (
                  <div className="mt-3 max-h-[min(44vh,420px)] space-y-2 overflow-y-auto pr-1">
                    {selectedActivity.allSessions.map((session) => {
                      const { label } = splitAutoSessionMethodLabel(session.method);
                      const minutes = Math.max(0, Math.round(session.hours * 60));
                      const hasFlag = session.isDistraction || session.isLive;
                      return (
                        <div
                          key={session.id}
                          className="rounded-[12px] border border-white/10 bg-slate-950/50 px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-slate-100">{label}</span>
                            <span className="text-sm tabular-nums text-slate-300">{formatMinutes(minutes)}</span>
                          </div>
                          {hasFlag ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {session.isDistraction ? (
                                <span className="rounded-full border border-rose-400/25 bg-rose-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-rose-200">
                                  distraction
                                </span>
                              ) : null}
                              {session.isLive ? (
                                <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-200">
                                  live
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                          {session.notes ? (
                            <p className="mt-1.5 text-xs leading-5 text-slate-400">{session.notes}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No sessions recorded for this day.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatTile({
  label,
  value,
  meta,
  badge,
  tone = "default",
}: {
  label: string;
  value: string;
  meta?: string;
  badge?: string;
  tone?: "default" | "info" | "warn";
}) {
  const toneValueClass =
    tone === "warn" ? "text-rose-200" : tone === "info" ? "text-cyan-100" : "text-slate-100";
  return (
    <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-500">{label}</p>
        {badge ? (
          <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-200">
            {badge}
          </span>
        ) : null}
      </div>
      <p className={cn("mt-1 text-[1.05rem] font-semibold tabular-nums", toneValueClass)}>{value}</p>
      {meta ? <p className="mt-1 text-[11px] text-slate-400">{meta}</p> : null}
    </div>
  );
}

export function OverviewActivityHeatmap({ compact = false }: { compact?: boolean }) {
  return (
    <TimeFolioStoreProvider>
      <OverviewActivityHeatmapBody compact={compact} />
    </TimeFolioStoreProvider>
  );
}
