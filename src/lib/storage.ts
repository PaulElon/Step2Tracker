import bootstrapSchedule from "../data/bootstrap-schedule.json";
import { getPracticeTestLabel, resolvePracticeTestSource } from "./practice-tests";
import { compareStudyBlocks, getDayName, getTodayKey, minutesBetween, parseTimeToMinutes } from "./datetime";
import type {
  AppState,
  BackupPayload,
  PlannerFilters,
  PracticeTest,
  PracticeTestInput,
  Preferences,
  StudyBlock,
  StudyBlockInput,
  StudyTaskCategory,
  StudyStatus,
  ThemeId,
  WeakTopicEntry,
  WeakTopicEntryType,
  WeakTopicInput,
  WeakTopicPriority,
  WeakTopicStatus,
} from "../types/models";

export const APP_STATE_VERSION = 6;
const LEGACY_STORAGE_KEY = "step2-command-center:v1";
const SNAPSHOT_STORAGE_KEY = "step2-command-center:snapshot:v2";
const DATABASE_NAME = "step2-command-center-db";
const DATABASE_VERSION = 1;
const DATABASE_STORE = "app-state";
const DATABASE_RECORD_KEY = "primary";

export const STATUS_VALUES: StudyStatus[] = [
  "Not Started",
  "In Progress",
  "Completed",
  "Skipped",
];
export const STUDY_TASK_CATEGORY_VALUES: StudyTaskCategory[] = ["Test", "Review", "Anki", "Notes"];

export const THEME_VALUES: ThemeId[] = ["aurora", "ember", "tide", "bubblegum", "signal", "prism"];
export const WEAK_TOPIC_PRIORITY_VALUES: WeakTopicPriority[] = ["High", "Medium", "Low"];
export const WEAK_TOPIC_STATUS_VALUES: WeakTopicStatus[] = [
  "Active",
  "Watching",
  "Improving",
  "Resolved",
];

const defaultPlannerFilters: PlannerFilters = {
  search: "",
  category: "All",
  status: "All",
  fromDate: "",
  toDate: "",
};

export const DEFAULT_PREFERENCES: Preferences = {
  activeSection: "dashboard",
  lastActiveDate: getTodayKey(),
  themeId: "aurora",
  dailyGoalMinutes: 8 * 60,
  plannerFilters: defaultPlannerFilters,
  plannerSort: {
    field: "date",
    direction: "asc",
  },
  plannerMode: "week",
  plannerFocusDate: getTodayKey(),
};

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sanitizeText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }

  return "";
}

function sanitizeNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isValidDateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeValue(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isStudyTaskCategory(value: string): value is StudyTaskCategory {
  return (STUDY_TASK_CATEGORY_VALUES as string[]).includes(value);
}

function normalizeTaskDuration(hours: unknown, minutes: unknown) {
  const safeHours = Math.max(Math.trunc(sanitizeNumber(hours, 0)), 0);
  const safeMinutes = Math.max(Math.trunc(sanitizeNumber(minutes, 0)), 0);
  const totalMinutes = safeHours * 60 + safeMinutes;
  return {
    durationHours: Math.floor(totalMinutes / 60),
    durationMinutes: totalMinutes % 60,
  };
}

function getDurationFromLegacyRange(startTime: string, endTime: string, isOvernight: boolean) {
  const minutes =
    isValidTimeValue(startTime) && isValidTimeValue(endTime)
      ? minutesBetween(startTime, endTime, isOvernight)
      : 0;

  return {
    durationHours: Math.floor(minutes / 60),
    durationMinutes: minutes % 60,
  };
}

function normalizeInteger(value: unknown) {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function normalizeFiniteNumber(value: unknown) {
  const parsed = typeof value === "string" ? Number(value.trim()) : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function normalizeStatus(value: unknown): StudyStatus {
  const normalized = sanitizeText(value).toLowerCase();

  if (normalized === "in progress" || normalized === "active") {
    return "In Progress";
  }

  if (normalized === "completed" || normalized === "complete" || normalized === "done") {
    return "Completed";
  }

  if (normalized === "skipped" || normalized === "cancelled" || normalized === "canceled") {
    return "Skipped";
  }

  return "Not Started";
}

export function normalizeStudyTaskCategory(
  value: unknown,
  context: Partial<Pick<StudyBlockInput & StudyBlock, "task" | "notes">> = {},
): StudyTaskCategory {
  const category = sanitizeText(value);
  if (isStudyTaskCategory(category)) {
    return category;
  }

  const haystack = [category, sanitizeText(context.task), sanitizeText(context.notes)].join(" ").toLowerCase();

  if (/\banki\b/.test(haystack)) {
    return "Anki";
  }

  if (/\b(nbme|uwsa|test|exam|assessment|question bank|questions|uworld|truelearn)\b/.test(haystack)) {
    return "Test";
  }

  if (/\b(note|notes|read|reading|lecture|podcast)\b/.test(haystack)) {
    return "Notes";
  }

  return "Review";
}

export function createStudyBlockIdentity(block: Pick<StudyBlock, "date" | "startTime" | "category" | "task">) {
  return [block.date, block.startTime || "task", block.category, block.task]
    .map((part) => sanitizeText(part).toLowerCase())
    .join("|");
}

export function validateStudyBlockInput(input: Partial<StudyBlockInput>) {
  const errors: Partial<Record<"date" | "task" | "duration" | "category" | "reminder", string>> = {};
  const date = sanitizeText(input.date);
  const task = sanitizeText(input.task);
  const durationHours = sanitizeNumber(input.durationHours, 0);
  const durationMinutes = sanitizeNumber(input.durationMinutes, 0);
  const reminderAt = sanitizeText(input.reminderAt);

  if (!isValidDateValue(date)) {
    errors.date = "Date is required.";
  }

  if (!task) {
    errors.task = "Task is required.";
  }

  if (!isStudyTaskCategory(sanitizeText(input.category))) {
    errors.category = "Choose a valid category.";
  }

  if (
    !Number.isFinite(durationHours) ||
    !Number.isFinite(durationMinutes) ||
    durationHours < 0 ||
    durationMinutes < 0
  ) {
    errors.duration = "Duration must be 0 or greater.";
  }

  if (reminderAt && Number.isNaN(new Date(reminderAt).getTime())) {
    errors.reminder = "Reminder must be a valid date and time.";
  }

  return errors;
}

export function validatePracticeTestInput(input: Partial<PracticeTestInput>) {
  const errors: Partial<Record<"date" | "questionCount" | "scorePercent" | "minutesSpent", string>> = {};
  const questionCount = normalizeInteger(input.questionCount);
  const scorePercent = normalizeFiniteNumber(input.scorePercent);
  const minutesSpent = normalizeInteger(input.minutesSpent);

  if (!isValidDateValue(sanitizeText(input.date))) {
    errors.date = "Date is required.";
  }

  if (!Number.isInteger(questionCount) || questionCount <= 0) {
    errors.questionCount = "Question count must be a whole number greater than 0.";
  }

  if (!Number.isFinite(scorePercent) || scorePercent < 0 || scorePercent > 100) {
    errors.scorePercent = "Score must be between 0 and 100.";
  }

  if (!Number.isInteger(minutesSpent) || minutesSpent < 0) {
    errors.minutesSpent = "Minutes must be 0 or greater.";
  }

  return errors;
}

export function validateWeakTopicInput(input: Partial<WeakTopicInput>) {
  const errors: Partial<Record<"topic", string>> = {};

  if (!sanitizeText(input.topic)) {
    errors.topic = "Topic is required.";
  }

  return errors;
}

function normalizeWeakTopicEntryType(value: unknown, fallback: WeakTopicEntryType = "manual"): WeakTopicEntryType {
  return sanitizeText(value).toLowerCase() === "practice-test" ? "practice-test" : fallback;
}

function sortWeakTopicEntries(entries: WeakTopicEntry[]) {
  return [...entries].sort((left, right) => {
    const priorityOrder: Record<WeakTopicPriority, number> = { High: 0, Medium: 1, Low: 2 };
    const statusOrder: Record<WeakTopicStatus, number> = {
      Active: 0,
      Watching: 1,
      Improving: 2,
      Resolved: 3,
    };
    return (
      priorityOrder[left.priority] - priorityOrder[right.priority] ||
      statusOrder[left.status] - statusOrder[right.status] ||
      right.lastSeenAt.localeCompare(left.lastSeenAt) ||
      left.topic.localeCompare(right.topic)
    );
  });
}

interface NormalizeOptions {
  allowLegacyFallbacks?: boolean;
}

export function normalizeStudyBlock(
  input: Partial<StudyBlockInput & StudyBlock>,
  fallbackId?: string,
  options: NormalizeOptions = {},
) {
  const timestamp = sanitizeText(input.updatedAt) || nowIso();
  const allowLegacyFallbacks = options.allowLegacyFallbacks ?? true;
  const date = sanitizeText(input.date) || getTodayKey();
  const startTime = sanitizeText(input.startTime);
  const endTime = sanitizeText(input.endTime);
  const isOvernight =
    typeof input.isOvernight === "boolean"
      ? input.isOvernight
      : allowLegacyFallbacks &&
          isValidTimeValue(startTime) &&
          isValidTimeValue(endTime) &&
          parseTimeToMinutes(endTime) < parseTimeToMinutes(startTime);
  const legacyDuration = getDurationFromLegacyRange(startTime, endTime, isOvernight);
  const { durationHours, durationMinutes } = normalizeTaskDuration(
    input.durationHours ?? legacyDuration.durationHours,
    input.durationMinutes ?? legacyDuration.durationMinutes,
  );
  const completed =
    typeof input.completed === "boolean"
      ? input.completed
      : normalizeStatus(input.status) === "Completed";

  return {
    id: sanitizeText(input.id) || fallbackId || createId("block"),
    date,
    day: sanitizeText(input.day) || getDayName(date),
    durationHours,
    durationMinutes,
    completed,
    order: Math.max(Math.trunc(sanitizeNumber(input.order, 0)), 0),
    startTime,
    endTime,
    isOvernight,
    category: normalizeStudyTaskCategory(input.category, input),
    task: sanitizeText(input.task) || (allowLegacyFallbacks ? "Untitled study task" : ""),
    status: completed ? "Completed" : "Not Started",
    notes: sanitizeText(input.notes),
    reminderAt: sanitizeText(input.reminderAt) || undefined,
    reminderSentAt: sanitizeText(input.reminderSentAt) || undefined,
    createdAt: sanitizeText(input.createdAt) || timestamp,
    updatedAt: timestamp,
  } satisfies StudyBlock;
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeText(entry)).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

export function normalizePracticeTest(
  input: Partial<PracticeTestInput & PracticeTest>,
  fallbackId?: string,
) {
  const timestamp = sanitizeText(input.updatedAt) || nowIso();
  const legacyTestType = (input as Partial<{ testType: unknown }>).testType;

  return {
    id: sanitizeText(input.id) || fallbackId || createId("test"),
    date: sanitizeText(input.date) || getTodayKey(),
    source: resolvePracticeTestSource(input.source, legacyTestType),
    form: sanitizeText(input.form),
    questionCount: sanitizeNumber(input.questionCount),
    scorePercent: sanitizeNumber(input.scorePercent),
    weakTopics: normalizeStringArray(input.weakTopics),
    strongTopics: normalizeStringArray(input.strongTopics),
    reflections: sanitizeText(input.reflections),
    actionPlan: sanitizeText(input.actionPlan),
    minutesSpent: sanitizeNumber(input.minutesSpent),
    createdAt: sanitizeText(input.createdAt) || timestamp,
    updatedAt: timestamp,
  } satisfies PracticeTest;
}

export function normalizeWeakTopicPriority(value: unknown): WeakTopicPriority {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === "low") {
    return "Low";
  }
  if (normalized === "medium" || normalized === "med") {
    return "Medium";
  }
  return "High";
}

export function normalizeWeakTopicStatus(value: unknown): WeakTopicStatus {
  const normalized = sanitizeText(value).toLowerCase();
  if (normalized === "watching" || normalized === "watch") {
    return "Watching";
  }
  if (normalized === "improving" || normalized === "improve") {
    return "Improving";
  }
  if (normalized === "resolved" || normalized === "done") {
    return "Resolved";
  }
  return "Active";
}

export function normalizeWeakTopicEntry(
  input: Partial<WeakTopicInput & WeakTopicEntry>,
  fallbackId?: string,
  options: NormalizeOptions & { defaultEntryType?: WeakTopicEntryType } = {},
) {
  const timestamp = sanitizeText(input.updatedAt) || nowIso();
  const allowLegacyFallbacks = options.allowLegacyFallbacks ?? true;
  const entryType = normalizeWeakTopicEntryType(input.entryType, options.defaultEntryType ?? "manual");
  const fallbackSourceLabel = entryType === "practice-test" ? "Practice test" : "Manual";

  return {
    id: sanitizeText(input.id) || fallbackId || createId("weak-topic"),
    topic: sanitizeText(input.topic) || (allowLegacyFallbacks ? "Untitled weak topic" : ""),
    entryType,
    priority: normalizeWeakTopicPriority(input.priority),
    status: normalizeWeakTopicStatus(input.status),
    notes: sanitizeText(input.notes),
    lastSeenAt: sanitizeText(input.lastSeenAt) || getTodayKey(),
    sourceLabel: sanitizeText(input.sourceLabel) || fallbackSourceLabel,
    createdAt: sanitizeText(input.createdAt) || timestamp,
    updatedAt: timestamp,
  } satisfies WeakTopicEntry;
}

export function mergeWeakTopicEntriesFromPracticeTests(
  tests: PracticeTest[],
  existingEntries: WeakTopicEntry[] = [],
) {
  const manualEntries = existingEntries.filter((entry) => entry.entryType !== "practice-test");
  const manualTopics = new Set(manualEntries.map((entry) => entry.topic.trim().toLowerCase()));
  const priorAutoEntries = new Map<string, WeakTopicEntry>();

  for (const entry of existingEntries) {
    if (entry.entryType === "practice-test") {
      priorAutoEntries.set(entry.topic.trim().toLowerCase(), entry);
    }
  }

  const byTopic = new Map<string, WeakTopicEntry>();

  for (const test of tests) {
    const sourceLabel = getPracticeTestLabel(test);

    for (const topic of test.weakTopics) {
      const normalizedTopic = topic.trim();
      if (!normalizedTopic) {
        continue;
      }

      const key = normalizedTopic.toLowerCase();
      if (manualTopics.has(key)) {
        continue;
      }

      const existing = byTopic.get(key) ?? priorAutoEntries.get(key);
      const nextLastSeenAt =
        !existing || existing.lastSeenAt.localeCompare(test.date) < 0 ? test.date : existing.lastSeenAt;

      byTopic.set(
        key,
        normalizeWeakTopicEntry({
          ...existing,
          topic: existing?.topic ?? normalizedTopic,
          entryType: "practice-test",
          lastSeenAt: nextLastSeenAt,
          sourceLabel:
            nextLastSeenAt === test.date
              ? sourceLabel
              : existing?.sourceLabel ?? sourceLabel,
        }, existing?.id),
      );
    }
  }

  return sortWeakTopicEntries([...manualEntries, ...byTopic.values()]);
}

function createLegacyBootstrapState() {
  const createdAt = nowIso();
  const studyBlocks = (bootstrapSchedule as StudyBlockInput[]).map((block, index) =>
    normalizeStudyBlock(
      {
        ...block,
        createdAt,
        updatedAt: createdAt,
      },
      `bootstrap-${index}`,
    ),
  );

  return {
    version: APP_STATE_VERSION,
    studyBlocks: studyBlocks.sort(compareStudyBlocks),
    practiceTests: [],
    weakTopicEntries: [],
    preferences: DEFAULT_PREFERENCES,
  } satisfies AppState;
}

function stripLegacyBootstrapSchedule(state: AppState) {
  const legacyBootstrap = createLegacyBootstrapState();
  const normalizeForComparison = (value: AppState) =>
    JSON.stringify({
      studyBlocks: value.studyBlocks.map((block) => ({
        date: block.date,
        day: block.day,
        durationHours: block.durationHours,
        durationMinutes: block.durationMinutes,
        completed: block.completed,
        order: block.order,
        startTime: block.startTime,
        endTime: block.endTime,
        isOvernight: block.isOvernight,
        category: block.category,
        task: block.task,
        status: block.status,
        notes: block.notes,
      })),
      practiceTests: value.practiceTests,
      weakTopicEntries: value.weakTopicEntries,
    });

  if (normalizeForComparison(state) !== normalizeForComparison(legacyBootstrap)) {
    return state;
  }

  return {
    ...state,
    studyBlocks: [],
  } satisfies AppState;
}

function normalizeStudyBlocksForState(studyBlocks: StudyBlock[]) {
  const byDate = new Map<string, StudyBlock[]>();

  for (const block of studyBlocks) {
    const dateBlocks = byDate.get(block.date) ?? [];
    dateBlocks.push(block);
    byDate.set(block.date, dateBlocks);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, dateBlocks]) =>
      [...dateBlocks]
        .sort((left, right) => {
          const orderDifference = left.order - right.order;
          if (orderDifference !== 0) {
            return orderDifference;
          }

          const timeDifference = parseTimeToMinutes(left.startTime) - parseTimeToMinutes(right.startTime);
          if (timeDifference !== 0) {
            return timeDifference;
          }

          return left.task.localeCompare(right.task);
        })
        .map((block, index) => ({
          ...block,
          order: index,
        })),
    );
}

