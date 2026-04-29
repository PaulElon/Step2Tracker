import { useState } from "react";
import { cn } from "../lib/ui";
import {
  addMonths,
  formatMonthLabel,
  getMonthGridDates,
  getTodayKey,
  parseDateKey,
  startOfMonth,
} from "../lib/datetime";

interface TimeFolioHeatmapProps {
  dailyHours: Record<string, number>;
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function intensityClass(hours: number): string {
  if (hours >= 6) return "bg-violet-400/90";
  if (hours >= 3) return "bg-violet-400/60";
  if (hours >= 1) return "bg-violet-400/35";
  if (hours > 0) return "bg-violet-400/20";
  return "bg-white/[0.04]";
}

export function TimeFolioHeatmap({
  dailyHours,
  selectedDate,
  onSelectDate,
}: TimeFolioHeatmapProps) {
  const today = getTodayKey();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));

  const currentMonthPrefix = viewMonth.slice(0, 7);
  const gridDates = getMonthGridDates(viewMonth, 1);
  const monthLabel = formatMonthLabel(viewMonth);

  const canGoNext = addMonths(viewMonth, 1).slice(0, 7) <= today.slice(0, 7);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[15px] font-semibold leading-none text-slate-300 transition hover:bg-white/5 hover:text-slate-100"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-slate-100">{monthLabel}</span>
        <button
          type="button"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          disabled={!canGoNext}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-[15px] font-semibold leading-none text-slate-300 transition",
            canGoNext ? "hover:bg-white/5 hover:text-slate-100" : "cursor-default opacity-40",
          )}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-[9px] uppercase tracking-wider text-slate-500"
          >
            {d[0]}
          </div>
        ))}
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-7 grid-rows-6 gap-px">
        {gridDates.map((date) => {
          const isCurrentMonth = date.startsWith(currentMonthPrefix);
          const hours = dailyHours[date] ?? 0;
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const dayNum = parseDateKey(date).getDate();

          return (
            <button
              key={date}
              type="button"
              onClick={() => isCurrentMonth && onSelectDate?.(date)}
              disabled={!isCurrentMonth}
              title={
                isCurrentMonth && hours > 0
                  ? `${date}: ${hours}h`
                  : isCurrentMonth
                    ? date
                    : undefined
              }
              className={cn(
                "relative flex h-full min-h-0 flex-col items-center justify-center rounded-md transition",
                intensityClass(isCurrentMonth ? hours : 0),
                isCurrentMonth
                  ? "cursor-pointer hover:brightness-125"
                  : "cursor-default opacity-20",
                isToday && "ring-1 ring-violet-400/60",
                isSelected && "ring-2 ring-violet-300/80",
              )}
            >
              <span
                className={cn(
                  "text-[10px] font-medium leading-none",
                  isCurrentMonth && hours > 0 ? "text-white" : "text-slate-500",
                  isToday && "text-violet-300",
                  isSelected && "text-white",
                )}
              >
                {dayNum}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-0.5 text-[9px] text-slate-500">
        <span>Less</span>
        <span className="h-2 w-2 rounded-sm bg-violet-400/20" />
        <span className="h-2 w-2 rounded-sm bg-violet-400/35" />
        <span className="h-2 w-2 rounded-sm bg-violet-400/60" />
        <span className="h-2 w-2 rounded-sm bg-violet-400/90" />
        <span>More</span>
      </div>
    </div>
  );
}
