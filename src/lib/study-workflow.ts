import type { StudyBlock } from "../types/models";

export type StudyLane = "review" | "content" | "assessment" | "recovery" | "admin";

interface LaunchTarget {
  label: string;
  href: string;
  mode: "url" | "path";
}

const launchMatchers: Array<{ matcher: RegExp; target: LaunchTarget }> = [
  {
    matcher: /uworld/i,
    target: {
      label: "Start UWorld",
      href: "https://www.uworld.com/app/index.html#/login/",
      mode: "url",
    },
  },
  {
    matcher: /truelearn/i,
    target: {
      label: "Open TrueLearn",
      href: "https://member.truelearn.net/",
      mode: "url",
    },
  },
  {
    matcher: /anki/i,
    target: {
      label: "Open Anki",
      href: "/Applications/Anki.app",
      mode: "path",
    },
  },
];

function workflowText(blockOrText: Pick<StudyBlock, "category" | "task" | "notes"> | string) {
  if (typeof blockOrText === "string") {
    return blockOrText.toLowerCase();
  }

  return `${blockOrText.category} ${blockOrText.task} ${blockOrText.notes}`.toLowerCase();
}

export function getTaskLaunchTarget(taskTitle: string) {
  return launchMatchers.find((entry) => entry.matcher.test(taskTitle))?.target ?? null;
}

export async function openLaunchTarget(target: LaunchTarget) {
  const maybeTauri = window as Window & {
    __TAURI__?: {
      opener?: {
        openPath?: (path: string) => Promise<void>;
        openUrl?: (url: string) => Promise<void>;
      };
    };
  };

  try {
    if (target.mode === "path" && maybeTauri.__TAURI__?.opener?.openPath) {
      await maybeTauri.__TAURI__.opener.openPath(target.href);
      return;
    }

    if (target.mode === "url" && maybeTauri.__TAURI__?.opener?.openUrl) {
      await maybeTauri.__TAURI__.opener.openUrl(target.href);
      return;
    }
  } catch {
    // Fall back to browser-safe behavior below.
  }

  if (target.mode === "path") {
    const opened = window.open(`file://${target.href}`, "_blank", "noopener,noreferrer");
    if (!opened) {
      window.alert("Local-app launching is prepared for the desktop shell; web browsers may block direct app opens.");
    }
    return;
  }

  window.open(target.href, "_blank", "noopener,noreferrer");
}

export function getStudyLane(block: Pick<StudyBlock, "category" | "task" | "notes">): StudyLane {
  const text = workflowText(block);

  if (/review|anki|reflection|truelearn/.test(text)) {
    return "review";
  }

  if (
    /uwsa|practice exam|simulation|self-assessment|exam day|test day|\bexam\b/.test(text) ||
    (/nbme/.test(text) && !/question|questions|review/.test(text))
  ) {
    return "assessment";
  }

  if (/meal|rest|break|gym/.test(text)) {
    return "recovery";
  }

  if (/uworld|study|reading|podcast|ethics|amboss|question|content/.test(text)) {
    return "content";
  }

  return "admin";
}

export function getStudyLaneLabel(lane: StudyLane) {
  switch (lane) {
    case "review":
      return "Review lane";
    case "content":
      return "Content lane";
    case "assessment":
      return "Assessment lane";
    case "recovery":
      return "Recovery lane";
    case "admin":
    default:
      return "Support lane";
  }
}

export function isFixedBlock(block: Pick<StudyBlock, "category" | "task" | "notes">) {
  const lane = getStudyLane(block);
  return lane === "assessment" || lane === "recovery";
}