export function createBootstrapState() {
  return {
    version: APP_STATE_VERSION,
    studyBlocks: [],
    practiceTests: [],
    weakTopicEntries: [],
    preferences: DEFAULT_PREFERENCES,
  } satisfies AppState;
}

export function getEmptyStudyBlockDraft(): StudyBlockInput {
  const date = getTodayKey();
  return {
    date,
    day: getDayName(date),
    durationHours: 0,
    durationMinutes: 0,
    completed: false,
    order: 0,
    category: "Review",
    task: "",
    startTime: "",
    endTime: "",
    isOvernight: false,
    reminderAt: "",
  };
}

export function getEmptyPracticeTestDraft(): PracticeTestInput {
  return {
    date: getTodayKey(),
    source: "NBME",
    form: "",
    questionCount: 40,
    scorePercent: 0,
    weakTopics: [],
    strongTopics: [],
    reflections: "",
    actionPlan: "",
    minutesSpent: 0,
  };
}

function normalizePreferences(value: Partial<Preferences> | undefined) {
  const todayKey = getTodayKey();
  const lastActiveDate = sanitizeText(value?.lastActiveDate) || todayKey;
  const shouldResetToToday = lastActiveDate !== todayKey;
  const persistedActiveSection = shouldResetToToday
    ? DEFAULT_PREFERENCES.activeSection
    : value?.activeSection ?? DEFAULT_PREFERENCES.activeSection;
  const activeSection = persistedActiveSection === "planner" ? "dashboard" : persistedActiveSection;
  const plannerFocusDate = shouldResetToToday
    ? todayKey
    : sanitizeText(value?.plannerFocusDate) || DEFAULT_PREFERENCES.plannerFocusDate;

  return {
    activeSection,
    lastActiveDate: todayKey,
    themeId: THEME_VALUES.includes(value?.themeId as ThemeId)
      ? (value?.themeId as ThemeId)
      : DEFAULT_PREFERENCES.themeId,
    dailyGoalMinutes: sanitizeNumber(value?.dailyGoalMinutes, DEFAULT_PREFERENCES.dailyGoalMinutes),
    plannerFilters: {
      ...defaultPlannerFilters,
      ...(value?.plannerFilters ?? {}),
    },
    plannerSort: {
      field: (["date", "order", "category", "task"] as const).includes(
        value?.plannerSort?.field as "date" | "order" | "category" | "task",
      )
        ? (value?.plannerSort?.field as "date" | "order" | "category" | "task")
        : DEFAULT_PREFERENCES.plannerSort.field,
      direction: value?.plannerSort?.direction ?? DEFAULT_PREFERENCES.plannerSort.direction,
    },
    plannerMode: value?.plannerMode ?? DEFAULT_PREFERENCES.plannerMode,
    plannerFocusDate,
  } satisfies Preferences;
}

