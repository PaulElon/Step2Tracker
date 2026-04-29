import { formatMinutes } from "../../lib/datetime";
import { useTimeFolioStore } from "../../state/tf-store";

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

export function OverviewPanel() {
  const { state, isLoading, error } = useTimeFolioStore();

  if (isLoading) {
    return (
      <div className="p-8">
        <PanelState
          title="Loading overview"
          description="Fetching the latest TimeFolio summary."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <PanelState title="Overview unavailable" description={error} tone="error" />
      </div>
    );
  }

  const { sessionLogs, summaries } = state;

  const totalHours = sessionLogs.reduce((sum, s) => sum + s.hours, 0);
  const latestDate = sessionLogs.length > 0
    ? sessionLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date
    : null;

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">Overview</h2>
        <p className="text-sm text-slate-500">Latest totals and session activity at a glance.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Hours" value={formatMinutes(Math.round(totalHours * 60))} />
        <StatCard label="Sessions" value={String(sessionLogs.length)} />
        <StatCard label="Latest session date" value={latestDate ?? "No sessions yet"} />
        <StatCard label="Summaries" value={String(summaries.length)} />
      </div>
    </div>
  );
}
