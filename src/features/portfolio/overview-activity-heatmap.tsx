import { useMemo, useState } from "react";
import { ModalShell } from "../../components/modal-shell";
import { addDays, daysBetween, formatLongDate, formatMinutes, getTodayKey, startOfWeek } from "../../lib/datetime";
import { splitAutoSessionMethodLabel } from "../../lib/tf-session-adapters";
import { cn } from "../../lib/ui";
import { TimeFolioStoreProvider, useTimeFolioStore } from "../../state/tf-store";
import type { TfSessionLog } from "../../types/models";

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const DAY_CELL_SIZE = 14;
const DAY_CELL_GAP = 4;

type MethodBreakdown = {
  method: string;
  minutes: number;
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

function dayIntensityLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes >= 240) return 4;
  if (minutes >= 120) return 3;
  if (minutes >= 60) return 2;
  if (minutes > 0) return 1;
  return 0;
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-slate-700/65",
  1: "bg-sky-900/95",
  2: "bg-blue-700/90",
  3: "bg-blue-500/90",
  4: "bg-cyan-300/95",
};

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
      } else {
        existing.methodBreakdown.push({ method: session.method, minutes });
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

function OverviewActivityHeatmapBody() {
  const { state, isLoading, error } = useTimeFolioStore();
  const today = getTodayKey();
  const year = Number(today.slice(0, 4));

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

  const selectedActivity = selectedDate ? activityByDate.get(selectedDate) : null;
  const tooltipActivity = hovered ? activityByDate.get(hovered.date) : null;

  if (isLoading) {
    return (
      <section className="glass-panel flex flex-col gap-3 p-5 xl:p-6">
        <div>
          <h3 className="text-base font-semibold text-white">Study Activity Heatmap</h3>
          <p className="mt-1 text-sm text-slate-400">Loading TimeFolio activity...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="glass-panel flex flex-col gap-3 p-5 xl:p-6">
        <div>
          <h3 className="text-base font-semibold text-white">Study Activity Heatmap</h3>
          <p className="mt-1 text-sm text-rose-300">{error}</p>
        </div>
      </section>
    );
  }

  const gridWidth = weeks.length * DAY_CELL_SIZE + (weeks.length - 1) * DAY_CELL_GAP;

  return (
    <section className="glass-panel flex flex-col gap-4 p-5 xl:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Study Activity Heatmap</h3>
          <p className="mt-1 text-sm text-slate-400">
            Daily study intensity from session logs. Study totals exclude distraction sessions.
          </p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">
          {year}
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-fit">
          <div className="mb-1.5 pl-8">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${weeks.length}, ${DAY_CELL_SIZE}px)`,
                columnGap: `${DAY_CELL_GAP}px`,
              }}
            >
              {monthBands.map((band) => (
                <span
                  key={band.key}
                  className="truncate text-[10px] uppercase tracking-[0.16em] text-slate-500"
                  style={{ gridColumn: `${band.startWeek + 1} / span ${band.span}` }}
                >
                  {band.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="flex gap-2">
              <div className="grid grid-rows-7 gap-1" style={{ rowGap: `${DAY_CELL_GAP}px` }}>
                {ROW_LABELS.map((label, index) => (
                  <div
                    key={`${label}-${index}`}
                    className="flex items-center justify-end text-[10px] uppercase tracking-[0.16em] text-slate-500"
                    style={{ height: `${DAY_CELL_SIZE}px` }}
                  >
                    {label}
                  </div>
                ))}
              </div>

              <div
                className="relative grid"
                style={{
                  gridTemplateColumns: `repeat(${weeks.length}, ${DAY_CELL_SIZE}px)`,
                  gridTemplateRows: `repeat(7, ${DAY_CELL_SIZE}px)`,
                  columnGap: `${DAY_CELL_GAP}px`,
                  rowGap: `${DAY_CELL_GAP}px`,
                  width: `${gridWidth}px`,
                }}
                onMouseLeave={() => setHovered(null)}
              >
                {weeks.flatMap((week, weekIndex) =>
                  week.map((date, dayIndex) => {
                    const inYear = date >= yearStart && date <= yearEnd;
                    const minutes = inYear ? (activityByDate.get(date)?.studyMinutes ?? 0) : 0;
                    const activity = activityByDate.get(date);
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
                            left: event.currentTarget.offsetLeft + DAY_CELL_SIZE / 2,
                            top: event.currentTarget.offsetTop,
                          });
                        }}
                        onClick={() => {
                          if (!inYear) return;
                          setSelectedDate(date);
                        }}
                        className={cn(
                          "rounded-[3px] border transition",
                          inYear
                            ? "cursor-pointer border-white/[0.06] hover:border-cyan-200/45 hover:brightness-110"
                            : "cursor-default border-transparent opacity-25",
                          LEVEL_CLASS[level],
                          isToday && "ring-1 ring-cyan-200/80",
                          isSelected && "ring-2 ring-white/80",
                        )}
                        style={{
                          gridColumn: weekIndex + 1,
                          gridRow: dayIndex + 1,
                          width: `${DAY_CELL_SIZE}px`,
                          height: `${DAY_CELL_SIZE}px`,
                        }}
                        aria-label={
                          inYear
                            ? `${formatLongDate(date)}: ${minutes > 0 ? formatMinutes(minutes) : "No study activity"}`
                            : "Outside current year"
                        }
                        title={
                          inYear
                            ? `${formatLongDate(date)} • ${minutes > 0 ? formatMinutes(minutes) : "No study"}${activity ? ` • ${activity.studySessionCount} session${activity.studySessionCount === 1 ? "" : "s"}` : ""}`
                            : undefined
                        }
                      />
                    );
                  }),
                )}

                {hovered ? (
                  <div
                    className="pointer-events-none absolute z-20 w-[220px] -translate-x-1/2 -translate-y-full rounded-xl border border-white/10 bg-[#070e18]/95 px-3 py-2.5 text-xs shadow-2xl shadow-black/40"
                    style={{
                      left: `${Math.min(Math.max(hovered.left, 112), Math.max(gridWidth - 112, 112))}px`,
                      top: `${Math.max(hovered.top - 8, 8)}px`,
                    }}
                  >
                    <p className="font-semibold text-slate-100">{formatLongDate(hovered.date)}</p>
                    <p className="mt-1 text-slate-300">
                      Study: {formatMinutes(tooltipActivity?.studyMinutes ?? 0)}
                    </p>
                    <p className="text-slate-400">
                      Sessions: {tooltipActivity?.studySessionCount ?? 0}
                    </p>
                    <p className="truncate text-slate-400">
                      Top method: {tooltipActivity?.topMethod ?? "—"}
                    </p>
                    <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-[#070e18]/95" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <p className="mt-3 text-center text-sm font-semibold text-slate-300">{year}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Less</span>
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-slate-700/65" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-sky-900/95" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-blue-700/90" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-blue-500/90" />
          <span className="h-2.5 w-2.5 rounded-[3px] border border-white/[0.08] bg-cyan-300/95" />
          <span>More</span>
        </div>

        <div className="grid gap-2 text-[13px] text-slate-200 sm:grid-cols-2 xl:grid-cols-5">
          <StatPill label="Daily average" value={formatMinutes(Math.round(dailyAverageMinutes))} />
          <StatPill label="Days learned" value={`${Math.round(daysLearnedPercent)}%`} meta={`${activeDays}/${daysElapsed} days`} />
          <StatPill label="Longest streak" value={`${streaks.longest} day${streaks.longest === 1 ? "" : "s"}`} />
          <StatPill label="Current streak" value={`${streaks.current} day${streaks.current === 1 ? "" : "s"}`} />
          <StatPill label="Total tracked" value={formatMinutes(totalStudyMinutes)} />
        </div>
      </div>

      {selectedDate ? (
        <ModalShell
          onClose={() => setSelectedDate(null)}
          position="center"
          titleId="overview-heatmap-day-title"
          contentClassName="max-w-[860px]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Day details</p>
              <h4 id="overview-heatmap-day-title" className="mt-2 text-2xl font-semibold text-white">
                {formatLongDate(selectedDate)}
              </h4>
              <p className="mt-2 text-sm text-slate-300">
                {formatMinutes(selectedActivity?.studyMinutes ?? 0)} study time · {selectedActivity?.studySessionCount ?? 0} study session{(selectedActivity?.studySessionCount ?? 0) === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Top method: {selectedActivity?.topMethod ?? "—"}
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

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3">
              <div className="rounded-[14px] border border-white/10 bg-white/[0.025] p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Method breakdown</p>
                {selectedActivity?.methodBreakdown.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {selectedActivity.methodBreakdown.slice(0, 5).map((entry) => (
                      <li key={entry.method} className="flex items-center justify-between gap-3 text-sm text-slate-200">
                        <span className="truncate">{entry.method}</span>
                        <span className="shrink-0 tabular-nums text-slate-300">{formatMinutes(entry.minutes)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No study sessions on this day.</p>
                )}
              </div>
            </div>

            <div className="rounded-[14px] border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Session log</p>
              {selectedActivity?.allSessions.length ? (
                <div className="mt-2 max-h-[340px] space-y-2 overflow-y-auto pr-1">
                  {selectedActivity.allSessions.map((session) => {
                    const { label, isAuto } = splitAutoSessionMethodLabel(session.method);
                    const minutes = Math.max(0, Math.round(session.hours * 60));
                    return (
                      <div
                        key={session.id}
                        className="rounded-[12px] border border-white/10 bg-slate-950/50 px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-100">{label}</span>
                          <span className="text-sm tabular-nums text-slate-300">{formatMinutes(minutes)}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {isAuto ? (
                            <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-200">
                              auto
                            </span>
                          ) : null}
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
        </ModalShell>
      ) : null}
    </section>
  );
}

function StatPill({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.025] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-cyan-100">{value}</p>
      {meta ? <p className="mt-0.5 text-[10px] text-slate-500">{meta}</p> : null}
    </div>
  );
}

export function OverviewActivityHeatmap() {
  return (
    <TimeFolioStoreProvider>
      <OverviewActivityHeatmapBody />
    </TimeFolioStoreProvider>
  );
}
