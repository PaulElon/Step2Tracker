import { useState } from "react";
import { useAppStore } from "../state/app-store";
import { launchResource } from "../lib/launcher";
import type { ResourceLink } from "../types/models";

function findMatchingResource(
  taskName: string,
  category: string,
  resourceLinks: ResourceLink[],
): ResourceLink | null {
  const haystack = `${taskName} ${category}`.toLowerCase();
  let best: ResourceLink | null = null;
  for (const link of resourceLinks) {
    if (haystack.includes(link.label.toLowerCase())) {
      if (!best || link.label.length > best.label.length) {
        best = link;
      }
    }
  }
  return best;
}

export function TaskLaunchButton({
  taskTitle,
  taskCategory,
  variant = "default",
}: {
  taskTitle: string;
  taskCategory: string;
  variant?: "default" | "compact";
}) {
  const { state } = useAppStore();
  const resource = findMatchingResource(taskTitle, taskCategory, state.preferences.resourceLinks);
  const [error, setError] = useState<string | null>(null);

  if (!resource) {
    return null;
  }

  async function handleClick() {
    setError(null);
    try {
      await launchResource(resource!.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const buttonClassName = variant === "compact"
    ? "inline-flex max-w-[130px] items-center overflow-hidden truncate rounded-full border border-white/[0.12] px-2 py-0.5 text-[11px] font-medium text-slate-400 transition hover:border-white/20 hover:text-slate-200"
    : "launch-button";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className={buttonClassName}
        aria-label={`Open ${resource.label} for ${taskTitle}`}
        onClick={() => void handleClick()}
      >
        <span className="truncate">Open {resource.label}</span>
      </button>
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
