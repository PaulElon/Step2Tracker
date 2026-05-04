import { useState } from "react";
import { AppWindowMac, ArrowUpRight } from "lucide-react";
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
}: {
  taskTitle: string;
  taskCategory: string;
}) {
  const { state } = useAppStore();
  const resource = findMatchingResource(taskTitle, taskCategory, state.preferences.resourceLinks);
  const [error, setError] = useState<string | null>(null);

  if (!resource) {
    return null;
  }

  const Icon = resource.kind === "app" ? AppWindowMac : ArrowUpRight;

  async function handleClick() {
    setError(null);
    try {
      await launchResource(resource!.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="launch-button"
        aria-label={`Open ${resource.label} for ${taskTitle}`}
        onClick={() => void handleClick()}
      >
        <Icon className="h-4 w-4" />
        Open {resource.label}
      </button>
      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
