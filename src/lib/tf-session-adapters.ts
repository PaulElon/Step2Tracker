import type { StudyBlock, TfSessionLog } from "../types/models";

export function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

export function methodKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return key || "other";
}

export function studyBlockToSession(block: StudyBlock): TfSessionLog {
  const method = block.category || block.task || "Other";
  const methodKey = methodKeyFromLabel(method);
  const totalMinutes = block.durationHours * 60 + block.durationMinutes;
  const hours = roundHours(totalMinutes / 60);

  const startISO = block.startTime
    ? `${block.date}T${block.startTime}:00`
    : `${block.date}T00:00:00`;
  const endISO = block.endTime
    ? `${block.date}T${block.endTime}:00`
    : `${block.date}T${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00`;

  return {
    id: block.id,
    date: block.date,
    method,
    methodKey,
    hours,
    startISO,
    endISO,
    notes: block.notes ?? "",
    isDistraction: false,
    isLive: false,
  };
}

export function totalsByDay(sessions: TfSessionLog[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const s of sessions) {
    result[s.date] = roundHours((result[s.date] ?? 0) + s.hours);
  }
  return result;
}

export function allocationByMethod(
  sessions: TfSessionLog[]
): Array<{ method: string; methodKey: string; hours: number; sessionCount: number }> {
  const map = new Map<string, { method: string; methodKey: string; hours: number; sessionCount: number }>();
  for (const s of sessions) {
    const existing = map.get(s.methodKey);
    if (existing) {
      existing.hours = roundHours(existing.hours + s.hours);
      existing.sessionCount += 1;
    } else {
      map.set(s.methodKey, {
        method: s.method,
        methodKey: s.methodKey,
        hours: s.hours,
        sessionCount: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.hours !== a.hours) return b.hours - a.hours;
    return a.method.localeCompare(b.method);
  });
}

export function mergeSessionsByDate(
  sessions: TfSessionLog[]
): Array<{ date: string; sessions: TfSessionLog[]; hours: number }> {
  const map = new Map<string, TfSessionLog[]>();
  for (const s of sessions) {
    const group = map.get(s.date);
    if (group) {
      group.push(s);
    } else {
      map.set(s.date, [s]);
    }
  }
  return [...map.entries()]
    .map(([date, group]) => ({
      date,
      sessions: group,
      hours: roundHours(group.reduce((sum, s) => sum + s.hours, 0)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
