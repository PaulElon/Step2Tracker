import { Bell, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { formatMinutes, formatShortDate } from "../lib/datetime";
import { getStudyBlockMinutes } from "../lib/analytics";
import { CategoryBadge } from "./ui";
import { TaskLaunchButton } from "./task-launch-button";
import type { StudyBlock } from "../types/models";

function formatCompactReminder(value: string): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function StudyTaskCard({
  block,
  onToggleComplete,
  actionSlot,
  showDate = false,
  showNotes = false,
  compact = false,
}: {
  block: StudyBlock;
  onToggleComplete: (completed: boolean) => void;
  actionSlot?: ReactNode;
  showDate?: boolean;
  showNotes?: boolean;
  compact?: boolean;
}) {
  const durationLabel = formatMinutes(getStudyBlockMinutes(block));

  return (
    <article
      className={`rounded-[18px] border border-white/10 bg-slate-900/50 transition ${
        compact ? "p-3" : "p-4"
      } ${block.completed ? "opacity-55" : ""}`}
    >
      <div className="flex items-start gap-3">
        <label className="mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={block.completed}
            onChange={(event) => onToggleComplete(event.target.checked)}
            aria-label={`Mark ${block.task} complete`}
            className="h-5 w-5 rounded border-white/15 bg-slate-950 text-cyan-300"
          />
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={`text-sm font-semibold leading-snug text-white ${
                block.completed ? "completed-task-title line-through decoration-white/30" : ""
              }`}
            >
              {block.task}
            </h4>
            {actionSlot ? <div className="shrink-0">{actionSlot}</div> : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <CategoryBadge category={block.category} />
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
              <Clock3 className="h-3 w-3 shrink-0" />
              {durationLabel}
            </span>
            {block.reminderAt ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Bell className="h-3 w-3 shrink-0 text-cyan-400/60" />
                {formatCompactReminder(block.reminderAt)}
              </span>
            ) : null}
            {showDate ? (
              <span className="text-[11px] text-slate-500">{formatShortDate(block.date)}</span>
            ) : null}
          </div>

          {showNotes && block.notes ? (
            <p className="mt-1.5 max-w-3xl text-xs leading-5 text-slate-400">{block.notes}</p>
          ) : null}

          <div className="mt-2">
            <TaskLaunchButton taskTitle={block.task} taskCategory={block.category} />
          </div>
        </div>
      </div>
    </article>
  );
}
