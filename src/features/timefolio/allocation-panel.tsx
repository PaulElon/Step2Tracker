import { useMemo } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { allocationByMethod } from "../../lib/tf-session-adapters";
import { formatMinutes } from "../../lib/datetime";

function PanelState({
  title,
  description,
  tone = "neutral",
}: {
  title: string;
  description: string;
  tone?: "neutral" | "error";
}) {
  const toneClasses =
    tone === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : "border-slate-700/80 bg-slate-800/60 text-slate-200";

  return (
    <div className={`rounded-2xl border px-5 py-4 ${toneClasses}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
    </div>
  );
}

export function AllocationPanel() {
  const { state, isLoading, error } = useTimeFolioStore();

  const rows = useMemo(
    () => allocationByMethod(state.sessionLogs),
    [state.sessionLogs]
  );

  const totalHours = useMemo(
    () => rows.reduce((sum, r) => sum + r.hours, 0),
    [rows]
  );

  const totalSessions = useMemo(
    () => rows.reduce((sum, r) => sum + r.sessionCount, 0),
    [rows]
  );

  if (isLoading) {
    return (
      <div className="p-8">
        <PanelState
          title="Loading allocation"
          description="Calculating TimeFolio hours by study method."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <PanelState title="Allocation unavailable" description={error} tone="error" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8">
        <PanelState
          title="No allocation data yet"
          description="Log a TimeFolio session to see study time grouped by method."
        />
      </div>
    );
  }

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">Allocation</h2>
        <p className="text-sm text-slate-500">TimeFolio hours grouped by study method.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total Hours"
          value={formatMinutes(Math.round(totalHours * 60))}
        />
        <StatCard label="Methods" value={String(rows.length)} />
        <StatCard label="Sessions" value={String(totalSessions)} />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-700/80 bg-slate-800/40 p-5">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            By Method
          </div>
          <p className="text-sm text-slate-500">
            Bars scale to each method&apos;s share of total hours.
          </p>
        </div>
        {rows.map((row) => {
          const pct = totalHours > 0 ? (row.hours / totalHours) * 100 : 0;
          return (
            <div
              key={row.methodKey}
              className="rounded-xl border border-slate-700/70 bg-slate-900/20 p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-100">
                  {row.method}
                </span>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>{formatMinutes(Math.round(row.hours * 60))}</span>
                  <span>{row.sessionCount} session{row.sessionCount !== 1 ? "s" : ""}</span>
                  <span className="text-slate-300 font-semibold w-10 text-right">
                    {pct.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700/80 bg-slate-800/60 p-5 shadow-sm shadow-slate-950/20">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
        {label}
      </span>
      <span className="mt-3 block text-3xl font-semibold tracking-tight text-slate-100">
        {value}
      </span>
    </div>
  );
}
