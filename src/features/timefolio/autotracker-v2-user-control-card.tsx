import { Play, Save } from "lucide-react";

export type AutoTrackerV2UserControlStripProps = {
  isRunning: boolean;
  isActionBusy: boolean;
  onStart: () => void;
  onStopAndSave: () => void;
};

function buttonClassName(isRunning: boolean, disabled: boolean): string {
  const toneClass = isRunning
    ? "border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20";

  return [
    "inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors",
    toneClass,
    disabled ? "cursor-not-allowed opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function AutoTrackerV2UserControlStrip({
  isRunning,
  isActionBusy,
  onStart,
  onStopAndSave,
}: AutoTrackerV2UserControlStripProps) {
  return (
    <button
      type="button"
      onClick={isRunning ? onStopAndSave : onStart}
      disabled={isActionBusy}
      className={buttonClassName(isRunning, isActionBusy)}
    >
      {isRunning ? <Save className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      {isRunning ? "Stop & Save Auto-Tracked Session" : "Start Auto-Tracking"}
    </button>
  );
}
