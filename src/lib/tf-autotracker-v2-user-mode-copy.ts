import type { AutoTrackerV2NativeStatus } from "./tf-autotracker-v2-native-events.js";

export type AutoTrackerV2UserModeSetupCopy = {
  tone: "ready" | "attention" | "unsupported";
  label: string;
  detail: string | null;
};

export function buildAutoTrackerV2UserModeStatusCopy({
  isRunning,
  runningElapsedLabel,
  savedEntryCount = 0,
  needsSetup = false,
}: {
  isRunning: boolean;
  runningElapsedLabel?: string | null;
  savedEntryCount?: number;
  needsSetup?: boolean;
}): {
  pillLabel: string;
  metaLabel: string | null;
  statusLine: string;
} {
  if (needsSetup) {
    return {
      pillLabel: "Needs setup",
      metaLabel: null,
      statusLine: "Needs setup",
    };
  }

  if (isRunning) {
    return {
      pillLabel: "Running",
      metaLabel: runningElapsedLabel ?? null,
      statusLine: runningElapsedLabel ? `Running · ${runningElapsedLabel}` : "Running",
    };
  }

  if (savedEntryCount > 0) {
    const entryLabel = savedEntryCount === 1 ? "entry" : "entries";

    return {
      pillLabel: "Saved",
      metaLabel: `${savedEntryCount} ${entryLabel}`,
      statusLine: `Saved ${savedEntryCount} ${entryLabel}`,
    };
  }

  return {
    pillLabel: "Off",
    metaLabel: null,
    statusLine: "Off",
  };
}

export function formatAutoTrackerV2ApproxDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (totalSeconds >= 60) {
    return `${Math.max(1, Math.round(totalSeconds / 60))}m`;
  }

  return `${seconds}s`;
}

export function formatAutoTrackerV2SavedRunSummary(names: string[]): string {
  const compactNames = names
    .map((name) => name.trim())
    .filter((name, index, allNames) => name.length > 0 && allNames.indexOf(name) === index);

  if (compactNames.length === 0) {
    return "Latest run saved.";
  }

  if (compactNames.length <= 5) {
    return compactNames.join(", ");
  }

  return `${compactNames.slice(0, 5).join(", ")}, +${compactNames.length - 5} more`;
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
      detail: "Checking Auto-Tracking setup.",
    };
  }

  if (!nativeStatus.supported) {
    return {
      tone: "unsupported",
      label: "Needs setup",
      detail: "Auto-Tracking is not available on this Mac.",
    };
  }

  if (!nativeStatus.foregroundProbeAvailable || !nativeStatus.idleProbeAvailable) {
    return {
      tone: "attention",
      label: "Needs setup",
      detail: "Grant the required macOS permissions to use Auto-Tracking.",
    };
  }

  if (trackedRuleCount + distractionRuleCount === 0) {
    return {
      tone: "attention",
      label: "Needs setup",
      detail: "Add allowed apps/sites in Tracker Settings.",
    };
  }

  if (samplerHasError) {
    return {
      tone: "attention",
      label: "Needs attention",
      detail: "Auto-Tracking hit a local issue. Stop and restart it if detections stall.",
    };
  }

  return {
    tone: "ready",
    label: "Ready",
    detail: null,
  };
}

export function buildAutoTrackerV2StopSaveCopy({
  isRunning,
  saveableCount,
  hasDetectedActivity: _hasDetectedActivity,
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
  supportingLine: string | null;
} {
  void _hasDetectedActivity;
  const entryLabel = saveableCount === 1 ? "entry" : "entries";

  if (isRunning && saveableCount > 0) {
    return {
      actionLabel: `Stop & Save ${saveableCount} ${entryLabel}`,
      supportingLine: null,
    };
  }

  if (isRunning) {
    return {
      actionLabel: "Stop Auto-Tracking",
      supportingLine: hasUnclassifiedActivity ? "Nothing tracked yet" : null,
    };
  }

  if (alreadyWritten) {
    return {
      actionLabel: "Start New Run",
      supportingLine: null,
    };
  }

  return {
    actionLabel: "Start Auto-Tracking",
    supportingLine: null,
  };
}
