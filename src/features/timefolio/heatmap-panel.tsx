import { useState } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { totalsByDay } from "../../lib/tf-session-adapters";
import { formatLongDate } from "../../lib/datetime";
import { TimeFolioHeatmap } from "../../components/timefolio-heatmap";
import type { TfSessionLog } from "../../types/models";

function SessionRow({ session }: { session: TfSessionLog }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-200">{session.method}</span>
        {session.notes && (
          <span className="text-xs text-slate-500 line-clamp-1">{session.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        {session.isDistraction && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-red-500/20 text-red-400">
            distraction
          </span>
        )}
        <span className="text-sm font-semibold tabular-nums text-slate-300">
          {session.hours}h
        </span>
      </div>
    </div>
  );
}

export function HeatmapPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
  const [selectedDate, setSelectedDate] = useState<string | undefined>();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
        {error}
      </div>
    );
  }

  const { sessionLogs } = state;
  const dailyHours = totalsByDay(sessionLogs);

  const selectedSessions = selectedDate
    ? sessionLogs.filter((s) => s.date === selectedDate)
    : [];
  const selectedHours = selectedDate ? (dailyHours[selectedDate] ?? 0) : 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Activity Heatmap
        </p>
        {sessionLogs.length === 0 ? (
          <p className="text-sm text-slate-500">No sessions logged yet.</p>
        ) : (
          <TimeFolioHeatmap
            dailyHours={dailyHours}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        )}
      </div>

      {selectedDate && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-700/60 bg-slate-800/40 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-slate-200">
              {formatLongDate(selectedDate)}
            </span>
            <span className="text-xs font-semibold tabular-nums text-violet-300">
              {selectedHours > 0 ? `${selectedHours}h total` : "No activity"}
            </span>
          </div>

          {selectedSessions.length === 0 ? (
            <p className="text-sm text-slate-500">No sessions on this date.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedSessions.map((s) => (
                <SessionRow key={s.id} session={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
