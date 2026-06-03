import type { UrgeLog, UrgeTrigger } from "../types/models";
import { URGE_TRIGGER_LABELS } from "./portfolio-urge-awareness";
import { addDays, formatDateKey, getTodayKey, parseDateKey } from "./datetime";

export { URGE_TRIGGER_LABELS };

export type UrgeWindow = 14 | 30 | "all";

export type TimeOfDayBucket = "morning" | "afternoon" | "evening" | "night";

export const TIME_OF_DAY_LABELS: Record<TimeOfDayBucket, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};

export type NormalizedUrge = UrgeLog & {
  dateKey: string | null;
  timestampMs: number | null;
  hour: number | null;
};

export type UrgeTriggerBreakdownEntry = {
  trigger: UrgeTrigger;
  label: string;
  count: number;
  averageIntensity: number;
  sharePercent: number;
};

export type UrgeIntensityBucket = {
  intensity: 1 | 2 | 3 | 4 | 5;
  count: number;
  sharePercent: number;
};

export type UrgeTimeBucket = {
  bucket: TimeOfDayBucket;
  label: string;
  count: number;
  sharePercent: number;
};

export type UrgeDailyPoint = {
  dateKey: string;
  count: number;
  averageIntensity: number;
};

export type UrgeDaySummary = {
  dateKey: string;
  totalCount: number;
  averageIntensity: number;
  topTrigger: UrgeTrigger | null;
  highestIntensity: number;
  entries: NormalizedUrge[];
};

export type UrgeAnalytics = {
  window: UrgeWindow;
  windowDays: number;
  totalCount: number;
  averageIntensity: number;
  highestIntensity: number;
  topTrigger: UrgeTrigger | null;
  urgesPerDay: number;
  triggerBreakdown: UrgeTriggerBreakdownEntry[];
  intensityDistribution: UrgeIntensityBucket[];
  timeBuckets: UrgeTimeBucket[];
  topTimeBucket: UrgeTimeBucket | null;
  dailyTrend: UrgeDailyPoint[];
  examples: NormalizedUrge[];
};

function safeTimestampMs(timestamp: string): number | null {
  if (typeof timestamp !== "string") {
    return null;
  }
  const trimmed = timestamp.trim();
  if (!trimmed) {
    return null;
  }
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Local calendar date key (YYYY-MM-DD) for an urge timestamp, or null if malformed. */
export function getUrgeDateKey(timestamp: string): string | null {
  const ms = safeTimestampMs(timestamp);
  if (ms == null) {
    return null;
  }
  return formatDateKey(new Date(ms));
}

function getUrgeHour(timestamp: string): number | null {
  const ms = safeTimestampMs(timestamp);
  if (ms == null) {
    return null;
  }
  return new Date(ms).getHours();
}

export function classifyTimeOfDay(hour: number): TimeOfDayBucket {
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }
  if (hour >= 17 && hour < 22) {
    return "evening";
  }
  return "night";
}

function normalizeUrge(urgeLog: UrgeLog): NormalizedUrge {
  return {
    ...urgeLog,
    dateKey: getUrgeDateKey(urgeLog.timestamp),
    timestampMs: safeTimestampMs(urgeLog.timestamp),
    hour: getUrgeHour(urgeLog.timestamp),
  };
}

