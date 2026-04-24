import { addDays, getDayName, getTodayKey, startOfWeek } from "../lib/datetime";
import { cn } from "../lib/ui";

function intensityClass(minutes: number) {
  if (minutes >= 360) {
    return "bg-cyan-200";
  }

  if (minutes >= 240) {
    return "bg-cyan-300/80";
  }

  if (minutes >= 120) {
    return "bg-cyan-300/55";
  }

  if (minutes > 0) {
    return "bg-cyan-300/30";
  }

  return "bg-white/[0.03]";
}

const rowLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function longestActiveStreak(columns: string[][], activityByDate: Record<string, number>) {
  let longest = 0;
  let current = 0;

  for (const date of columns.flat()) {
    if ((activityByDate[date] ?? 0) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

export function ConsistencyHeatmap({
  activityByDate,
  weeks = 12,
  referenceDate = getTodayKey(),
}: {
  activityByDate: Record<string, number>;
  weeks?: number;
  referenceDate?: string;
}) {
  const endOfCurrentWeek = addDays(startOfWeek(referenceDate, 1), 6);
  const start = addDays(startOfWeek(endOfCurrentWeek, 1), -(weeks - 1) * 7);
  const columns = Array.from({ length: weeks }, (_, weekIndex) =>
    Array.from({ length: 7 }, (_, dayIndex) => addDays(start, weekIndex * 7 + dayIndex)),
  );
  const visibleDates = columns.flat();
  const activeDays = visibleDates.filter((date) => (activityByDate[date] ?? 0) > 0);
  const totalMinutes = visibleDates.reduce((total, date) => total + (activityByDate[date] ?? 0), 0);
  const longestStreak = longestActiveStreak(columns, activityByDate);

  return (
    <figure>
      <figcaption className="mb-3 text-sm text-slate-400">
        {activeDays.length
          ? `${activeDays.length} active study days across the last ${weeks} weeks, totaling ${Math.round(totalMinutes / 60)} hours. Longest active streak: ${longestStreak} day${longestStreak === 1 ? "" : "s"}.`
          : `No study time is logged across the last ${weeks} weeks.`}
      </figcaption>
      <div
        aria-hidden="true"
        className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))] gap-2 text-[11px] text-slate-500"
      >
        <div />
        {columns.map((column) => (
          <div key={column[0]} className="text-center uppercase tracking-[0.16em]">
            {column[0].slice(5, 7)}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-3 grid grid-cols-[auto_repeat(12,minmax(0,1fr))] gap-2">
        {rowLabels.map((label, rowIndex) => (
          <div key={label} className="contents">
            <div className="flex items-center pr-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              {label}
            </div>
            {columns.map((column) => {
              const dateKey = column[rowIndex];
              const minutes = activityByDate[dateKey] ?? 0;
              const isToday = dateKey === referenceDate;
              return (
                <div
                  key={dateKey}
                  aria-label={`${getDayName(dateKey)} ${dateKey}: ${Math.round(minutes / 60)} hours logged`}
                  className={cn(
                    "aspect-square rounded-lg border border-white/6 transition",
                    intensityClass(minutes),
                    isToday ? "ring-1 ring-cyan-300/50" : "",
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span>Last {weeks} weeks of study density</span>
        <div className="flex items-center gap-2">
          <span>0h</span>
          <span className="h-2.5 w-2.5 rounded-full bg-white/[0.03]" />
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-300/30" />
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-300/55" />
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-200" />
          <span>6h+</span>
        </div>
      </div>
    </figure>
  );
}