function fallbackState() {
  return createBootstrapState();
}

function inferLegacyWeakTopicEntryType(
  entry: Partial<WeakTopicEntry>,
  practiceTopicKeys: Set<string>,
): WeakTopicEntryType {
  if (sanitizeText(entry.entryType)) {
    return normalizeWeakTopicEntryType(entry.entryType);
  }

  const topicKey = sanitizeText(entry.topic).toLowerCase();
  const sourceLabel = sanitizeText(entry.sourceLabel).toLowerCase();

  if (topicKey && practiceTopicKeys.has(topicKey) && sourceLabel !== "manual") {
    return "practice-test";
  }

  return "manual";
}

export function normalizeAppState(raw: unknown): AppState {
  if (!raw || typeof raw !== "object") {
    return fallbackState();
  }

  const candidate = raw as Partial<AppState>;
  const fallback = fallbackState();
  const studyBlocks = Array.isArray(candidate.studyBlocks)
    ? candidate.studyBlocks.map((block, index) =>
        normalizeStudyBlock(block, `stored-${index}`, { allowLegacyFallbacks: true }),
      )
    : fallback.studyBlocks;
  const practiceTests = Array.isArray(candidate.practiceTests)
    ? candidate.practiceTests.map((test, index) => normalizePracticeTest(test, `test-${index}`))
    : [];
  const practiceTopicKeys = new Set(
    practiceTests.flatMap((test) => test.weakTopics.map((topic) => topic.trim().toLowerCase()).filter(Boolean)),
  );
  const weakTopicEntries = Array.isArray(candidate.weakTopicEntries)
    ? candidate.weakTopicEntries.map((entry, index) =>
        normalizeWeakTopicEntry(entry, `weak-topic-${index}`, {
          allowLegacyFallbacks: true,
          defaultEntryType: inferLegacyWeakTopicEntryType(entry, practiceTopicKeys),
        }),
      )
    : [];

  return stripLegacyBootstrapSchedule({
    version: APP_STATE_VERSION,
    studyBlocks: normalizeStudyBlocksForState(studyBlocks).sort(compareStudyBlocks),
    practiceTests: practiceTests.sort((left, right) => left.date.localeCompare(right.date)),
    weakTopicEntries: mergeWeakTopicEntriesFromPracticeTests(practiceTests, weakTopicEntries),
    preferences: normalizePreferences(candidate.preferences),
  });
}

