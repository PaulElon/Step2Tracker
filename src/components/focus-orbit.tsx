import type { ThemeDefinition } from "../lib/themes";
import { formatHoursValue, formatMinutes } from "../lib/datetime";

interface OrbitSlice {
  label: string;
  minutes: number;
  completedMinutes: number;
}

function toPercent(value: number) {
  return Math.round(value * 100);
}

export function FocusOrbit({
  slices,
  totalMinutes,
  activeWeakTopics,
  theme,
}: {
  slices: OrbitSlice[];
  totalMinutes: number;
  activeWeakTopics: number;
  theme: ThemeDefinition;
}) {
  const visibleSlices = slices.filter((slice) => slice.minutes > 0).slice(0, 5);
  const totalCompletedMinutes = visibleSlices.reduce((total, slice) => total + slice.completedMinutes, 0);
  const topSlice = visibleSlices[0];
  const colors = [
    theme.chart.primary,
    theme.chart.secondary,
    theme.chart.tertiary,
    theme.chart.warm,
    theme.chart.success,
  ];

  if (!visibleSlices.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.025] px-5 py-8 text-sm text-slate-300">
        Add study blocks to see which categories are taking the plan over.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="panel-subtle">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Top concentration</p>
          <p className="mt-3 text-lg font-semibold text-white">{topSlice?.label ?? "None yet"}</p>
          <p className="mt-2 text-sm text-slate-300">
            {topSlice ? `${formatMinutes(topSlice.minutes)} · ${toPercent(topSlice.minutes / Math.max(totalMinutes, 1))}% of plan` : "No scheduled focus area"}
          </p>
        </div>

        <div className="panel-subtle">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Completed</p>
          <p className="mt-3 text-lg font-semibold text-white">{formatHoursValue(totalCompletedMinutes)}</p>
          <p className="mt-2 text-sm text-slate-300">
            {toPercent(totalCompletedMinutes / Math.max(totalMinutes, 1))}% of scheduled study time finished
          </p>
        </div>

        <div className="panel-subtle">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Active weak topics</p>
          <p className="mt-3 text-lg font-semibold text-white">{activeWeakTopics}</p>
          <p className="mt-2 text-sm text-slate-300">Current risk count.</p>
        </div>
      </div>

      <div className="space-y-3">
        {visibleSlices.map((slice, index) => {
          const shareRatio = slice.minutes / Math.max(totalMinutes, 1);
          const completionRatio = slice.completedMinutes / Math.max(slice.minutes, 1);

          return (
            <div key={slice.label} className="panel-subtle">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <p className="truncate text-sm font-semibold text-white">{slice.label}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {formatMinutes(slice.completedMinutes)} done · {toPercent(completionRatio)}% complete
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{formatMinutes(slice.minutes)}</p>
                  <p className="mt-1 text-xs text-slate-400">{toPercent(shareRatio)}% of plan</p>
                </div>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(shareRatio * 100, 12)}%`,
                    background: `linear-gradient(90deg, ${colors[index % colors.length]}, rgba(255,255,255,0.28))`,
                  }}
                >
                  <div
                    className="h-full rounded-full bg-white/90"
                    style={{
                      width: `${completionRatio > 0 ? Math.max(completionRatio * 100, 8) : 0}%`,
                      opacity: 0.9,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
