import type { AutoTrackerV2NativeStatus } from "./tf-autotracker-v2-native-events.js";

export type AutoTrackerV2UserModeSetupCopy = {
  tone: "ready" | "attention" | "unsupported";
  label: string;
  detail: string;
};

export function buildAutoTrackerV2UserModeStatusCopy({
  isRunning,
  lastDetectedAppName,
  runningElapsedLabel,
}: {
  isRunning: boolean;
  lastDetectedAppName: string | null;
  runningElapsedLabel?: string | null;
}): {
  statusLine: string;
  lastDetectedLine: string;
} {
  const runningSuffix = isRunning && runningElapsedLabel ? ` · ${runningElapsedLabel}` : "";

  return {
    statusLine: isRunning
      ? `Auto-Tracking is running${runningSuffix || "."}`
      : "Auto-Tracking is off.",
    lastDetectedLine: `Last detected: ${lastDetectedAppName?.trim() || "None yet"}`,
  };
}

export function formatAutoTrackerV2ApproxDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `~${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `~${minutes}m ${seconds}s`;
  }

  return `~${seconds}s`;
}

export function buildAutoTrackerV2UserModeSetupCopy({
  nativeStatus,
  trackedRuleCount,
  distractionRuleCount,
  samplerHasError,
}: {
  nativeStatus: AutoTrackerV2NativeStatus | null;
  trackedRuleCount: number;
  distractionRuleCount: number;
  samplerHasError: boolean;
}): AutoTrackerV2UserModeSetupCopy {
  if (!nativeStatus) {
    return {
      tone: "attention",
      label: "Checking setup",
      detail: "Reading the local Auto-Tracking sampler status.",
    };
  }

  if (!nativeStatus.supported) {
    return {
      tone: "unsupported",
      label: "Not supported",
      detail: "Auto-Tracking is not available on this Mac.",
    };
  }

  if (!nativeStatus.foregroundProbeAvailable || !nativeStatus.idleProbeAvailable) {
    return {
      tone: "attention",
      label: "Setup needed",
      detail: "Grant the required macOS permissions so foreground and idle detection can run.",
    };
  }

  if (trackedRuleCount + distractionRuleCount === 0) {
    return {
      tone: "attention",
      label: "Rules needed",
      detail: "Add Allowed or Distraction apps/sites in Tracker Settings before relying on Auto-Tracking.",
    };
  }

  if (samplerHasError) {
    return {
      tone: "attention",
      label: "Needs attention",
      detail: "The sampler reported a local issue. Stop and restart Auto-Tracking if detections stall.",
    };
  }

  return {
    tone: "ready",
    label: "Ready",
    detail: `Allowed rules: ${trackedRuleCount}. Distraction rules: ${distractionRuleCount}.`,
  };
}

export function buildAutoTrackerV2StopSaveCopy({
  isRunning,
  saveableCount,
  hasDetectedActivity,
  hasUnclassifiedActivity,
  alreadyWritten,
}: {
  isRunning: boolean;
  saveableCount: number;
  hasDetectedActivity: boolean;
  hasUnclassifiedActivity: boolean;
  alreadyWritten: boolean;
}): {
  actionLabel: string;
  summaryLine: string;
  detailLine: string;
} {
  const entryLabel = saveableCount === 1 ? "entry" : "entries";

  if (isRunning && saveableCount > 0) {
    return {
      actionLabel: `Stop & Save ${saveableCount} ${entryLabel}`,
      summaryLine: `Stop & Save will add ${saveableCount} Session Log ${entryLabel}.`,
      detailLine: hasUnclassifiedActivity
        ? "Every classified span in this run will save together. Unclassified activity stays out of the Session Log."
        : "Every classified span in this run will save together.",
    };
  }

  if (isRunning) {
    return {
      actionLabel: "Stop Auto-Tracking",
      summaryLine: "Nothing will save yet.",
      detailLine: hasUnclassifiedActivity
        ? "This run only has unclassified activity so far. Add Allowed or Distraction rules if you want it counted."
        : hasDetectedActivity
          ? "Detected activity is not ready to save yet."
          : "No activity has been detected yet.",
    };
  }

  if (alreadyWritten) {
    return {
      actionLabel: "Start Auto-Tracking",
      summaryLine: "Last run already saved.",
      detailLine: "Start Auto-Tracking to capture a new run.",
    };
  }

  if (saveableCount > 0) {
    return {
      actionLabel: "Start Auto-Tracking",
      summaryLine: `${saveableCount} Session Log ${entryLabel} still appear ready to save.`,
      detailLine: "Review the run preview below, then start a new run when you are ready.",
    };
  }

  return {
    actionLabel: "Start Auto-Tracking",
    summaryLine: "Auto-Tracking is off.",
    detailLine: "Start a run to see the live timeline and save preview here.",
  };
}
