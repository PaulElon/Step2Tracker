import { formatDateKey, formatMonthLabel, getTodayKey, parseDateKey } from "../lib/datetime";
import { cn } from "../lib/ui";

const weekDayLabels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

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
    return "bg-cyan-300/35";
  }

  return "bg-transparent";
}

export function MiniCalendar({
  activityByDate,
  referenceDate = getTodayKey(),
}: {
  activityByDate: Record<string, number>;
  referenceDate?: string;
}) {
  const activeDate = parseDateKey(referenceDate);
  const firstOfMonth = new Date(activeDate.getFullYear(), activeDate.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

  const monthLabel = formatMonthLabel(referenceDate);
  const todayKey = getTodayKey();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const dateKey = formatDateKey(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
    const date = parseDateKey(dateKey);
    return {
      dateKey,
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === activeDate.getMonth(),
      isToday: dateKey === todayKey,
      minutes: activityByDate[dateKey] ?? 0,
    };
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-lg font-semibold text-white">{monthLabel}</p>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Schedule density</p>
      </div>
      <div className="grid grid-cols-7 gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
        {weekDayLabels.map((label) => (
          <div key={label} className="px-1 text-center">
            {label}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-7 gap-2">
        {cells.map((cell) => (
          <div
            key={cell.dateKey}
            className={cn(
              "flex aspect-square flex-col items-center justify-center rounded-2xl border text-sm transition",
              cell.isCurrentMonth ? "border-white/10 bg-white/[0.03]" : "border-transparent bg-transparent text-slate-600",
              cell.isToday ? "ring-1 ring-cyan-300/45" : "",
            )}
            title={`${cell.dateKey} · ${Math.round(cell.minutes / 60)}h scheduled`}
          >
            <span className={cn("text-sm", cell.isCurrentMonth ? "text-slate-200" : "text-slate-600")}>
              {cell.dayNumber}
            </span>
            <span className={cn("mt-2 h-1.5 w-1.5 rounded-full", intensityClass(cell.minutes))} />
          </div>
        ))}
      </div>
    </div>
  );
}
