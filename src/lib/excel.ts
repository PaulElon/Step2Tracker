import * as XLSX from "xlsx";
import { formatDateKey, getDayName } from "./datetime";
import { normalizeStatus, normalizeStudyTaskCategory } from "./storage";
import type { StudyBlockInput, WorkbookImportPreview } from "../types/models";

type ImportField = keyof Pick<
  StudyBlockInput,
  "date" | "day" | "startTime" | "endTime" | "category" | "task" | "status" | "notes"
>;

const headerAliases: Record<ImportField, string[]> = {
  date: ["date", "studydate", "plandate"],
  day: ["day", "weekday"],
  startTime: ["starttime", "start", "begintime", "from"],
  endTime: ["endtime", "end", "finishtime", "to"],
  category: ["category", "subject", "type", "track"],
  task: ["task", "activity", "description", "plan", "item"],
  status: ["status", "progress", "state"],
  notes: ["notes", "note", "comments", "comment", "reflection"],
};

function normalizeHeader(value: unknown) {
  const text =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";

  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function formatExcelTime(value: number) {
  const totalMinutes = Math.round((value % 1) * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseDateValue(value: unknown) {
  if (value instanceof Date) {
    return formatDateKey(value);
  }

  if (typeof value === "number") {
    const utcDays = Math.floor(value - 25569);
    const utcValue = utcDays * 86_400;
    return formatDateKey(new Date(utcValue * 1000));
  }

  const text = normalizeString(value);
  if (!text) {
    return "";
  }

  const parsedDate = new Date(text);
  return Number.isNaN(parsedDate.getTime()) ? "" : formatDateKey(parsedDate);
}

function parseTimeValue(value: unknown) {
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }

  if (typeof value === "number") {
    return formatExcelTime(value);
  }

  const text = normalizeString(value);
  if (!text) {
    return "";
  }

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  }

  const meridiemMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiemMatch) {
    const rawHours = Number(meridiemMatch[1]);
    const minutes = Number(meridiemMatch[2] ?? "0");
    const meridiem = meridiemMatch[3].toLowerCase();
    const hours = rawHours % 12 + (meridiem === "pm" ? 12 : 0);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  return text;
}

function getHeaderMap(row: unknown[]) {
  const map = new Map<ImportField, number>();

  row.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    const field = (Object.keys(headerAliases) as ImportField[]).find((candidate) =>
      headerAliases[candidate].includes(normalized),
    );

    if (field) {
      map.set(field, index);
    }
  });

  return map;
}

function findSheetAndHeaderRow(workbook: XLSX.WorkBook) {
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<(string | number | Date)[]>(worksheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });

    for (let rowIndex = 0; rowIndex < Math.min(matrix.length, 8); rowIndex += 1) {
      const headerMap = getHeaderMap(matrix[rowIndex] ?? []);
      if (
        headerMap.has("date") &&
        headerMap.has("startTime") &&
        headerMap.has("endTime") &&
        headerMap.has("category") &&
        headerMap.has("task")
      ) {
        return { sheetName, rowIndex, matrix, headerMap };
      }
    }
  }

  throw new Error("No schedule sheet with recognizable Step 2 study columns was found.");
}

function parseStudyBlockRow(values: unknown[], headerMap: Map<ImportField, number>) {
  const getValue = (field: ImportField) => values[headerMap.get(field) ?? -1];

  const date = parseDateValue(getValue("date"));
  const task = normalizeString(getValue("task"));
  const category = normalizeString(getValue("category"));

  if (!date || !task || !category) {
    return null;
  }

  const startTime = parseTimeValue(getValue("startTime"));
  const endTime = parseTimeValue(getValue("endTime"));

  return {
    date,
    day: normalizeString(getValue("day")) || getDayName(date),
    startTime,
    endTime,
    durationHours: 0,
    durationMinutes: 0,
    category: normalizeStudyTaskCategory(category, {
      task,
      notes: normalizeString(getValue("notes")),
    }),
    task,
    completed: normalizeStatus(getValue("status")) === "Completed",
    status: normalizeStatus(getValue("status")),
    notes: normalizeString(getValue("notes")),
  } satisfies StudyBlockInput;
}

export async function parseStudyWorkbook(file: File): Promise<WorkbookImportPreview> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true,
  });

  const { matrix, rowIndex, headerMap } = findSheetAndHeaderRow(workbook);
  const warnings: string[] = [];
  const studyBlocks: StudyBlockInput[] = [];

  for (let index = rowIndex + 1; index < matrix.length; index += 1) {
    const row = matrix[index] ?? [];
    const block = parseStudyBlockRow(row, headerMap);
    if (!block) {
      if (row.some((value) => normalizeString(value))) {
        warnings.push(`Skipped row ${index + 1} because required fields were missing.`);
      }
      continue;
    }

    studyBlocks.push(block);
  }

  const categories = [...new Set(studyBlocks.map((block) => block.category))].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    studyBlocks,
    summary: {
      blockCount: studyBlocks.length,
      categories,
      startDate: studyBlocks[0]?.date ?? "",
      endDate: studyBlocks.at(-1)?.date ?? "",
      warnings,
    },
  };
}
