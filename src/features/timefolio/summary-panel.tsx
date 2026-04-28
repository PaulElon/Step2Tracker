import { useState, useMemo } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { allocationByMethod } from "../../lib/tf-session-adapters";
import type { TfSessionLog } from "../../types/models";

type Range = "today" | "7d" | "30d";

const RANGE_LABELS: Record<Range, string> = {
  today: "Today",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function filterByRange(logs: TfSessionLog[], range: Range): TfSessionLog[] {
  const now = new Date();
  const todayKey = toDateKey(now);

  if (range === "today") {
    return logs.filter((s) => s.date === todayKey);
  }

  const days = range === "7d" ? 7 : 30;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffKey = toDateKey(cutoff);
  return logs.filter((s) => s.date >= cutoffKey && s.date <= todayKey);
}

function buildNarrative(params: {
  range: Range;
  totalHours: number;
  sessionCount: number;
  topMethod: string | null;
  focusRate: number | null;
}): string {
  const { range, totalHours, sessionCount, topMethod, focusRate } = params;
  const rangeLabel = range === "today" ? "today" : range === "7d" ? "over the last 7 days" : "over the last 30 days";

  if (sessionCount === 0) {
    return `No sessions logged ${rangeLabel}. Log a session to see your summary.`;
  }

  const hoursText = totalHours === 1 ? "1 hour" : `${totalHours.toFixed(1)} hours`;
  const sessionText = sessionCount === 1 ? "1 session" : `${sessionCount} sessions`;

  let narrative = `You logged ${hoursText} across ${sessionText} ${rangeLabel}.`;

  if (topMethod) {
    narrative += ` Your primary study method was ${topMethod}.`;
  }

  if (focusRate !== null) {
    if (focusRate >= 90) {
      narrative += ` Excellent focus — ${focusRate.toFixed(0)}% of your time was distraction-free.`;
    } else if (focusRate >= 70) {
      narrative += ` Good focus with ${focusRate.toFixed(0)}% distraction-free time.`;
    } else {
      narrative += ` Focus rate was ${focusRate.toFixed(0)}% — consider reducing distractions in future sessions.`;
    }
  }

  return narrative;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800 p-5 flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-semibold text-slate-100">{value}</span>
      {sub && <span className="text-xs text-slate-500">{sub}</span>}
    </div>
  );
}

export function SummaryPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
  const [range, setRange] = useState<Range>("7d");

  const filtered = useMemo(
    () => filterByRange(state.sessionLogs, range),
    [state.sessionLogs, range]
  );

  const metrics = useMemo(() => {
    if (filtered.length === 0) {
      return { totalHours: 0, sessionCount: 0, topMethod: null, focusHours: 0, distractionHours: 0, focusRate: null };
    }

    const totalHours = filtered.reduce((sum, s) => sum + s.hours, 0);
    const focusHours = filtered.filter((s) => !s.isDistraction).reduce((sum, s) => sum + s.hours, 0);
    const distractionHours = filtered.filter((s) => s.isDistraction).reduce((sum, s) => sum + s.hours, 0);
    const hasDistraction = filtered.some((s) => s.isDistraction);
    const focusRate = hasDistraction && totalHours > 0 ? (focusHours / totalHours) * 100 : null;

    const byMethod = allocationByMethod(filtered);
    const topMethod = byMethod.length > 0 ? byMethod[0].method : null;

    return { totalHours, sessionCount: filtered.length, topMethod, focusHours, distractionHours, focusRate };
  }, [filtered]);

  const narrative = useMemo(
    () =>
      buildNarrative({
        range,
        totalHours: metrics.totalHours,
        sessionCount: metrics.sessionCount,
        topMethod: metrics.topMethod,
        focusRate: metrics.focusRate,
      }),
    [range, metrics]
  );

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-400">Error: {error}</div>;
  }

  return (
    <div className="p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-200">Summary</h2>
        <div className="flex gap-1 rounded-lg bg-slate-800 border border-slate-700 p-1">
          {(["today", "7d", "30d"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                range === r
                  ? "bg-indigo-600 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Hours" value={metrics.totalHours.toFixed(1)} />
        <StatCard label="Sessions" value={String(metrics.sessionCount)} />
        <StatCard
          label="Top Method"
          value={metrics.topMethod ?? "—"}
        />
        {metrics.focusRate !== null ? (
          <StatCard
            label="Focus Rate"
            value={`${metrics.focusRate.toFixed(0)}%`}
            sub={`${metrics.distractionHours.toFixed(1)}h distraction`}
          />
        ) : (
          <StatCard label="Focus Rate" value="—" sub="No distraction data" />
        )}
      </div>

      {metrics.sessionCount === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-6 text-center text-slate-500 text-sm">
          No sessions logged for {RANGE_LABELS[range].toLowerCase()}.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Generated Narrative</span>
          <p className="text-slate-200 text-sm leading-relaxed">{narrative}</p>
        </div>
      )}
    </div>
  );
}
