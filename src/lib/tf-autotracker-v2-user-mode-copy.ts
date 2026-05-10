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
