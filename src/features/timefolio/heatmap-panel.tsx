import { useState } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import { totalsByDay } from "../../lib/tf-session-adapters";
import { formatLongDate, formatMinutes } from "../../lib/datetime";
import { TimeFolioHeatmap } from "../../components/timefolio-heatmap";
import type { TfSessionLog } from "../../types/models";

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

function SessionRow({ session }: { session: TfSessionLog }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-700/70 bg-slate-900/20 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-slate-100">{session.method}</span>
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
          {formatMinutes(Math.round(session.hours * 60))}
        </span>
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  maxVisibleRows,
}: {
  sessions: TfSessionLog[];
  maxVisibleRows: number;
}) {
  return (
    <div
      className="flex min-h-0 flex-col gap-2 overflow-y-auto pr-1"
      style={{ maxHeight: `${maxVisibleRows * 3.25}rem` }}
    >
      {sessions.map((session) => (
        <SessionRow key={session.id} session={session} />
      ))}
    </div>
  );
}

function SelectedDaySessionModal({
  selectedDate,
  selectedHours,
  selectedSessions,
  onClose,
}: {
  selectedDate: string;
  selectedHours: number;
  selectedSessions: TfSessionLog[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-3xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-3xl border border-slate-700/80 bg-slate-900/95 shadow-2xl shadow-slate-950/50"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Session log"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-700/70 px-5 py-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              SESSION LOG
            </div>
            <div className="text-sm font-semibold text-slate-100">
              {formatLongDate(selectedDate)}
            </div>
            <div className="text-xs font-semibold tabular-nums text-violet-300">
              {selectedHours > 0
                ? `${formatMinutes(Math.round(selectedHours * 60))} total`
                : "No activity"}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/70 text-slate-400 transition hover:bg-white/5 hover:text-slate-100"
            aria-label="Close session log"
          >
            ×
          </button>
        </div>

        <div className="flex-1 px-5 py-4">
          {selectedSessions.length === 0 ? (
            <p className="text-sm leading-6 text-slate-500">
              No sessions recorded for this day.
            </p>
          ) : (
            <SessionList sessions={selectedSessions} maxVisibleRows={15} />
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedDaySessionLog({
  selectedDate,
  selectedHours,
  selectedSessions,
}: {
  selectedDate?: string;
  selectedHours: number;
  selectedSessions: TfSessionLog[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasSelection = Boolean(selectedDate);

  return (
    <>
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/60 p-5 shadow-sm shadow-slate-950/20">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              SESSION LOG
            </div>
            <div className="text-sm font-semibold text-slate-100">
              {selectedDate ? formatLongDate(selectedDate) : "No day selected"}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold tabular-nums text-violet-300">
              {selectedDate
                ? selectedHours > 0
                  ? `${formatMinutes(Math.round(selectedHours * 60))} total`
                  : "No activity"
                : "Select a day"}
            </span>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              disabled={!hasSelection}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/70 text-slate-400 transition hover:bg-white/5 hover:text-slate-100 disabled:cursor-default disabled:opacity-30"
              aria-label="Open session log"
              title="Open session log"
            >
              ↗
            </button>
          </div>
        </div>

        {!hasSelection ? (
          <p className="text-sm leading-6 text-slate-500">
            Select a day to inspect sessions.
          </p>
        ) : selectedSessions.length === 0 ? (
          <p className="text-sm leading-6 text-slate-500">
            No sessions recorded for this day.
          </p>
        ) : (
          <SessionList sessions={selectedSessions} maxVisibleRows={5} />
        )}
      </div>

      {isExpanded && hasSelection && selectedDate && (
        <SelectedDaySessionModal
          selectedDate={selectedDate}
          selectedHours={selectedHours}
          selectedSessions={selectedSessions}
          onClose={() => setIsExpanded(false)}
        />
      )}
    </>
  );
}

export function HeatmapPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
  const [selectedDate, setSelectedDate] = useState<string | undefined>();

  if (isLoading) {
    return (
      <div className="p-8">
        <PanelState
          title="Loading heatmap"
          description="Preparing the TimeFolio activity calendar."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <PanelState title="Heatmap unavailable" description={error} tone="error" />
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
    <div className="flex h-full min-h-0 flex-col gap-6 p-8">
      <div className="shrink-0 space-y-1">
        <h2 className="text-lg font-semibold text-slate-100">Heatmap</h2>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800/50 p-5">
        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[minmax(0,3fr)_minmax(18rem,1fr)] lg:items-stretch">
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
            {sessionLogs.length === 0 ? (
              <p className="text-sm leading-6 text-slate-500">
                No sessions yet. Log a TimeFolio session to fill the calendar.
              </p>
            ) : (
              <TimeFolioHeatmap
                dailyHours={dailyHours}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            )}
          </div>

          <SelectedDaySessionLog
            selectedDate={selectedDate}
            selectedHours={selectedHours}
            selectedSessions={selectedSessions}
          />
        </div>
      </div>
    </div>
  );
}
