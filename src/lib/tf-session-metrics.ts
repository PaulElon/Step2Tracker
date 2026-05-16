import type { TfSessionLog } from "../types/models";

export function getTrackedStudyMinutesForDate(
  sessionLogs: TfSessionLog[],
  dateKey: string,
): number {
  return sessionLogs
    .filter((log) => log.date === dateKey && !log.isDistraction)
    .reduce((total, log) => total + log.hours * 60, 0);
}
