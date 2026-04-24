import { formatHoursValue, formatMinutes } from "../lib/datetime";
import type { MomentumPoint } from "../lib/analytics";
import type { ThemeDefinition } from "../lib/themes";

function toPercent(value: number) {
  return Math.round(value * 100);
}

export function MomentumRibbon({
  points,
  theme,
}: {
  points: MomentumPoint[];
  theme: ThemeDefinition;
}) {
  const maxMinutes = Math.max(...points.map((point) => point.minutes), 1);
  const totalPlannedMinutes = points.reduce((total, point) => total + point.minutes, 0);
  const totalCompletedMinutes = points.reduce((total, point) => total + point.completedMinutes, 0);
  const overloadedDays = points.filter((point) => point.overloadMinutes > 0).length;
  const heaviestPoint = points.reduce<MomentumPoint | null>(
    (current, point) => (!current || point.minutes > current.minutes ? point : current),
    null,
  );

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Upcoming workload</p>
          <h4 className="mt-2 text-2xl font-semibold text-white">Planned vs completed</h4>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="panel-subtle px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Window completion</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {toPercent(totalCompletedMinutes / Math.max(totalPlannedMinutes, 1))}%
            </p>
            <p className="mt-1 text-sm text-slate-300">{formatHoursValue(totalCompletedMinutes)} completed</p>
          </div>

          <div className="panel-subtle px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Heaviest day</p>
            <p className="mt-2 text-lg font-semibold text-white">{heaviestPoint?.label ?? "No load"}</p>
            <p className="mt-1 text-sm text-slate-300">
              {heaviestPoint ? formatMinutes(heaviestPoint.minutes) : "Nothing scheduled"}
            </p>
          </div>

          <div className="panel-subtle px-4 py-3">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Over target</p>
            <p className="mt-2 text-lg font-semibold text-white">{overloadedDays}</p>
            <p className="mt-1 text-sm text-slate-300">{overloadedDays === 1 ? "day needs rebalancing" : "days need rebalancing"}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {points.map((point) => {
          const completionRatio = point.completedMinutes / Math.max(point.minutes, 1);
          const loadRatio = point.minutes / maxMinutes;
          const remainingMinutes = Math.max(point.minutes - point.completedMinutes, 0);

          return (
            <div key={point.date} className="panel-subtle">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{point.label}</p>
                    {point.overloadMinutes ? (
                      <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[0.7rem] font-medium uppercase tracking-[0.16em] text-amber-100">
                        {formatMinutes(point.overloadMinutes)} over target
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-300">
                    {point.blockCount} blocks · {point.categoryCount} categories · {formatMinutes(remainingMinutes)} remaining
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-sm font-semibold text-white">{formatMinutes(point.minutes)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatMinutes(point.completedMinutes)} done · {toPercent(completionRatio)}% complete
                  </p>
                </div>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(loadRatio * 100, point.minutes > 0 ? 12 : 0)}%`,
                    background: `linear-gradient(90deg, ${theme.chart.secondary}, rgba(255,255,255,0.22))`,
                  }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${completionRatio > 0 ? Math.max(completionRatio * 100, 8) : 0}%`,
                      background: `linear-gradient(90deg, ${theme.chart.primary}, rgba(255,255,255,0.92))`,
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
