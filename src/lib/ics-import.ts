import type { StudyBlockInput } from "../types/models";

interface IcsProperty {
  name: string;
  value: string;
  params: Map<string, string[]>;
}

interface IcsEventDraft {
  summary: string | null;
  description: string | null;
  uid: string | null;
  dtStart: string | null;
}

export interface IcsImportGroup {
  date: string;
  titles: string[];
}

export interface IcsImportPreview {
  fileName: string;
  totalEvents: number;
  importableCount: number;
  duplicateCount: number;
  skippedCount: number;
  issues: string[];
  groups: IcsImportGroup[];
  studyBlocks: StudyBlockInput[];
}

function unfoldIcsLines(raw: string) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const unfolded: string[] = [];

  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }

    unfolded.push(line);
  }

  return unfolded;
}

function unescapeIcsText(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\;/g, ";")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
}

function parseIcsProperty(line: string): IcsProperty | null {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex < 0) {
    return null;
  }

  const left = line.slice(0, separatorIndex);
  const rawValue = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = left.split(";");
  const name = rawName.trim().toUpperCase();
  if (!name) {
    return null;
  }

  const params = new Map<string, string[]>();
  for (const rawParam of rawParams) {
    const equalsIndex = rawParam.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }

    const key = rawParam.slice(0, equalsIndex).trim().toUpperCase();
    const values = rawParam
      .slice(equalsIndex + 1)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (key) {
      params.set(key, values);
    }
  }

  return {
    name,
    value: unescapeIcsText(rawValue),
    params,
  };
}

function isDateOnlyValue(value: string) {
  return /^\d{8}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatDateOnlyValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  return null;
}

function isValidCalendarDate(value: string) {
  const normalized = formatDateOnlyValue(value);
  if (!normalized) {
    return false;
  }

  const [yearText, monthText, dayText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function formatStudyDate(value: string) {
  const normalized = formatDateOnlyValue(value);
  if (!normalized || !isValidCalendarDate(normalized)) {
    return null;
  }

  return normalized;
}

function makeDeterministicImportSourceId(date: string, summary: string, description: string) {
  const payload = `${date}\u001f${summary}\u001f${description}`;
  let hash = 0xcbf29ce484222325n;

  for (let index = 0; index < payload.length; index += 1) {
    hash ^= BigInt(payload.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return `ics:generated:${hash.toString(16).padStart(16, "0")}`;
}

function createImportSourceId(uid: string | null, date: string, summary: string, description: string) {
  const trimmedUid = uid?.trim();
  if (trimmedUid) {
    return `ics:${trimmedUid}`;
  }

  return makeDeterministicImportSourceId(date, summary, description);
}

function finalizeEvent(
  event: IcsEventDraft,
  totalEvents: number,
  seenImportSourceIds: Set<string>,
  studyBlocks: StudyBlockInput[],
  issues: string[],
) {
  const summary = event.summary?.trim() ?? "";
  if (!summary) {
    issues.push(`Event ${totalEvents} skipped: missing SUMMARY.`);
    return { skipped: 1, duplicate: 0 };
  }

  const date = event.dtStart ? formatStudyDate(event.dtStart) : null;
  if (!date) {
    issues.push(`Event ${totalEvents} skipped: DTSTART must be a date-only all-day value.`);
    return { skipped: 1, duplicate: 0 };
  }

  if (!isDateOnlyValue(event.dtStart ?? "")) {
    issues.push(`Event ${totalEvents} skipped: timed DTSTART values are not supported.`);
    return { skipped: 1, duplicate: 0 };
  }

  const description = event.description?.trim() ?? "";
  const importSourceId = createImportSourceId(event.uid, date, summary, description);
  if (seenImportSourceIds.has(importSourceId)) {
    issues.push(`Event ${totalEvents} skipped: duplicate ${importSourceId}.`);
    return { skipped: 0, duplicate: 1 };
  }

  seenImportSourceIds.add(importSourceId);
  studyBlocks.push({
    date,
    category: "Review",
    task: summary,
    notes: description,
    importSourceId,
  });

  return { skipped: 0, duplicate: 0 };
}

export async function parseIcsImport(file: File, existingImportSourceIds: Iterable<string> = []) {
  const raw = await file.text();
  const lines = unfoldIcsLines(raw);
  const seenImportSourceIds = new Set(existingImportSourceIds);
  const studyBlocks: StudyBlockInput[] = [];
  const issues: string[] = [];
  let currentEvent: IcsEventDraft | null = null;
  let totalEvents = 0;
  let skippedCount = 0;
  let duplicateCount = 0;

  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized) {
      continue;
    }

    if (normalized.toUpperCase() === "BEGIN:VEVENT") {
      currentEvent = {
        summary: null,
        description: null,
        uid: null,
        dtStart: null,
      };
      totalEvents += 1;
      continue;
    }

    if (normalized.toUpperCase() === "END:VEVENT") {
      if (currentEvent) {
        const result = finalizeEvent(currentEvent, totalEvents, seenImportSourceIds, studyBlocks, issues);
        skippedCount += result.skipped;
        duplicateCount += result.duplicate;
      }
      currentEvent = null;
      continue;
    }

    if (!currentEvent) {
      continue;
    }

    const property = parseIcsProperty(line);
    if (!property) {
      continue;
    }

    switch (property.name) {
      case "SUMMARY":
        currentEvent.summary = property.value;
        break;
      case "DESCRIPTION":
        currentEvent.description = property.value;
        break;
      case "UID":
        currentEvent.uid = property.value;
        break;
      case "DTSTART":
        currentEvent.dtStart = property.value.trim();
        break;
      default:
        break;
    }
  }

  if (currentEvent) {
    const result = finalizeEvent(currentEvent, totalEvents, seenImportSourceIds, studyBlocks, issues);
    skippedCount += result.skipped;
    duplicateCount += result.duplicate;
  }

  if (totalEvents === 0) {
    throw new Error("No VEVENT entries were found in the selected .ics file.");
  }

  const groupedMap = new Map<string, string[]>();
  for (const block of studyBlocks) {
    const titles = groupedMap.get(block.date) ?? [];
    titles.push(block.task);
    groupedMap.set(block.date, titles);
  }

  const groups = [...groupedMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, titles]) => ({
      date,
      titles: titles.sort((left, right) => left.localeCompare(right)),
    }));

  return {
    fileName: file.name,
    totalEvents,
    importableCount: studyBlocks.length,
    duplicateCount,
    skippedCount,
    issues,
    groups,
    studyBlocks,
  } satisfies IcsImportPreview;
}
