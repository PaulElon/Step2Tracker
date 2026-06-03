import type { UrgeLog, UrgeTrigger } from "../types/models";

export const URGE_TRIGGER_LABELS: Record<UrgeTrigger, string> = {
  x_social: "X / social",
  phone: "Phone",
  gaming: "Gaming",
  side_project: "Side project",
  boredom: "Boredom",
  fatigue: "Fatigue",
  other: "Other",
};

export type PortfolioUrgeRange = {
  startDate?: string;
  endDate?: string;
};

export type PortfolioUrgeBreakdownEntry = {
  trigger: UrgeTrigger;
  label: string;
  count: number;
  averageIntensity: number;
  sharePercent: number;
};

export type PortfolioUrgeExample = UrgeLog & {
  dateKey: string | null;
  timestampMs: number | null;
};

export type PortfolioUrgeSummary = {
  totalCount: number;
  averageIntensity: number;
  topTrigger: UrgeTrigger | null;
  sessionCount: number | null;
  breakdown: PortfolioUrgeBreakdownEntry[];
  examples: PortfolioUrgeExample[];
};

function getTimestampMs(value: string): number | null {
  const timestampMs = new Date(value).getTime();
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function getDateKeyFromIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isWithinRange(dateKey: string | null, range?: PortfolioUrgeRange): boolean {
  if (!range?.startDate && !range?.endDate) {
    return true;
  }

  if (!dateKey) {
    return false;
  }

  if (range.startDate && dateKey < range.startDate) {
    return false;
  }

  if (range.endDate && dateKey > range.endDate) {
    return false;
  }

  return true;
}

function getTopTrigger(urgeLogs: PortfolioUrgeExample[]): UrgeTrigger | null {
  if (!urgeLogs.length) {
    return null;
  }

  const counts = new Map<UrgeTrigger, number>();
  for (const urgeLog of urgeLogs) {
    counts.set(urgeLog.trigger, (counts.get(urgeLog.trigger) ?? 0) + 1);
  }

  let topTrigger: UrgeTrigger | null = null;
  let topCount = -1;
  for (const urgeLog of urgeLogs) {
    const count = counts.get(urgeLog.trigger) ?? 0;
    if (count > topCount) {
      topTrigger = urgeLog.trigger;
      topCount = count;
    }
  }

  return topTrigger;
}

export function buildPortfolioUrgeSummary(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  range?: PortfolioUrgeRange,
): PortfolioUrgeSummary {
  const normalizedLogs = (urgeLogs ?? [])
    .map((urgeLog) => ({
      ...urgeLog,
      dateKey: getDateKeyFromIso(urgeLog.timestamp),
      timestampMs: getTimestampMs(urgeLog.timestamp),
    }))
    .filter((urgeLog) => isWithinRange(urgeLog.dateKey, range));

  const totalCount = normalizedLogs.length;
  const averageIntensity =
    totalCount > 0
      ? normalizedLogs.reduce((sum, urgeLog) => sum + urgeLog.intensity, 0) / totalCount
      : 0;
  const sessionIds = new Set(
    normalizedLogs
      .map((urgeLog) => urgeLog.sessionId?.trim())
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );

  const breakdown = [...new Set(normalizedLogs.map((urgeLog) => urgeLog.trigger))]
    .map((trigger) => {
      const triggerLogs = normalizedLogs.filter((urgeLog) => urgeLog.trigger === trigger);
      const count = triggerLogs.length;
      const averageTriggerIntensity =
        count > 0
          ? triggerLogs.reduce((sum, urgeLog) => sum + urgeLog.intensity, 0) / count
          : 0;

      return {
        trigger,
        label: URGE_TRIGGER_LABELS[trigger],
        count,
        averageIntensity: averageTriggerIntensity,
        sharePercent: totalCount > 0 ? (count / totalCount) * 100 : 0,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });

  const examples = [...normalizedLogs].sort((left, right) => {
    if (left.timestampMs == null && right.timestampMs == null) {
      return 0;
    }
    if (left.timestampMs == null) {
      return 1;
    }
    if (right.timestampMs == null) {
      return -1;
    }
    return right.timestampMs - left.timestampMs;
  });

  return {
    totalCount,
    averageIntensity,
    topTrigger: getTopTrigger(normalizedLogs),
    sessionCount: sessionIds.size > 0 ? sessionIds.size : null,
    breakdown,
    examples,
  };
}
