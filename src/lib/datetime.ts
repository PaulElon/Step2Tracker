import type { StudyBlock } from "../types/models";

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
});

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function getTodayKey() {
  return formatDateKey(new Date());
}

export function getDayName(dateKey: string) {
  return weekdayFormatter.format(parseDateKey(dateKey));
}

export function formatShortDate(dateKey: string) {
  return shortDateFormatter.format(parseDateKey(dateKey));
}

export function formatLongDate(dateKey: string) {
  return longDateFormatter.format(parseDateKey(dateKey));
}

export function formatMonthLabel(dateKey: string) {
  return monthFormatter.format(parseDateKey(dateKey));
}

export function addDays(dateKey: string, amount: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return formatDateKey(date);
}

export function addMonths(dateKey: string, amount: number) {
  const date = parseDateKey(dateKey);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(originalDay, maxDay));
  return formatDateKey(date);
}

export function startOfMonth(dateKey: string) {
  const date = parseDateKey(dateKey);
  date.setDate(1);
  return formatDateKey(date);
}

export function startOfWeek(dateKey: string, weekStartsOn = 1) {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const diff = (day - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  return formatDateKey(date);
}

export function getMonthGridDates(referenceDate: string, weekStartsOn = 1) {
  const monthStart = parseDateKey(startOfMonth(referenceDate));
  const weekOffset = (monthStart.getDay() - weekStartsOn + 7) % 7;
  monthStart.setDate(monthStart.getDate() - weekOffset);

  return Array.from({ length: 42 }, (_, index) => addDays(formatDateKey(monthStart), index));
}

export function daysBetween(startDate: string, endDate: string) {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  const milliseconds = end.getTime() - start.getTime();
  return Math.round(milliseconds / 86_400_000);
}

export function parseTimeToMinutes(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  const compact = normalized.replace(/\s+/g, " ");
  const meridiemMatch = compact.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/);
  if (meridiemMatch) {
    const rawHours = Number(meridiemMatch[1]);
    const minutes = Number(meridiemMatch[2] ?? "0");
    const meridiem = meridiemMatch[3];
    const hours = rawHours % 12 + (meridiem === "pm" ? 12 : 0);
    return hours * 60 + minutes;
  }

  const twentyFourHourMatch = compact.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  return 0;
}

export function formatTimeLabel(value: string) {
  if (!value) {
    return "--:--";
  }
  const totalMinutes = parseTimeToMinutes(value);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 || 12;
  return `${normalizedHours}:${pad(minutes)} ${suffix}`;
}

export function minutesBetween(startTime: string, endTime: string, isOvernight = false) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  const adjustedEnd = endMinutes >= startMinutes || !isOvernight ? endMinutes : endMinutes + 24 * 60;
  return Math.max(adjustedEnd - startMinutes, 0);
}

export function formatMinutes(minutes: number) {
  const safeMinutes = Math.max(Math.round(minutes), 0);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;

  if (!hours) {
    return `${remainder}m`;
  }

  if (!remainder) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

export function formatHoursValue(minutes: number) {
  const safeMinutes = Math.max(Math.round(minutes), 0);
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}h ${pad(remainder)}m`;
}

export function formatDateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatSavedAt(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const timeStr = date.toLocaleTimeString([], { timeStyle: "short" });
  if (formatDateKey(date) === getTodayKey()) {
    return `Today at ${timeStr}`;
  }
  return `${longDateFormatter.format(date)} at ${timeStr}`;
}

export function compareStudyBlocks(left: StudyBlock, right: StudyBlock) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }

  const orderDifference = left.order - right.order;
  if (orderDifference !== 0) {
    return orderDifference;
  }

  return left.task.localeCompare(right.task);
}
