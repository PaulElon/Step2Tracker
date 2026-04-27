import { useTimeFolioStore } from "../../state/tf-store";
import { formatLongDate } from "../../lib/datetime";

export function SessionLogPanel() {
  const { state, isLoading, error } = useTimeFolioStore();

  if (isLoading) {
    return <div className="p-8 text-slate-400">Loading sessions…</div>;
  }

  if (error) {
    return <div className="p-8 text-red-400">Error: {error}</div>;
  }

  const sessions = [...state.sessionLogs].sort(
    (a, b) => new Date(b.startISO).getTime() - new Date(a.startISO).getTime()
  );

  if (sessions.length === 0) {
    return <div className="p-8 text-slate-400">No TimeFolio sessions yet.</div>;
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      {sessions.map((s) => (
        <div key={s.id} className="rounded-lg border border-slate-700 bg-slate-800 p-4 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold text-slate-100">{s.method}</span>
            <div className="flex gap-1.5 items-center">
              {s.isDistraction && (
                <span className="text-xs rounded px-1.5 py-0.5 bg-red-900/60 text-red-300">distraction</span>
              )}
              {s.isLive && (
                <span className="text-xs rounded px-1.5 py-0.5 bg-green-900/60 text-green-300">live</span>
              )}
            </div>
          </div>
          <div className="flex gap-4 text-sm text-slate-400">
            <span>{formatLongDate(s.date)}</span>
            <span>{s.hours}h</span>
          </div>
          {s.notes && (
            <p className="text-sm text-slate-300 mt-1">{s.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}
