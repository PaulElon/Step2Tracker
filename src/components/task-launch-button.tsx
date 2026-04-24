import { AppWindowMac, ArrowUpRight } from "lucide-react";
import { getTaskLaunchTarget, openLaunchTarget } from "../lib/study-workflow";

export function TaskLaunchButton({ taskTitle }: { taskTitle: string }) {
  const target = getTaskLaunchTarget(taskTitle);

  if (!target) {
    return null;
  }

  const Icon = target.mode === "path" ? AppWindowMac : ArrowUpRight;

  return (
    <button
      type="button"
      className="launch-button"
      aria-label={`${target.label} for ${taskTitle}`}
      onClick={() => {
        void openLaunchTarget(target);
      }}
    >
      <Icon className="h-4 w-4" />
      {target.label}
    </button>
  );
}