export interface LegacyBrowserMigrationPayload {
  legacySourceJson: string;
  state: AppState;
}

function readSnapshotState() {
  if (typeof window === "undefined") {
    return null;
  }

  const snapshot = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  if (snapshot) {
    try {
      const parsed = JSON.parse(snapshot) as { state?: unknown };
      if (parsed?.state) {
        return normalizeAppState(parsed.state);
      }
    } catch {
      window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    }
  }

  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) {
    return null;
  }

  try {
    return normalizeAppState(JSON.parse(legacy));
  } catch {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return null;
  }
}

export function loadPersistedState() {
  return readSnapshotState() ?? fallbackState();
}

export async function getLegacyBrowserMigrationPayload(): Promise<LegacyBrowserMigrationPayload | null> {
  const databaseState = await readDatabaseRecord();
  if (databaseState) {
    return {
      legacySourceJson: JSON.stringify(databaseState, null, 2),
      state: normalizeAppState(databaseState),
    };
  }

  if (typeof window === "undefined") {
    return null;
  }

  const snapshot = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
  if (snapshot) {
    try {
      const parsed = JSON.parse(snapshot) as { state?: unknown };
      if (parsed?.state) {
        return {
          legacySourceJson: snapshot,
          state: normalizeAppState(parsed.state),
        };
      }
    } catch {
      window.localStorage.removeItem(SNAPSHOT_STORAGE_KEY);
    }
  }

  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacy) {
    return null;
  }

  try {
    return {
      legacySourceJson: legacy,
      state: normalizeAppState(JSON.parse(legacy)),
    };
  } catch {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return null;
  }
}

