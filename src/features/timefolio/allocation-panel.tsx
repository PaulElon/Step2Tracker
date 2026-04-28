import { useMemo } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { allocationByMethod } from "../../lib/tf-session-adapters";

export function AllocationPanel() {
  const { state, error } = useTimeFolioStore();

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

  if (error) {
    return (
      <div className="p-8 text-red-400 text-sm">
        Error loading sessions: {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 text-slate-400 text-sm">No TimeFolio sessions yet.</div>
    );
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Hours" value={`${totalHours.toFixed(1)}h`} />
        <StatCard label="Methods" value={String(rows.length)} />
        <StatCard label="Sessions" value={String(totalSessions)} />
      </div>

      {/* Method rows */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
          By Method
        </div>
        {rows.map((row) => {
          const pct = totalHours > 0 ? (row.hours / totalHours) * 100 : 0;
          return (
            <div
              key={row.methodKey}
              className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">
                  {row.method}
                </span>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <span>{row.hours.toFixed(1)}h</span>
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
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-semibold text-slate-100">{value}</span>
    </div>
  );
}
