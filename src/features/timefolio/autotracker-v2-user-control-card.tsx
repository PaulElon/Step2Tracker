import { Play, Save, Square } from "lucide-react";

export type AutoTrackerV2UserControlMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export type AutoTrackerV2UserControlCardProps = {
  isRunning: boolean;
  isSamplerActionBusy: boolean;
  isStopAndSaveBusy: boolean;
  lastDetectedAppName: string | null;
  lastSampleTimeMs: number | null;
  recoveryAvailable: boolean;
  recoveryDetail: string;
  message: AutoTrackerV2UserControlMessage;
  onStart: () => void;
  onStop: () => void;
  onStopAndSave: () => void;
};

function formatDateTimeFromMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function buttonClassName(tone: "start" | "stop" | "save", disabled: boolean): string {
  const toneClass =
    tone === "start"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
      : tone === "stop"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
        : "border-cyan-500/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20";

  return [
    "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
    toneClass,
    disabled ? "cursor-not-allowed opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function AutoTrackerV2UserControlCard({
  isRunning,
  isSamplerActionBusy,
  isStopAndSaveBusy,
  lastDetectedAppName,
  lastSampleTimeMs,
  recoveryAvailable,
  recoveryDetail,
  message,
  onStart,
  onStop,
  onStopAndSave,
}: AutoTrackerV2UserControlCardProps) {
  const isBusy = isSamplerActionBusy || isStopAndSaveBusy;
  const runningText = isRunning ? "Running" : "Stopped";
  const recoveryText = recoveryAvailable ? "Available" : "Not available";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Production control
          </div>
          <h4 className="mt-1 text-sm font-semibold text-slate-100">Auto-Tracker</h4>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Uses the proven native sampler and the Session Log write path.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={isBusy || isRunning}
            className={buttonClassName("start", isBusy || isRunning)}
          >
            <Play className="h-4 w-4" />
            Start Auto-Tracker
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={isBusy || !isRunning}
            className={buttonClassName("stop", isBusy || !isRunning)}
          >
            <Square className="h-4 w-4" />
            Stop Auto-Tracker
          </button>
          <button
            type="button"
            onClick={onStopAndSave}
            disabled={isBusy}
            className={buttonClassName("save", isBusy)}
          >
            <Save className="h-4 w-4" />
            Stop & save current session
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Status
          </div>
          <div className={`mt-1 text-sm font-semibold ${isRunning ? "text-emerald-300" : "text-slate-200"}`}>
            {runningText}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Last detected app
          </div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-100">
            {lastDetectedAppName ?? "None yet"}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Last sample time
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {formatDateTimeFromMs(lastSampleTimeMs)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
            Recovery available
          </div>
          <div className={`mt-1 text-sm font-semibold ${recoveryAvailable ? "text-cyan-300" : "text-slate-200"}`}>
            {recoveryText}
          </div>
        </div>
      </div>

      {recoveryDetail ? (
        <div className="text-xs leading-5 text-slate-400">{recoveryDetail}</div>
      ) : null}

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            message.tone === "error"
              ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
              : message.tone === "info"
                ? "border-slate-600 bg-slate-950/40 text-slate-200"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
          }`}
        >
          {message.text}
        </div>
      ) : null}
    </div>
  );
}