export function matchesBootstrapSeed(state: AppState) {
  const bootstrap = createBootstrapState();
  const normalizeForComparison = (value: AppState) => ({
    studyBlocks: value.studyBlocks.map((block) => ({
      date: block.date,
      day: block.day,
      durationHours: block.durationHours,
      durationMinutes: block.durationMinutes,
      completed: block.completed,
      order: block.order,
      startTime: block.startTime,
      endTime: block.endTime,
      isOvernight: block.isOvernight,
      category: block.category,
      task: block.task,
      status: block.status,
      notes: block.notes,
    })),
    practiceTests: value.practiceTests,
    weakTopicEntries: value.weakTopicEntries,
    preferences: value.preferences,
  });

  return JSON.stringify(normalizeForComparison(state)) === JSON.stringify(normalizeForComparison(bootstrap));
}

function snapshotState(state: AppState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SNAPSHOT_STORAGE_KEY,
    JSON.stringify({
      savedAt: nowIso(),
      state,
    }),
  );
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function openDatabase() {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve<IDBDatabase | null>(null);
  }

  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DATABASE_STORE)) {
        database.createObjectStore(DATABASE_STORE);
      }
    };

    request.onerror = () => reject(request.error ?? new Error("Unable to open local database."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readDatabaseRecord() {
  const database = await openDatabase();
  if (!database) {
    return null;
  }

  return new Promise<unknown>((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, "readonly");
    const store = transaction.objectStore(DATABASE_STORE);
    const request = store.get(DATABASE_RECORD_KEY);

    request.onerror = () => reject(request.error ?? new Error("Unable to read local database."));
    request.onsuccess = () => resolve(request.result ?? null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to finish database read."));
  });
}

async function writeDatabaseRecord(value: AppState) {
  const database = await openDatabase();
  if (!database) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(DATABASE_STORE, "readwrite");
    const store = transaction.objectStore(DATABASE_STORE);
    const request = store.put(value, DATABASE_RECORD_KEY);

    request.onerror = () => reject(request.error ?? new Error("Unable to write local database."));
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("Unable to finish database write."));
  });
}