function sortNewestFirst(entries: NormalizedUrge[]): NormalizedUrge[] {
  return [...entries].sort((left, right) => {
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
}

/** Urges that fall on a single local calendar date. Malformed timestamps are excluded. */
export function filterUrgesByDate(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  dateKey: string,
): NormalizedUrge[] {
  return (urgeLogs ?? [])
    .map(normalizeUrge)
    .filter((urge) => urge.dateKey === dateKey);
}

/** Urges within an inclusive local-date range. Malformed timestamps are excluded. */
export function filterUrgesByRange(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  startDate: string,
  endDate: string,
): NormalizedUrge[] {
  return (urgeLogs ?? [])
    .map(normalizeUrge)
    .filter((urge) => urge.dateKey != null && urge.dateKey >= startDate && urge.dateKey <= endDate);
}

function topTriggerOf(entries: NormalizedUrge[]): UrgeTrigger | null {
  if (!entries.length) {
    return null;
  }
  const counts = new Map<UrgeTrigger, number>();
  for (const entry of entries) {
    counts.set(entry.trigger, (counts.get(entry.trigger) ?? 0) + 1);
  }
  let topTrigger: UrgeTrigger | null = null;
  let topCount = -1;
  // Preserve insertion order on ties so the first-seen trigger wins deterministically.
  for (const entry of entries) {
    const count = counts.get(entry.trigger) ?? 0;
    if (count > topCount) {
      topTrigger = entry.trigger;
      topCount = count;
    }
  }
  return topTrigger;
}

function averageIntensityOf(entries: NormalizedUrge[]): number {
  if (!entries.length) {
    return 0;
  }
  return entries.reduce((sum, entry) => sum + entry.intensity, 0) / entries.length;
}

function highestIntensityOf(entries: NormalizedUrge[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.intensity), 0);
}

export function buildTriggerBreakdown(entries: NormalizedUrge[]): UrgeTriggerBreakdownEntry[] {
  const total = entries.length;
  return [...new Set(entries.map((entry) => entry.trigger))]
    .map((trigger) => {
      const triggerEntries = entries.filter((entry) => entry.trigger === trigger);
      const count = triggerEntries.length;
      return {
        trigger,
        label: URGE_TRIGGER_LABELS[trigger],
        count,
        averageIntensity: averageIntensityOf(triggerEntries),
        sharePercent: total > 0 ? (count / total) * 100 : 0,
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
}

export function buildIntensityDistribution(entries: NormalizedUrge[]): UrgeIntensityBucket[] {
  const total = entries.length;
  const levels: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
  return levels.map((intensity) => {
    const count = entries.filter((entry) => entry.intensity === intensity).length;
    return {
      intensity,
      count,
      sharePercent: total > 0 ? (count / total) * 100 : 0,
    };
  });
}

export function buildTimeBuckets(entries: NormalizedUrge[]): UrgeTimeBucket[] {
  const order: TimeOfDayBucket[] = ["morning", "afternoon", "evening", "night"];
  const timed = entries.filter((entry) => entry.hour != null);
  const total = timed.length;
  return order.map((bucket) => {
    const count = timed.filter((entry) => classifyTimeOfDay(entry.hour as number) === bucket).length;
    return {
      bucket,
      label: TIME_OF_DAY_LABELS[bucket],
      count,
      sharePercent: total > 0 ? (count / total) * 100 : 0,
    };
  });
}

/** Compact summary for one selected local day. */
export function buildUrgeDaySummary(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  dateKey: string,
): UrgeDaySummary {
  const entries = sortNewestFirst(filterUrgesByDate(urgeLogs, dateKey));
  return {
    dateKey,
    totalCount: entries.length,
    averageIntensity: averageIntensityOf(entries),
    topTrigger: topTriggerOf(entries),
    highestIntensity: highestIntensityOf(entries),
    entries,
  };
}

function buildDailyTrend(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  todayKey: string,
  days: number,
): UrgeDailyPoint[] {
  const startKey = addDays(todayKey, -(days - 1));
  const inWindow = filterUrgesByRange(urgeLogs, startKey, todayKey);
  return Array.from({ length: days }, (_, index) => {
    const dateKey = addDays(startKey, index);
    const dayEntries = inWindow.filter((entry) => entry.dateKey === dateKey);
    return {
      dateKey,
      count: dayEntries.length,
      averageIntensity: averageIntensityOf(dayEntries),
    };
  });
}

function spanDays(entries: NormalizedUrge[], todayKey: string): number {
  const dated = entries.filter((entry) => entry.dateKey != null);
  if (!dated.length) {
    return 1;
  }
  const earliest = dated.reduce(
    (min, entry) => ((entry.dateKey as string) < min ? (entry.dateKey as string) : min),
    todayKey,
  );
  const start = parseDateKey(earliest).getTime();
  const end = parseDateKey(todayKey).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

/**
 * Range analytics for the Urge Analytics panel.
 * The 14-day trend is always rendered over the trailing 14 local days regardless of window.
 */
export function buildUrgeAnalytics(
  urgeLogs: readonly UrgeLog[] | null | undefined,
  window: UrgeWindow,
  todayKey: string = getTodayKey(),
): UrgeAnalytics {
  let scoped: NormalizedUrge[];
  let windowDays: number;

  if (window === "all") {
    scoped = (urgeLogs ?? []).map(normalizeUrge).filter((entry) => entry.dateKey != null);
    windowDays = spanDays(scoped, todayKey);
  } else {
    const startKey = addDays(todayKey, -(window - 1));
    scoped = filterUrgesByRange(urgeLogs, startKey, todayKey);
    windowDays = window;
  }

  const totalCount = scoped.length;
  const timeBuckets = buildTimeBuckets(scoped);
  const topTimeBucket =
    totalCount > 0
      ? [...timeBuckets].sort((left, right) => right.count - left.count)[0] ?? null
      : null;

  return {
    window,
    windowDays,
    totalCount,
    averageIntensity: averageIntensityOf(scoped),
    highestIntensity: highestIntensityOf(scoped),
    topTrigger: topTriggerOf(scoped),
    urgesPerDay: windowDays > 0 ? totalCount / windowDays : 0,
    triggerBreakdown: buildTriggerBreakdown(scoped),
    intensityDistribution: buildIntensityDistribution(scoped),
    timeBuckets,
    topTimeBucket: topTimeBucket && topTimeBucket.count > 0 ? topTimeBucket : null,
    dailyTrend: buildDailyTrend(urgeLogs, todayKey, 14),
    examples: sortNewestFirst(scoped).slice(0, 8),
  };
}
