import { useTimeFolioStore } from "../../state/tf-store";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-semibold text-slate-100">{value}</span>
    </div>
  );
}

export function OverviewPanel() {
  const { state, isLoading, error } = useTimeFolioStore();

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-400">Error: {error}</div>;
  }

  const { sessionLogs, summaries } = state;

  const totalHours = sessionLogs.reduce((sum, s) => sum + s.hours, 0);
  const latestDate = sessionLogs.length > 0
    ? sessionLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;

  return (
    <div className="p-8 flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-slate-200">Overview</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Hours" value={totalHours.toFixed(1)} />
        <StatCard label="Sessions" value={String(sessionLogs.length)} />
        <StatCard label="Latest Session" value={latestDate ?? "No sessions yet"} />
        <StatCard label="Summaries" value={String(summaries.length)} />
      </div>
    </div>
  );
}