export async function loadPersistedStateFromDatabase() {
  const databaseState = await readDatabaseRecord();
  return normalizeAppState(databaseState ?? readSnapshotState() ?? fallbackState());
}

export async function persistState(state: AppState) {
  snapshotState(state);
  await writeDatabaseRecord(state);
}

export function exportBackupPayload(state: AppState) {
  return JSON.stringify(
    {
      app: "step2-command-center",
      version: APP_STATE_VERSION,
      exportedAt: nowIso(),
      state,
    } satisfies BackupPayload,
    null,
    2,
  );
}

export function parseBackupPayload(raw: string) {
  const parsed = JSON.parse(raw) as Partial<BackupPayload>;
  if (parsed.app !== "step2-command-center") {
    throw new Error("This backup file is not for Step 2 Command Center.");
  }

  return normalizeAppState(parsed.state);
}

export function mergeStudyBlocks(existingBlocks: StudyBlock[], incomingBlocks: StudyBlock[]) {
  const merged = new Map(existingBlocks.map((block) => [createStudyBlockIdentity(block), block]));

  for (const block of incomingBlocks) {
    const identity = createStudyBlockIdentity(block);
    const previous = merged.get(identity);
    merged.set(identity, {
      ...block,
      id: previous?.id ?? block.id,
      createdAt: previous?.createdAt ?? block.createdAt,
      updatedAt: block.updatedAt,
    });
  }

  return [...merged.values()].sort(compareStudyBlocks);
}
