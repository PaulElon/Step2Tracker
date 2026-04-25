import { addDays, getTodayKey, startOfWeek } from "../lib/datetime";
import { cn } from "../lib/ui";

function intensityClass(minutes: number) {
  if (minutes >= 240) return "bg-cyan-200/90";
  if (minutes >= 120) return "bg-cyan-300/65";
  if (minutes >= 60) return "bg-cyan-300/40";
  if (minutes > 0) return "bg-cyan-300/20";
  return "bg-white/[0.04]";
}

const ROW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_LABELS = new Set(["Mon", "Wed", "Fri"]);

function longestActiveStreak(columns: string[][], activityByDate: Record<string, number>) {
  let longest = 0;
  let current = 0;
  for (const date of columns.flat()) {
    if ((activityByDate[date] ?? 0) > 0) {
      current++;
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

  // Month bands: group consecutive weeks by their starting month
  const monthBands = columns.reduce<Array<{ label: string; key: string; span: number }>>((bands, column) => {
    const key = column[0].slice(0, 7);
    const label = new Date(column[0] + "T00:00:00").toLocaleString("en", { month: "short" });
    const last = bands[bands.length - 1];
    if (last?.key === key) {
      last.span++;
      return bands;
    }
    return [...bands, { label, key, span: 1 }];
  }, []);

  return (
    <figure>
      <figcaption className="mb-4 text-xs text-slate-500">
        {activeDays.length
          ? `${activeDays.length} active days · ${Math.round(totalMinutes / 60)}h · ${longestStreak}d streak`
          : `No activity in the last ${weeks} weeks`}
      </figcaption>

      {/* Month band headers */}
      <div className="mb-1.5 flex gap-[3px] pl-[calc(2rem+3px)]" aria-hidden="true">
        {monthBands.map((band) => (
          <div
            key={band.key}
            className="min-w-0 overflow-hidden text-center text-[11px] uppercase tracking-[0.12em] text-slate-500"
            style={{ flex: band.span }}
          >
            {band.label}
          </div>
        ))}
      </div>

      {/* Cell grid */}
      <div
        aria-hidden="true"
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `2rem repeat(${weeks}, minmax(0, 1fr))` }}
      >
        {ROW_LABELS.map((label, rowIndex) => (
          <div key={label} className="contents">
            <div className="flex items-center text-[11px] text-slate-500">
              {SHOWN_LABELS.has(label) ? label : ""}
            </div>
            {columns.map((column) => {
              const dateKey = column[rowIndex];
              const minutes = activityByDate[dateKey] ?? 0;
              const isToday = dateKey === referenceDate;
              const dateLabel = new Date(dateKey + "T00:00:00").toLocaleDateString("en", {
                month: "short",
                day: "numeric",
              });
              return (
                <div
                  key={dateKey}
                  title={`${dateLabel}: ${minutes > 0 ? `${Math.round((minutes / 60) * 10) / 10}h` : "no activity"}`}
                  className={cn(
                    "aspect-square rounded-sm transition",
                    intensityClass(minutes),
                    isToday ? "ring-1 ring-cyan-300/60" : "",
                  )}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-slate-500">
        <span>Low</span>
        <span className="h-2.5 w-2.5 rounded-sm bg-cyan-300/20" />
        <span className="h-2.5 w-2.5 rounded-sm bg-cyan-300/65" />
        <span className="h-2.5 w-2.5 rounded-sm bg-cyan-200/90" />
        <span>High</span>
      </div>
    </figure>
  );
}
