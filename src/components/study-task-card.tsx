import { Bell, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { formatDateTimeLabel, formatMinutes, formatShortDate } from "../lib/datetime";
import { getStudyBlockMinutes } from "../lib/analytics";
import { CategoryBadge } from "./ui";
import { TaskLaunchButton } from "./task-launch-button";
import type { StudyBlock } from "../types/models";

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
      className={`rounded-[22px] border border-white/10 bg-slate-900/55 transition ${
        compact ? "p-4" : "p-5"
      } ${block.completed ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-4">
        <label className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={block.completed}
            onChange={(event) => onToggleComplete(event.target.checked)}
            aria-label={`Mark ${block.task} complete`}
            className="h-5 w-5 rounded border-white/15 bg-slate-950 text-cyan-300"
          />
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={block.category} />
            {showDate ? (
              <span className="inline-flex items-center rounded-full border border-white/10 px-2.5 py-1 text-xs text-slate-300">
                {formatShortDate(block.date)}
              </span>
            ) : null}
          </div>
          <h4
            className={`mt-1.5 text-base font-semibold text-white ${block.completed ? "line-through decoration-white/45" : ""}`}
          >
            {block.task}
          </h4>
          {showNotes && block.notes ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{block.notes}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3 text-slate-300">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <Clock3 className="h-3.5 w-3.5 text-slate-500" />
            {durationLabel}
          </span>
          {block.reminderAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Bell className="h-3.5 w-3.5 text-cyan-300" />
              {formatDateTimeLabel(block.reminderAt)}
            </span>
          ) : null}
          <TaskLaunchButton taskTitle={block.task} taskCategory={block.category} />
          {actionSlot ? actionSlot : null}
        </div>
      </div>
    </article>
  );
}
