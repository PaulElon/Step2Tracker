import { getSessionLogDateKey } from "./tf-session-adapters";
import type { TfSessionLog } from "../types/models";

export function getTrackedStudyMinutesForDate(
  sessionLogs: TfSessionLog[],
  dateKey: string,
): number {
  return sessionLogs
    .filter((log) => getSessionLogDateKey(log) === dateKey && !log.isDistraction)
    .reduce((total, log) => total + log.hours * 60, 0);
}
