export function buildAutoTrackerV2UserModeStatusCopy({
  isRunning,
  lastDetectedAppName,
}: {
  isRunning: boolean;
  lastDetectedAppName: string | null;
}): {
  statusLine: string;
  lastDetectedLine: string;
} {
  return {
    statusLine: isRunning ? "Auto-Tracking is running." : "Auto-Tracking is off.",
    lastDetectedLine: `Last detected: ${lastDetectedAppName?.trim() || "None yet"}`,
  };
}
