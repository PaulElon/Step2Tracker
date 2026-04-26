import { AppWindowMac, ArrowUpRight } from "lucide-react";
import { useAppStore } from "../state/app-store";
import { openLaunchTarget } from "../lib/study-workflow";
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

  if (!resource) {
    return null;
  }

  const Icon = resource.kind === "app" ? AppWindowMac : ArrowUpRight;

  return (
    <button
      type="button"
      className="launch-button"
      aria-label={`Open ${resource.label} for ${taskTitle}`}
      onClick={() => {
        void openLaunchTarget({
          label: `Open ${resource.label}`,
          href: resource.url,
          mode: resource.kind === "app" ? "path" : "url",
        });
      }}
    >
      <Icon className="h-4 w-4" />
      Open {resource.label}
    </button>
  );
}
