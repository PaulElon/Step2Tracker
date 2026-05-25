import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloudPreferencesPayload,
  mergeCloudPreferencesIntoDesktop,
  pullFromCloud,
  pushAllEntities,
} from "../../src/lib/cloud-sync-manager.ts";
import type { CloudDeleteTombstone } from "../../src/lib/native-persistence.ts";
import type {
  AppState,
  Preferences,
  TfAppState,
  TfSessionLog,
  TfSessionLogTombstone,
} from "../../src/types/models.ts";

const previousFetch = globalThis.fetch;
const FIXED_PUSH_TIME = "2026-05-22T12:34:56.000Z";

test.afterEach(() => {
  globalThis.fetch = previousFetch;
});

function createEmptyState(): AppState {
  return {
    version: 6,
    studyBlocks: [],
    practiceTests: [],
    weakTopicEntries: [],
    errorLogEntries: [],
    preferences: {
      activeSection: "dashboard",
      lastActiveDate: "2026-05-19",
      themeId: "dark",
      dailyGoalMinutes: 480,
      plannerFilters: {
        search: "",
        category: "All",
        status: "All",
        fromDate: "",
        toDate: "",
      },
      plannerSort: {
        field: "date",
        direction: "asc",
      },
      plannerMode: "week",
      plannerFocusDate: "2026-05-19",
      enhancedThemeIds: [],
      customCategories: ["Test", "Review", "Anki", "Notes"],
      resourceLinks: [],
      examTimers: [],
      notesHtml: "",
      notebookFolders: [],
      notebookPages: [],
      notebookDocuments: [],
      scoreTrendOptions: {
        showConnectionLine: false,
        showBestFitLine: true,
        showBestFitRSquared: false,
      },
      syncAutoTrackerSessionLogs: false,
    },
  };
}

function createEmptyTfState(): TfAppState {
  return {
    tfVersion: 1,
    sessionLogs: [],
    sessionLogTombstones: [],
    summaries: [],
    trackerPrefs: {
      customAutoApps: [],
      customAutoWebsites: [],
      customDistractionApps: [],
      customDistractionWebsites: [],
    },
    account: null,
  };
}

function buildSessionLog(overrides: Partial<TfSessionLog> = {}): TfSessionLog {
  return {
    id: overrides.id ?? "manual-1",
    date: overrides.date ?? "2026-05-12",
    method: overrides.method ?? "Manual Review",
    methodKey: overrides.methodKey ?? "manual-review",
    hours: overrides.hours ?? 1.5,
    startISO: overrides.startISO ?? "2026-05-12T10:00:00.000Z",
    endISO: overrides.endISO ?? "2026-05-12T11:30:00.000Z",
    notes: overrides.notes ?? "Focused review.",
    isDistraction: overrides.isDistraction ?? false,
    isLive: overrides.isLive ?? false,
    updatedAt: overrides.updatedAt ?? "2026-05-12T11:35:00.000Z",
  };
}

function buildSessionTombstone(
  overrides: Partial<TfSessionLogTombstone> & Pick<TfSessionLogTombstone, "id" | "deletedAt">,
): TfSessionLogTombstone {
  return {
    id: overrides.id,
    deletedAt: overrides.deletedAt,
    ...(overrides.schemaVersion !== undefined ? { schemaVersion: overrides.schemaVersion } : {}),
    ...(overrides.syncEligible !== undefined ? { syncEligible: overrides.syncEligible } : {}),
    ...(overrides.syncSource !== undefined ? { syncSource: overrides.syncSource } : {}),
  };
}

test("pushAllEntities sends recent upserts and delete tombstones and preserves the worker cursor", async () => {
  const state = createEmptyState();
  state.preferences.updatedAt = "2026-05-17T09:30:00.000Z";
  state.studyBlocks = [
    {
      id: "study-old",
      date: "2026-05-08",
      day: "Friday",
      durationHours: 1,
      durationMinutes: 0,
      completed: false,
      order: 0,
      startTime: "08:00",
      endTime: "09:00",
      isOvernight: false,
      category: "Review",
      task: "Older block",
      status: "Not Started",
      notes: "",
      createdAt: "2026-05-08T08:00:00.000Z",
      updatedAt: "2026-05-08T09:00:00.000Z",
    },
    {
      id: "study-new",
      date: "2026-05-12",
      day: "Tuesday",
      durationHours: 2,
      durationMinutes: 0,
      completed: true,
      order: 1,
      startTime: "10:00",
      endTime: "12:00",
      isOvernight: false,
      category: "Test",
      task: "Newer block",
      status: "Completed",
      notes: "keep",
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T12:00:00.000Z",
    },
  ];
  state.practiceTests = [
    {
      id: "test-new",
      date: "2026-05-13",
      source: "NBME",
      form: "10",
      questionCount: 200,
      scorePercent: 72,
      weakTopics: ["Cardio"],
      strongTopics: ["Renal"],
      reflections: "",
      actionPlan: "",
      minutesSpent: 180,
      createdAt: "2026-05-13T08:00:00.000Z",
      updatedAt: "2026-05-13T11:00:00.000Z",
    },
  ];
  state.weakTopicEntries = [
    {
      id: "weak-old",
      topic: "Old topic",
      entryType: "manual",
      priority: "Low",
      status: "Improving",
      notes: "",
      lastSeenAt: "2026-05-07",
      sourceLabel: "Manual",
      manualOccurrenceCount: 0,
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:00:00.000Z",
    },
    {
      id: "weak-new",
      topic: "Fresh topic",
      entryType: "practice-test",
      priority: "High",
      status: "Active",
      notes: "",
      lastSeenAt: "2026-05-13",
      sourceLabel: "NBME 10",
      manualOccurrenceCount: 0,
      createdAt: "2026-05-13T08:00:00.000Z",
      updatedAt: "2026-05-13T11:00:00.000Z",
    },
  ];
  state.errorLogEntries = [
    {
      id: "error-old",
      source: "UWorld",
      examBlock: "Block 1",
      system: "IM/FM",
      topic: "Older error",
      errorType: "Knowledge Gap",
      missedPattern: "missed",
      fix: "fix",
      whyPickedWrongAnswer: "",
      whyCorrectAnswerIsCorrect: "",
      whyTemptingWrongAnswerIsWrong: "",
      decisionRule: "",
      isRepeatMiss: false,
      followUpAction: "",
      isGuessedCorrect: false,
      addToFinalSheet: false,
      priority: "medium",
      entryDate: "2026-05-07",
      createdAt: "2026-05-07T08:00:00.000Z",
      updatedAt: "2026-05-07T09:00:00.000Z",
    },
    {
      id: "error-new",
      source: "NBME",
      examBlock: "Block 2",
      system: "Surgery",
      topic: "Fresh error",
      errorType: "Reasoning Error",
      missedPattern: "pattern",
      fix: "fix",
      whyPickedWrongAnswer: "",
      whyCorrectAnswerIsCorrect: "",
      whyTemptingWrongAnswerIsWrong: "",
      decisionRule: "",
      isRepeatMiss: true,
      followUpAction: "make-anki",
      isGuessedCorrect: false,
      addToFinalSheet: true,
      priority: "high",
      entryDate: "2026-05-13",
      createdAt: "2026-05-13T08:00:00.000Z",
      updatedAt: "2026-05-13T11:00:00.000Z",
    },
  ];

  const tombstones: CloudDeleteTombstone[] = [
    {
      entityType: "study_block",
      entityId: "study-deleted-old",
      deletedAt: "2026-05-08T12:00:00.000Z",
    },
    {
      entityType: "practice_test",
      entityId: "practice-deleted-new",
      deletedAt: "2026-05-14T12:00:00.000Z",
    },
    {
      entityType: "weak_topic_entry",
      entityId: "weak-deleted-new",
      deletedAt: "2026-05-15T12:00:00.000Z",
    },
    {
      entityType: "error_log_entry",
      entityId: "error-deleted-new",
      deletedAt: "2026-05-16T12:00:00.000Z",
    },
  ];

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 77 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await pushAllEntities(
    "token-123",
    "device-123",
    state,
    "2026-05-10T00:00:00.000Z",
    tombstones,
    {
      loadTfState: async () => createEmptyTfState(),
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  assert.deepEqual(result, { pushed: 8, cursor: 77 });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.url.endsWith("/sync/push"), true);
  assert.equal(fetchCalls[0]?.init?.method, "POST");
  assert.equal(fetchCalls[0]?.init?.headers instanceof Headers, false);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    deviceId: string;
    entities: Array<Record<string, unknown>>;
  };
  assert.equal(body.deviceId, "device-123");
  assert.deepEqual(body.entities, [
    {
      entityType: "study_block",
      entityId: "study-new",
      operation: "upsert",
      payload: state.studyBlocks[1],
      clientUpdatedAt: "2026-05-12T12:00:00.000Z",
    },
    {
      entityType: "practice_test",
      entityId: "test-new",
      operation: "upsert",
      payload: state.practiceTests[0],
      clientUpdatedAt: "2026-05-13T11:00:00.000Z",
    },
    {
      entityType: "weak_topic_entry",
      entityId: "weak-new",
      operation: "upsert",
      payload: state.weakTopicEntries[1],
      clientUpdatedAt: "2026-05-13T11:00:00.000Z",
    },
    {
      entityType: "error_log_entry",
      entityId: "error-new",
      operation: "upsert",
      payload: state.errorLogEntries[1],
      clientUpdatedAt: "2026-05-13T11:00:00.000Z",
    },
    {
      entityType: "preferences",
      entityId: "preferences",
      operation: "upsert",
      payload: {
        dailyGoalMinutes: 480,
        themeId: "dark",
        enhancedThemeIds: [],
        plannerFocusDate: "2026-05-19",
        examTimers: [],
        customCategories: [
          { id: "custom-category-test", label: "Test" },
          { id: "custom-category-review", label: "Review" },
          { id: "custom-category-anki", label: "Anki" },
          { id: "custom-category-notes", label: "Notes" },
        ],
        resourceLinks: [],
        trackerPrefs: {
          customAutoApps: [],
          customAutoWebsites: [],
          customDistractionApps: [],
          customDistractionWebsites: [],
        },
        updatedAt: "2026-05-17T09:30:00.000Z",
      },
      clientUpdatedAt: "2026-05-17T09:30:00.000Z",
    },
    {
      entityType: "practice_test",
      entityId: "practice-deleted-new",
      operation: "delete",
      payload: null,
      clientUpdatedAt: "2026-05-14T12:00:00.000Z",
    },
    {
      entityType: "weak_topic_entry",
      entityId: "weak-deleted-new",
      operation: "delete",
      payload: null,
      clientUpdatedAt: "2026-05-15T12:00:00.000Z",
    },
    {
      entityType: "error_log_entry",
      entityId: "error-deleted-new",
      operation: "delete",
      payload: null,
      clientUpdatedAt: "2026-05-16T12:00:00.000Z",
    },
  ]);
});

test("pushAllEntities falls back to the current sync time when preferences updatedAt is missing", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 78 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const result = await pushAllEntities(
    "token-123",
    "device-123",
    createEmptyState(),
    "2026-05-10T00:00:00.000Z",
    [
      {
        entityType: "study_block",
        entityId: "study-deleted-old",
        deletedAt: "2026-05-08T12:00:00.000Z",
      },
    ],
    {
      loadTfState: async () => createEmptyTfState(),
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  assert.deepEqual(result, { pushed: 1, cursor: 78 });
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    deviceId: string;
    entities: Array<Record<string, unknown>>;
  };
  assert.equal(body.entities.length, 1);
  assert.deepEqual(body.entities[0], {
    entityType: "preferences",
    entityId: "preferences",
    operation: "upsert",
    payload: {
      dailyGoalMinutes: 480,
      themeId: "dark",
      enhancedThemeIds: [],
      plannerFocusDate: "2026-05-19",
      examTimers: [],
      customCategories: [
        { id: "custom-category-test", label: "Test" },
        { id: "custom-category-review", label: "Review" },
        { id: "custom-category-anki", label: "Anki" },
        { id: "custom-category-notes", label: "Notes" },
      ],
      resourceLinks: [],
      trackerPrefs: {
        customAutoApps: [],
        customAutoWebsites: [],
        customDistractionApps: [],
        customDistractionWebsites: [],
      },
      updatedAt: FIXED_PUSH_TIME,
    },
    clientUpdatedAt: FIXED_PUSH_TIME,
  });
});

test("pushAllEntities adds canonical safe session_log upserts and skips unsafe or old rows", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 91 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const tfState = createEmptyTfState();
  tfState.sessionLogs = [
    buildSessionLog({
      id: "manual-safe-new",
      method: "Manual Review",
      notes: "Focused renal review.",
      updatedAt: "2026-05-12T11:35:00.000Z",
      startISO: "2026-05-12T10:00:00.000Z",
      endISO: "2026-05-12T11:30:00.000Z",
    }),
    buildSessionLog({
      id: "manual-safe-old",
      updatedAt: "2026-05-09T11:35:00.000Z",
    }),
    buildSessionLog({
      id: "nat-device-1-span-1",
      method: "UWorld",
      notes: "Focused review.",
    }),
    buildSessionLog({
      id: "manual-unsafe-notes",
      notes: "browserUrl=https://apps.uworld.com browserTitle=UWorld",
    }),
    buildSessionLog({
      id: "manual-live",
      isLive: true,
    }),
    buildSessionLog({
      id: "auto-derived",
      method: "Question Bank [Auto]",
    }),
  ];

  const result = await pushAllEntities(
    "token-123",
    "device-123",
    createEmptyState(),
    "2026-05-10T00:00:00.000Z",
    [],
    {
      loadTfState: async () => tfState,
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  assert.deepEqual(result, { pushed: 2, cursor: 91 });
  assert.equal(fetchCalls.length, 1);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    deviceId: string;
    entities: Array<Record<string, unknown>>;
  };

  assert.equal(body.deviceId, "device-123");
  assert.deepEqual(body.entities, [
    {
      entityType: "preferences",
      entityId: "preferences",
      operation: "upsert",
      payload: {
        dailyGoalMinutes: 480,
        themeId: "dark",
        enhancedThemeIds: [],
        plannerFocusDate: "2026-05-19",
        examTimers: [],
        customCategories: [
          { id: "custom-category-test", label: "Test" },
          { id: "custom-category-review", label: "Review" },
          { id: "custom-category-anki", label: "Anki" },
          { id: "custom-category-notes", label: "Notes" },
        ],
        resourceLinks: [],
        trackerPrefs: {
          customAutoApps: [],
          customAutoWebsites: [],
          customDistractionApps: [],
          customDistractionWebsites: [],
        },
        updatedAt: FIXED_PUSH_TIME,
      },
      clientUpdatedAt: FIXED_PUSH_TIME,
    },
    {
      entityType: "session_log",
      entityId: "manual-safe-new",
      operation: "upsert",
      payload: {
        schemaVersion: 1,
        id: "manual-safe-new",
        date: "2026-05-12",
        title: "Manual Review",
        category: "manual-review",
        source: "manual",
        durationMinutes: 90,
        startAt: "2026-05-12T10:00:00.000Z",
        endAt: "2026-05-12T11:30:00.000Z",
        notes: "Focused renal review.",
        isDistraction: false,
        updatedAt: "2026-05-12T11:35:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T11:35:00.000Z",
    },
  ]);
});

test("pushAllEntities includes opted-in auto-tracker session logs and preserves canonical payload shape", async () => {
  const state = createEmptyState();
  state.preferences.syncAutoTrackerSessionLogs = true;

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 93 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const tfState = createEmptyTfState();
  tfState.sessionLogs = [
    buildSessionLog({
      id: "manual-safe-new",
      method: "Manual Review",
      notes: "Focused renal review.",
      updatedAt: "2026-05-12T11:35:00.000Z",
      startISO: "2026-05-12T10:00:00.000Z",
      endISO: "2026-05-12T11:30:00.000Z",
    }),
    buildSessionLog({
      id: "auto-focus-new",
      method: "Question Bank [Auto]",
      notes: "",
      updatedAt: "2026-05-12T12:35:00.000Z",
      startISO: "2026-05-12T11:45:00.000Z",
      endISO: "2026-05-12T12:30:00.000Z",
      hours: 0.75,
    }),
    buildSessionLog({
      id: "auto-missing-method",
      method: "",
      notes: "",
      updatedAt: "2026-05-12T12:40:00.000Z",
    }),
    buildSessionLog({
      id: "auto-live",
      method: "Slack [Auto]",
      isLive: true,
      notes: "",
      updatedAt: "2026-05-12T12:45:00.000Z",
    }),
  ];

  const result = await pushAllEntities(
    "token-123",
    "device-123",
    state,
    "2026-05-10T00:00:00.000Z",
    [],
    {
      loadTfState: async () => tfState,
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  assert.deepEqual(result, { pushed: 3, cursor: 93 });
  assert.equal(fetchCalls.length, 1);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    deviceId: string;
    entities: Array<Record<string, unknown>>;
  };

  const sessionLogEntities = body.entities.filter((entry) => entry.entityType === "session_log");
  assert.deepEqual(sessionLogEntities, [
    {
      entityType: "session_log",
      entityId: "manual-safe-new",
      operation: "upsert",
      payload: {
        schemaVersion: 1,
        id: "manual-safe-new",
        date: "2026-05-12",
        title: "Manual Review",
        category: "manual-review",
        source: "manual",
        durationMinutes: 90,
        startAt: "2026-05-12T10:00:00.000Z",
        endAt: "2026-05-12T11:30:00.000Z",
        notes: "Focused renal review.",
        isDistraction: false,
        updatedAt: "2026-05-12T11:35:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T11:35:00.000Z",
    },
    {
      entityType: "session_log",
      entityId: "auto-focus-new",
      operation: "upsert",
      payload: {
        schemaVersion: 1,
        id: "auto-focus-new",
        date: "2026-05-12",
        title: "Question Bank",
        category: "question-bank",
        source: "imported",
        durationMinutes: 45,
        startAt: "2026-05-12T11:45:00.000Z",
        endAt: "2026-05-12T12:30:00.000Z",
        notes: "",
        isDistraction: false,
        updatedAt: "2026-05-12T12:35:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T12:35:00.000Z",
    },
  ]);
});

test("pushAllEntities pushes only eligible session_log deletes after the watermark", async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 92 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const tfState = createEmptyTfState();
  tfState.sessionLogTombstones = [
    buildSessionTombstone({
      id: "session-safe-manual-new",
      deletedAt: "2026-05-12T12:00:00.000Z",
      schemaVersion: 1,
      syncEligible: true,
      syncSource: "manual",
    }),
    buildSessionTombstone({
      id: "session-safe-imported-new",
      deletedAt: "2026-05-13T12:00:00.000Z",
      schemaVersion: 1,
      syncEligible: true,
      syncSource: "imported",
    }),
    buildSessionTombstone({
      id: "session-unsafe-live",
      deletedAt: "2026-05-14T12:00:00.000Z",
      schemaVersion: 1,
      syncEligible: false,
    }),
    buildSessionTombstone({
      id: "session-legacy",
      deletedAt: "2026-05-15T12:00:00.000Z",
    }),
    buildSessionTombstone({
      id: "session-safe-manual-old",
      deletedAt: "2026-05-09T12:00:00.000Z",
      schemaVersion: 1,
      syncEligible: true,
      syncSource: "manual",
    }),
  ];

  const result = await pushAllEntities(
    "token-123",
    "device-123",
    createEmptyState(),
    "2026-05-10T00:00:00.000Z",
    [],
    {
      loadTfState: async () => tfState,
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  assert.deepEqual(result, { pushed: 3, cursor: 92 });
  assert.equal(fetchCalls.length, 1);

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    deviceId: string;
    entities: Array<Record<string, unknown>>;
  };

  assert.deepEqual(body.entities, [
    {
      entityType: "preferences",
      entityId: "preferences",
      operation: "upsert",
      payload: {
        dailyGoalMinutes: 480,
        themeId: "dark",
        enhancedThemeIds: [],
        plannerFocusDate: "2026-05-19",
        examTimers: [],
        customCategories: [
          { id: "custom-category-test", label: "Test" },
          { id: "custom-category-review", label: "Review" },
          { id: "custom-category-anki", label: "Anki" },
          { id: "custom-category-notes", label: "Notes" },
        ],
        resourceLinks: [],
        trackerPrefs: {
          customAutoApps: [],
          customAutoWebsites: [],
          customDistractionApps: [],
          customDistractionWebsites: [],
        },
        updatedAt: FIXED_PUSH_TIME,
      },
      clientUpdatedAt: FIXED_PUSH_TIME,
    },
    {
      entityType: "session_log",
      entityId: "session-safe-manual-new",
      operation: "delete",
      payload: null,
      clientUpdatedAt: "2026-05-12T12:00:00.000Z",
    },
    {
      entityType: "session_log",
      entityId: "session-safe-imported-new",
      operation: "delete",
      payload: null,
      clientUpdatedAt: "2026-05-13T12:00:00.000Z",
    },
  ]);
});

test("pullFromCloud applies only newer upserts and persists the pull cursor", async () => {
  const state = createEmptyState();
  state.studyBlocks = [
    {
      id: "study-1",
      date: "2026-05-10",
      day: "Sunday",
      durationHours: 1,
      durationMinutes: 30,
      completed: false,
      order: 0,
      startTime: "08:00",
      endTime: "09:30",
      isOvernight: false,
      category: "Review",
      task: "Local block",
      status: "Not Started",
      notes: "",
      createdAt: "2026-05-10T08:00:00.000Z",
      updatedAt: "2026-05-10T09:30:00.000Z",
    },
  ];
  state.practiceTests = [
    {
      id: "test-1",
      date: "2026-05-12",
      source: "NBME",
      form: "11",
      questionCount: 200,
      scorePercent: 78,
      weakTopics: ["Cardio"],
      strongTopics: ["GI"],
      reflections: "",
      actionPlan: "",
      minutesSpent: 180,
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-13T09:00:00.000Z",
    },
  ];
  state.errorLogEntries = [
    {
      id: "error-1",
      source: "TrueLearn",
      examBlock: "Block 3",
      system: "Pediatrics",
      topic: "Local error",
      errorType: "Trap / Misread",
      missedPattern: "local",
      fix: "local fix",
      whyPickedWrongAnswer: "",
      whyCorrectAnswerIsCorrect: "",
      whyTemptingWrongAnswerIsWrong: "",
      decisionRule: "",
      isRepeatMiss: false,
      followUpAction: "",
      isGuessedCorrect: false,
      addToFinalSheet: false,
      priority: "medium",
      entryDate: "2026-05-10",
      createdAt: "2026-05-10T08:00:00.000Z",
      updatedAt: "2026-05-10T09:00:00.000Z",
    },
  ];

  let storedCursor: number | null = null;
  const fetchCalls: string[] = [];
  const appliedStudyBlocks: string[] = [];
  const appliedPracticeTests: string[] = [];
  const appliedErrorLogs: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    fetchCalls.push(String(url));
    return new Response(
      JSON.stringify({
        cursor: 88,
        entries: [
          {
            entityType: "study_block",
            entityId: "study-1",
            operation: "upsert",
            clientUpdatedAt: "2026-05-14T09:30:00.000Z",
            payload: {
              ...state.studyBlocks[0],
              task: "Cloud block",
              updatedAt: "2026-05-14T09:30:00.000Z",
            },
          },
          {
            entityType: "practice_test",
            entityId: "test-1",
            operation: "upsert",
            clientUpdatedAt: "2026-05-11T09:00:00.000Z",
            payload: {
              ...state.practiceTests[0],
              form: "stale",
              updatedAt: "2026-05-11T09:00:00.000Z",
            },
          },
          {
            entityType: "error_log_entry",
            entityId: "error-1",
            operation: "upsert",
            clientUpdatedAt: "2026-05-14T10:00:00.000Z",
            payload: {
              ...state.errorLogEntries[0],
              topic: "Cloud error",
              updatedAt: "2026-05-14T10:00:00.000Z",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => null,
    setCursor: async (value) => {
      storedCursor = value;
    },
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    getDeleteTombstones: async () => [],
    applyStudyBlock: async (block) => {
      appliedStudyBlocks.push(block.task);
    },
    applyPracticeTest: async (practiceTest) => {
      appliedPracticeTests.push(practiceTest.form);
    },
    applyWeakTopic: async () => {
      throw new Error("weak topic apply should not run");
    },
    applyErrorLog: async (entry) => {
      appliedErrorLogs.push(entry.topic);
    },
    applyDelete: async () => {
      throw new Error("delete apply should not run");
    },
  });

  assert.equal(fetchCalls[0], "https://timefolio-sync-v2.paulfreedman3.workers.dev/sync/pull?since=0&deviceId=device-123");
  assert.deepEqual(appliedStudyBlocks, ["Cloud block"]);
  assert.deepEqual(appliedPracticeTests, []);
  assert.deepEqual(appliedErrorLogs, ["Cloud error"]);
  assert.equal(storedCursor, 88);
  assert.deepEqual(result, {
    received: 3,
    applied: 2,
    upserted: 2,
    deleted: 0,
    skipped: 1,
    cursor: 88,
  });
});

test("pullFromCloud applies only newer deletes", async () => {
  const state = createEmptyState();
  state.studyBlocks = [
    {
      id: "study-delete",
      date: "2026-05-10",
      day: "Sunday",
      durationHours: 1,
      durationMinutes: 0,
      completed: false,
      order: 0,
      startTime: "08:00",
      endTime: "09:00",
      isOvernight: false,
      category: "Review",
      task: "Delete me",
      status: "Not Started",
      notes: "",
      createdAt: "2026-05-10T08:00:00.000Z",
      updatedAt: "2026-05-10T09:00:00.000Z",
    },
  ];
  state.practiceTests = [
    {
      id: "test-keep",
      date: "2026-05-12",
      source: "NBME",
      form: "12",
      questionCount: 200,
      scorePercent: 80,
      weakTopics: ["Cardio"],
      strongTopics: ["GI"],
      reflections: "",
      actionPlan: "",
      minutesSpent: 180,
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-14T09:00:00.000Z",
    },
  ];

  const deletes: Array<{ entityType: string; entityId: string; deletedAt: string }> = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 41,
        entries: [
          {
            entityType: "study_block",
            entityId: "study-delete",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-11T09:00:00.000Z",
          },
          {
            entityType: "practice_test",
            entityId: "test-keep",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-13T09:00:00.000Z",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => 9,
    setCursor: async () => {},
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    getDeleteTombstones: async () => [],
    applyStudyBlock: async () => {
      throw new Error("study block apply should not run");
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async () => {
      throw new Error("weak topic apply should not run");
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async (entityType, entityId, deletedAt) => {
      deletes.push({ entityType, entityId, deletedAt });
    },
  });

  assert.deepEqual(deletes, [
    {
      entityType: "study_block",
      entityId: "study-delete",
      deletedAt: "2026-05-11T09:00:00.000Z",
    },
  ]);
  assert.deepEqual(result, {
    received: 2,
    applied: 1,
    upserted: 0,
    deleted: 1,
    skipped: 1,
    cursor: 41,
  });
});

test("pullFromCloud ignores unsupported entity types and still advances the cursor", async () => {
  const state = createEmptyState();
  const appliedWeakTopics: string[] = [];
  const appliedPreferences: Preferences[] = [];
  const appliedSessions: TfSessionLog[] = [];
  const deletes: Array<{ entityType: string; entityId: string; deletedAt: string }> = [];
  let storedCursor: number | null = null;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 44,
        entries: [
          {
            entityType: "preferences",
            entityId: "prefs-user",
            operation: "upsert",
            payload: {
              themeId: "light",
              dailyGoalMinutes: 300,
            },
            clientUpdatedAt: "2026-05-14T08:00:00.000Z",
          },
          {
            entityType: "future_entity",
            entityId: "future-1",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-14T08:10:00.000Z",
          },
          {
            entityType: "session_log",
            entityId: "session-1",
            operation: "upsert",
            payload: {
              id: "session-1",
            },
            clientUpdatedAt: "2026-05-14T08:20:00.000Z",
          },
          {
            entityType: "weak_topic_entry",
            entityId: "weak-1",
            operation: "upsert",
            payload: {
              id: "weak-1",
              topic: "Cardio",
              entryType: "manual",
              priority: "High",
              status: "Active",
              sourceLabel: "Manual",
              manualOccurrenceCount: 1,
              createdAt: "2026-05-14T07:50:00.000Z",
              updatedAt: "2026-05-14T08:30:00.000Z",
            },
            clientUpdatedAt: "2026-05-14T08:30:00.000Z",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => 13,
    setCursor: async (value) => {
      storedCursor = value;
    },
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    loadTfState: async () => createEmptyTfState(),
    getDeleteTombstones: async () => [],
    applyStudyBlock: async () => {
      throw new Error("study block apply should not run");
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async (entry) => {
      appliedWeakTopics.push(entry.id);
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async (entityType, entityId, deletedAt) => {
      deletes.push({ entityType, entityId, deletedAt });
    },
    applySessionLog: async (session) => {
      appliedSessions.push(session);
    },
    applySessionLogDelete: async () => {
      throw new Error("session log delete apply should not run");
    },
    applyPreferences: async (preferences) => {
      appliedPreferences.push(preferences);
    },
  });

  assert.deepEqual(appliedWeakTopics, ["weak-1"]);
  assert.equal(appliedPreferences.length, 1);
  assert.equal(appliedPreferences[0].themeId, "light");
  assert.equal(appliedPreferences[0].dailyGoalMinutes, 300);
  assert.equal(appliedSessions.length, 1);
  assert.equal(appliedSessions[0].id, "session-1");
  assert.equal(appliedSessions[0].method, "Other");
  assert.deepEqual(deletes, []);
  assert.equal(storedCursor, 44);
  assert.deepEqual(result, {
    received: 4,
    applied: 3,
    upserted: 3,
    deleted: 0,
    skipped: 1,
    cursor: 44,
  });
});

test("pullFromCloud coerces legacy string payloads, skips malformed rows, and still advances the cursor", async () => {
  const state = createEmptyState();
  state.studyBlocks = [
    {
      id: "study-local",
      date: "2026-05-12",
      day: "Tuesday",
      durationHours: 1,
      durationMinutes: 0,
      completed: false,
      order: 0,
      startTime: "08:00",
      endTime: "09:00",
      isOvernight: false,
      category: "Review",
      task: "Local block",
      status: "Not Started",
      notes: "",
      createdAt: "2026-05-12T08:00:00.000Z",
      updatedAt: "2026-05-12T09:00:00.000Z",
    },
  ];

  const appliedStudyBlocks: string[] = [];
  const appliedPreferences: Preferences[] = [];
  const deletes: Array<{ entityType: string; entityId: string; deletedAt: string }> = [];
  let storedCursor: number | null = null;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 46,
        entries: [
          {
            entityType: "study_block",
            entityId: "study-legacy",
            operation: "upsert",
            payload: JSON.stringify({
              id: "study-legacy",
              date: "2026-05-14",
              day: "Thursday",
              durationHours: 2,
              durationMinutes: 0,
              completed: true,
              order: 1,
              startTime: "10:00",
              endTime: "12:00",
              isOvernight: false,
              category: "Test",
              task: "Legacy cloud block",
              status: "Completed",
              notes: "",
              createdAt: "2026-05-14T08:00:00.000Z",
              updatedAt: "2026-05-14T09:00:00.000Z",
            }),
            clientUpdatedAt: "2026-05-14T09:00:00.000Z",
          },
          {
            entityType: "study_block",
            entityId: "study-malformed",
            operation: "upsert",
            payload: "{not-json",
            clientUpdatedAt: "2026-05-14T09:05:00.000Z",
          },
          {
            entityType: "preferences",
            entityId: "prefs-user",
            operation: "upsert",
            payload: JSON.stringify({
              themeId: "light",
              dailyGoalMinutes: 300,
            }),
            clientUpdatedAt: "2026-05-14T09:10:00.000Z",
          },
          {
            entityType: "study_block",
            entityId: "study-delete",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-14T09:15:00.000Z",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => 14,
    setCursor: async (value) => {
      storedCursor = value;
    },
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    getDeleteTombstones: async () => [],
    applyStudyBlock: async (block) => {
      appliedStudyBlocks.push(block.task);
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async () => {
      throw new Error("weak topic apply should not run");
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async (entityType, entityId, deletedAt) => {
      deletes.push({ entityType, entityId, deletedAt });
    },
    applyPreferences: async (preferences) => {
      appliedPreferences.push(preferences);
    },
  });

  assert.deepEqual(appliedStudyBlocks, ["Legacy cloud block"]);
  assert.equal(appliedPreferences.length, 1);
  assert.equal(appliedPreferences[0].themeId, "light");
  assert.equal(appliedPreferences[0].dailyGoalMinutes, 300);
  assert.deepEqual(deletes, [
    {
      entityType: "study_block",
      entityId: "study-delete",
      deletedAt: "2026-05-14T09:15:00.000Z",
    },
  ]);
  assert.equal(storedCursor, 46);
  assert.deepEqual(result, {
    received: 4,
    applied: 3,
    upserted: 2,
    deleted: 1,
    skipped: 1,
    cursor: 46,
  });
});

test("pullFromCloud applies newer deletes for error log entries", async () => {
  const state = createEmptyState();
  state.errorLogEntries = [
    {
      id: "error-delete",
      source: "AMBOSS",
      examBlock: "Block 4",
      system: "OB/GYN",
      topic: "Delete me",
      errorType: "Trap Answer",
      missedPattern: "local",
      fix: "local fix",
      whyPickedWrongAnswer: "",
      whyCorrectAnswerIsCorrect: "",
      whyTemptingWrongAnswerIsWrong: "",
      decisionRule: "",
      isRepeatMiss: false,
      followUpAction: "",
      isGuessedCorrect: false,
      addToFinalSheet: false,
      priority: "low",
      entryDate: "2026-05-13",
      createdAt: "2026-05-13T08:00:00.000Z",
      updatedAt: "2026-05-13T09:00:00.000Z",
    },
  ];

  const deletes: Array<{ entityType: string; entityId: string; deletedAt: string }> = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 45,
        entries: [
          {
            entityType: "error_log_entry",
            entityId: "error-delete",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-14T09:00:00.000Z",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => 10,
    setCursor: async () => {},
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    getDeleteTombstones: async () => [],
    applyStudyBlock: async () => {
      throw new Error("study block apply should not run");
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async () => {
      throw new Error("weak topic apply should not run");
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async (entityType, entityId, deletedAt) => {
      deletes.push({ entityType, entityId, deletedAt });
    },
  });

  assert.deepEqual(deletes, [
    {
      entityType: "error_log_entry",
      entityId: "error-delete",
      deletedAt: "2026-05-14T09:00:00.000Z",
    },
  ]);
  assert.deepEqual(result, {
    received: 1,
    applied: 1,
    upserted: 0,
    deleted: 1,
    skipped: 0,
    cursor: 45,
  });
});

test("pullFromCloud skips stale upserts when a newer local tombstone exists", async () => {
  const state = createEmptyState();
  const tombstones: CloudDeleteTombstone[] = [
    {
      entityType: "weak_topic_entry",
      entityId: "weak-1",
      deletedAt: "2026-05-15T12:00:00.000Z",
    },
  ];

  let applied = false;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 52,
        entries: [
          {
            entityType: "weak_topic_entry",
            entityId: "weak-1",
            operation: "upsert",
            clientUpdatedAt: "2026-05-14T12:00:00.000Z",
            payload: {
              id: "weak-1",
              topic: "Cardio",
              entryType: "manual",
              priority: "High",
              status: "Active",
              notes: "",
              lastSeenAt: "2026-05-14",
              sourceLabel: "Manual",
              createdAt: "2026-05-14T11:00:00.000Z",
              updatedAt: "2026-05-14T12:00:00.000Z",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )) as typeof fetch;

  const result = await pullFromCloud("token-123", "device-123", {
    getCursor: async () => 12,
    setCursor: async () => {},
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    getDeleteTombstones: async () => tombstones,
    applyStudyBlock: async () => {
      throw new Error("study block apply should not run");
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async () => {
      applied = true;
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async () => {
      throw new Error("delete apply should not run");
    },
  });

  assert.equal(applied, false);
  assert.deepEqual(result, {
    received: 1,
    applied: 0,
    upserted: 0,
    deleted: 0,
    skipped: 1,
    cursor: 52,
  });
});

// ─── session_log pull (desktop cloud-pull parity with web) ───────────────────

function buildPullDependencies(overrides: {
  state?: AppState;
  tfState?: TfAppState;
  applySessionLog?: (session: TfSessionLog) => Promise<void>;
  applySessionLogDelete?: (id: string, deletedAt: string) => Promise<void>;
  applyPreferences?: (preferences: Preferences) => Promise<void>;
}) {
  const state = overrides.state ?? createEmptyState();
  const tfState = overrides.tfState ?? createEmptyTfState();
  return {
    getCursor: async () => null,
    setCursor: async () => {},
    loadSnapshot: async () => ({
      state,
      persistence: {
        storagePath: "",
        backupDirectory: "",
        schemaVersion: 1,
        appVersion: "test",
        lastSavedAt: null,
        recoveryMessage: null,
        legacyMigrationCompletedAt: null,
      },
      backups: [],
      trash: [],
    }),
    loadTfState: async () => tfState,
    getDeleteTombstones: async () => [] as CloudDeleteTombstone[],
    applyStudyBlock: async () => {
      throw new Error("study block apply should not run");
    },
    applyPracticeTest: async () => {
      throw new Error("practice test apply should not run");
    },
    applyWeakTopic: async () => {
      throw new Error("weak topic apply should not run");
    },
    applyErrorLog: async () => {
      throw new Error("error log apply should not run");
    },
    applyDelete: async () => {
      throw new Error("delete apply should not run");
    },
    applySessionLog:
      overrides.applySessionLog ??
      (async () => {
        throw new Error("session log apply should not run");
      }),
    applySessionLogDelete:
      overrides.applySessionLogDelete ??
      (async () => {
        throw new Error("session log delete apply should not run");
      }),
    applyPreferences:
      overrides.applyPreferences ??
      (async () => {
        throw new Error("preferences apply should not run");
      }),
  };
}

test("pullFromCloud applies a session_log upsert from a canonical web payload", async () => {
  const appliedSessions: TfSessionLog[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 41,
        entries: [
          {
            entityType: "session_log",
            entityId: "web-session-1",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T18:00:00.000Z",
            payload: {
              schemaVersion: 1,
              id: "web-session-1",
              date: "2026-05-20",
              title: "Pathoma Cardio",
              category: "pathoma-cardio",
              source: "Manual",
              durationMinutes: 45,
              startAt: "2026-05-20T17:00:00.000Z",
              endAt: "2026-05-20T17:45:00.000Z",
              notes: "Wrap up valve lectures.",
              isDistraction: false,
              updatedAt: "2026-05-20T18:00:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      applySessionLog: async (session) => {
        appliedSessions.push(session);
      },
    }),
  );

  assert.equal(appliedSessions.length, 1);
  assert.equal(appliedSessions[0].id, "web-session-1");
  assert.equal(appliedSessions[0].method, "Pathoma Cardio");
  assert.equal(appliedSessions[0].methodKey, "pathoma-cardio");
  assert.equal(appliedSessions[0].hours, 0.75);
  assert.equal(appliedSessions[0].startISO, "2026-05-20T17:00:00.000Z");
  assert.equal(appliedSessions[0].endISO, "2026-05-20T17:45:00.000Z");
  assert.equal(appliedSessions[0].notes, "Wrap up valve lectures.");
  assert.equal(appliedSessions[0].isDistraction, false);
  assert.equal(appliedSessions[0].isLive, false);
  assert.equal(appliedSessions[0].updatedAt, "2026-05-20T18:00:00.000Z");
  assert.deepEqual(result, {
    received: 1,
    applied: 1,
    upserted: 1,
    deleted: 0,
    skipped: 0,
    cursor: 41,
  });
});

test("pullFromCloud applies a session_log delete and skips stale upserts", async () => {
  const appliedDeletes: Array<{ id: string; deletedAt: string }> = [];
  const appliedSessions: TfSessionLog[] = [];
  const tfState = createEmptyTfState();
  tfState.sessionLogs = [
    buildSessionLog({ id: "web-session-old", updatedAt: "2026-05-19T10:00:00.000Z" }),
  ];

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 77,
        entries: [
          {
            entityType: "session_log",
            entityId: "web-session-old",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-20T08:00:00.000Z",
          },
          {
            entityType: "session_log",
            entityId: "web-session-old",
            operation: "upsert",
            clientUpdatedAt: "2026-05-19T09:00:00.000Z",
            payload: {
              schemaVersion: 1,
              id: "web-session-old",
              date: "2026-05-19",
              title: "Stale upsert",
              category: "stale-upsert",
              source: "Manual",
              durationMinutes: 30,
              startAt: "2026-05-19T08:00:00.000Z",
              endAt: "2026-05-19T08:30:00.000Z",
              notes: "",
              isDistraction: false,
              updatedAt: "2026-05-19T09:00:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      tfState,
      applySessionLog: async (session) => {
        appliedSessions.push(session);
      },
      applySessionLogDelete: async (id, deletedAt) => {
        appliedDeletes.push({ id, deletedAt });
      },
    }),
  );

  assert.deepEqual(appliedDeletes, [
    { id: "web-session-old", deletedAt: "2026-05-20T08:00:00.000Z" },
  ]);
  assert.equal(appliedSessions.length, 0);
  assert.deepEqual(result, {
    received: 2,
    applied: 1,
    upserted: 0,
    deleted: 1,
    skipped: 1,
    cursor: 77,
  });
});

test("pullFromCloud session_log upsert re-derives date from local startAt (date bucketing parity)", async () => {
  // Wednesday May 20 2026 at 20:00 in America/New_York is
  // Thursday May 21 2026 at 00:00 UTC. Desktop must bucket to Wednesday locally.
  const previousTz = process.env.TZ;
  process.env.TZ = "America/New_York";

  const appliedSessions: TfSessionLog[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 9,
        entries: [
          {
            entityType: "session_log",
            entityId: "wed-evening",
            operation: "upsert",
            clientUpdatedAt: "2026-05-21T00:30:00.000Z",
            // Payload date claims Thursday (UTC bucket); local bucket must be Wednesday.
            payload: {
              schemaVersion: 1,
              id: "wed-evening",
              date: "2026-05-21",
              title: "Evening review",
              category: "evening-review",
              source: "Manual",
              durationMinutes: 30,
              startAt: "2026-05-21T00:00:00.000Z",
              endAt: "2026-05-21T00:30:00.000Z",
              notes: "",
              isDistraction: false,
              updatedAt: "2026-05-21T00:30:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    await pullFromCloud(
      "token-x",
      "device-x",
      buildPullDependencies({
        applySessionLog: async (session) => {
          appliedSessions.push(session);
        },
      }),
    );

    assert.equal(appliedSessions.length, 1);
    // The desktop's local bucket is Wednesday 8 PM, not the UTC date of Thursday.
    assert.equal(appliedSessions[0].date, "2026-05-20");
  } finally {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  }
});

// ─── preferences pull (desktop cloud-pull parity with web) ───────────────────

test("buildCloudPreferencesPayload maps shared desktop fields and omits desktop-only state", () => {
  const preferences = createEmptyState().preferences;
  preferences.dailyGoalMinutes = 300;
  preferences.themeId = "light";
  preferences.enhancedThemeIds = ["light", "maggiepink"];
  preferences.plannerFocusDate = "2026-06-01";
  preferences.customCategories = ["Anki", "  Pathoma  ", ""];
  preferences.resourceLinks = [
    { id: "uw", label: "UWorld", url: "uworld://", kind: "app" },
    { id: "anki", label: "Anki Hub", url: "https://anki.example.com", kind: "website" },
    { id: "", label: "bad", url: "https://bad.example.com", kind: "website" },
  ];
  preferences.examTimers = [
    {
      id: "step2",
      label: "Step 2 CK",
      examDate: "2026-06-15",
      examTime: "08:00",
      displayMode: "weeks+days",
      showHrMin: true,
      color: "#abc",
    },
    {
      id: "bad",
      label: "",
      examDate: "2026-06-20",
    },
  ];
  preferences.activeSection = "settings";
  preferences.plannerMode = "month";
  preferences.notesHtml = "<p>Local only</p>";
  preferences.notebookFolders = [
    {
      id: "folder-1",
      name: "Desk",
      order: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];
  preferences.notebookDocuments = [
    {
      id: "doc-1",
      title: "Notebook",
      order: 0,
      pages: [],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  const payload = buildCloudPreferencesPayload(preferences, FIXED_PUSH_TIME);

  assert.deepEqual(payload, {
    dailyGoalMinutes: 300,
    themeId: "light",
    enhancedThemeIds: ["light", "maggiepink"],
    plannerFocusDate: "2026-06-01",
    examTimers: [
      {
        id: "step2",
        label: "Step 2 CK",
        examDate: "2026-06-15",
        examTime: "08:00",
      },
    ],
    customCategories: [
      { id: "custom-category-anki", label: "Anki" },
      { id: "custom-category-pathoma", label: "Pathoma" },
    ],
    resourceLinks: [
      { id: "uw", label: "UWorld", url: "uworld://", type: "App" },
      {
        id: "anki",
        label: "Anki Hub",
        url: "https://anki.example.com",
        type: "Website",
      },
    ],
    updatedAt: FIXED_PUSH_TIME,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "activeSection"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "lastActiveDate"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "plannerFilters"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "plannerSort"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "plannerMode"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "notesHtml"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "notebookFolders"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "notebookPages"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "notebookDocuments"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "scoreTrendOptions"), false);
});

test("mergeCloudPreferencesIntoDesktop applies safe fields and preserves desktop-only state", () => {
  const baseline = createEmptyState().preferences;
  const merged = mergeCloudPreferencesIntoDesktop(baseline, {
    dailyGoalMinutes: 420,
    themeId: "paulblue",
    enhancedThemeIds: ["paulblue", "dark"],
    plannerFocusDate: "2026-05-25",
    examTimers: [{ id: "step2", label: "Step 2 CK", examDate: "2026-06-15" }],
    customCategories: [
      { id: "cat-1", label: "Anki" },
      "Lectures",
      { id: "cat-blank", label: "   " },
    ],
    resourceLinks: [
      { id: "uw", label: "UWorld", type: "App", url: "uworld://" },
      { id: "web", label: "Anking Wiki", type: "Website", url: "https://example.com" },
      { id: "other", label: "Misc", type: "Other", url: "https://other.example.com" },
    ],
    // Web-only / per-device / unsafe fields the desktop must ignore:
    remindersEnabled: true,
    activeSection: "today",
    updatedAt: "2026-05-25T12:00:00.000Z",
  });

  assert.equal(merged.dailyGoalMinutes, 420);
  assert.equal(merged.themeId, "paulblue");
  assert.deepEqual(merged.enhancedThemeIds, ["paulblue", "dark"]);
  assert.equal(merged.plannerFocusDate, "2026-05-25");
  assert.deepEqual(merged.examTimers, [
    {
      id: "step2",
      label: "Step 2 CK",
      examDate: "2026-06-15",
      examTime: undefined,
      displayMode: undefined,
      showHrMin: undefined,
      color: undefined,
    },
  ]);
  assert.deepEqual(merged.customCategories, ["Anki", "Lectures"]);
  assert.deepEqual(merged.resourceLinks, [
    { id: "uw", label: "UWorld", url: "uworld://", kind: "app" },
    { id: "web", label: "Anking Wiki", url: "https://example.com", kind: "website" },
    { id: "other", label: "Misc", url: "https://other.example.com", kind: "website" },
  ]);

  // Desktop-only fields are carried through unchanged from the baseline.
  assert.equal(merged.activeSection, baseline.activeSection);
  assert.deepEqual(merged.plannerFilters, baseline.plannerFilters);
  assert.deepEqual(merged.plannerSort, baseline.plannerSort);
  assert.equal(merged.plannerMode, baseline.plannerMode);
  assert.equal(merged.notesHtml, baseline.notesHtml);
  assert.deepEqual(merged.notebookFolders, baseline.notebookFolders);
  assert.deepEqual(merged.notebookDocuments, baseline.notebookDocuments);
  assert.deepEqual(merged.scoreTrendOptions, baseline.scoreTrendOptions);
  assert.equal(merged.updatedAt, "2026-05-25T12:00:00.000Z");
});

test("mergeCloudPreferencesIntoDesktop leaves desktop defaults intact when cloud omits fields", () => {
  const baseline = createEmptyState().preferences;
  baseline.dailyGoalMinutes = 360;
  baseline.themeId = "maggiepink";
  baseline.enhancedThemeIds = ["maggiepink"];
  baseline.customCategories = ["Anki", "Lectures"];
  baseline.resourceLinks = [
    { id: "old", label: "Old", url: "https://old.example.com", kind: "website" },
  ];
  baseline.examTimers = [
    {
      id: "step2",
      label: "Step 2",
      examDate: "2026-06-15",
      displayMode: "weeks+days",
      showHrMin: true,
      color: "#ff0",
    },
  ];

  // Cloud payload is intentionally empty — nothing should change.
  const merged = mergeCloudPreferencesIntoDesktop(baseline, {});

  assert.equal(merged.dailyGoalMinutes, 360);
  assert.equal(merged.themeId, "maggiepink");
  assert.deepEqual(merged.enhancedThemeIds, ["maggiepink"]);
  assert.deepEqual(merged.customCategories, ["Anki", "Lectures"]);
  assert.deepEqual(merged.resourceLinks, baseline.resourceLinks);
  assert.deepEqual(merged.examTimers, baseline.examTimers);
});

test("mergeCloudPreferencesIntoDesktop preserves desktop-only exam timer fields on matching id", () => {
  const baseline = createEmptyState().preferences;
  baseline.examTimers = [
    {
      id: "step2",
      label: "Step 2 (old label)",
      examDate: "2026-06-15",
      displayMode: "weeks+days",
      showHrMin: true,
      color: "#abc",
    },
  ];

  const merged = mergeCloudPreferencesIntoDesktop(baseline, {
    examTimers: [
      // Web sends only the basic fields. Desktop's displayMode/showHrMin/color
      // must survive the merge for the same id.
      { id: "step2", label: "Step 2 CK", examDate: "2026-06-20" },
    ],
  });

  assert.deepEqual(merged.examTimers, [
    {
      id: "step2",
      label: "Step 2 CK",
      examDate: "2026-06-20",
      examTime: undefined,
      displayMode: "weeks+days",
      showHrMin: true,
      color: "#abc",
    },
  ]);
});

test("mergeCloudPreferencesIntoDesktop drops invalid/web-only fields safely", () => {
  const baseline = createEmptyState().preferences;
  const before: Preferences = { ...baseline };

  const merged = mergeCloudPreferencesIntoDesktop(baseline, {
    dailyGoalMinutes: -50, // invalid → ignored
    themeId: "neon-orange", // unsupported → ignored
    enhancedThemeIds: "not-an-array", // wrong shape → ignored
    plannerFocusDate: "   ", // blank → ignored
    examTimers: [{ id: "", label: "no id", examDate: "2026-06-15" }], // empty id → dropped
    resourceLinks: [{ id: "bad", url: "x" }], // missing label → dropped
    customCategories: [{ no: "label" }, 42, true], // none have label/string → empty array
    remindersEnabled: true,
    activeSection: "today",
  });

  assert.equal(merged.dailyGoalMinutes, before.dailyGoalMinutes);
  assert.equal(merged.themeId, before.themeId);
  assert.deepEqual(merged.enhancedThemeIds, before.enhancedThemeIds);
  assert.equal(merged.plannerFocusDate, before.plannerFocusDate);
  assert.deepEqual(merged.examTimers, []);
  assert.deepEqual(merged.resourceLinks, []);
  assert.deepEqual(merged.customCategories, []);
  assert.equal(merged.activeSection, before.activeSection);
});

test("pullFromCloud applies a preferences upsert and routes it through saveNativePreferences", async () => {
  const appliedPreferences: Preferences[] = [];
  const state = createEmptyState();
  state.preferences.updatedAt = "2026-05-21T10:00:00.000Z";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 33,
        entries: [
          {
            entityType: "preferences",
            entityId: "user-pref",
            operation: "upsert",
            clientUpdatedAt: "2026-05-22T10:00:00.000Z",
            payload: {
              dailyGoalMinutes: 300,
              themeId: "paulblue",
              enhancedThemeIds: ["paulblue"],
              remindersEnabled: true, // ignored on desktop
              customCategories: [{ id: "cat-1", label: "Pathoma" }],
              resourceLinks: [
                { id: "uw", label: "UWorld", type: "App", url: "uworld://" },
              ],
              examTimers: [],
              plannerFocusDate: "2026-05-25",
              updatedAt: "2026-05-22T10:00:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      state,
      applyPreferences: async (preferences) => {
        appliedPreferences.push(preferences);
      },
    }),
  );

  assert.equal(appliedPreferences.length, 1);
  const next = appliedPreferences[0];
  assert.equal(next.dailyGoalMinutes, 300);
  assert.equal(next.themeId, "paulblue");
  assert.deepEqual(next.enhancedThemeIds, ["paulblue"]);
  assert.deepEqual(next.customCategories, ["Pathoma"]);
  assert.equal(next.resourceLinks.length, 1);
  assert.equal(next.resourceLinks[0].kind, "app");
  assert.equal(next.plannerFocusDate, "2026-05-25");
  assert.equal(next.updatedAt, "2026-05-22T10:00:00.000Z");
  assert.deepEqual(result, {
    received: 1,
    applied: 1,
    upserted: 1,
    deleted: 0,
    skipped: 0,
    cursor: 33,
  });
});

test("pullFromCloud skips a stale preferences upsert when local preferences updatedAt is newer or equal", async () => {
  let applyCalled = false;
  const state = createEmptyState();
  state.preferences.updatedAt = "2026-05-22T10:00:00.000Z";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 34,
        entries: [
          {
            entityType: "preferences",
            entityId: "user-pref",
            operation: "upsert",
            clientUpdatedAt: "2026-05-22T10:00:00.000Z",
            payload: {
              dailyGoalMinutes: 300,
              themeId: "light",
              updatedAt: "2026-05-22T10:00:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      state,
      applyPreferences: async () => {
        applyCalled = true;
      },
    }),
  );

  assert.equal(applyCalled, false);
  assert.deepEqual(result, {
    received: 1,
    applied: 0,
    upserted: 0,
    deleted: 0,
    skipped: 1,
    cursor: 34,
  });
});

test("pullFromCloud ignores a preferences delete tombstone (no-op, counted as skipped)", async () => {
  let applyCalled = false;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 33,
        entries: [
          {
            entityType: "preferences",
            entityId: "user-pref",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-22T10:00:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      applyPreferences: async () => {
        applyCalled = true;
      },
    }),
  );

  assert.equal(applyCalled, false);
  assert.deepEqual(result, {
    received: 1,
    applied: 0,
    upserted: 0,
    deleted: 0,
    skipped: 1,
    cursor: 33,
  });
});

test("pullFromCloud applies notebook folder/document/page upserts and persists merged preferences", async () => {
  const state = createEmptyState();
  state.preferences.notebookFolders = [
    {
      id: "folder-existing",
      name: "Old name",
      order: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];
  state.preferences.notebookPages = [
    {
      id: "page-pdf",
      title: "Local PDF",
      contentHtml: "",
      order: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      kind: "pdf",
      pdfFilename: "local.pdf",
    },
  ];

  const appliedPreferences: Preferences[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 101,
        entries: [
          {
            entityType: "notebook_folder",
            entityId: "folder-existing",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T08:00:00.000Z",
            payload: {
              id: "folder-existing",
              name: "Renamed",
              order: 2,
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-20T08:00:00.000Z",
            },
          },
          {
            entityType: "notebook_folder",
            entityId: "folder-new",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T08:05:00.000Z",
            payload: {
              id: "folder-new",
              name: "From cloud",
              order: 5,
              createdAt: "2026-05-20T08:05:00.000Z",
              updatedAt: "2026-05-20T08:05:00.000Z",
            },
          },
          {
            entityType: "notebook_page",
            entityId: "page-new",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T08:10:00.000Z",
            payload: {
              id: "page-new",
              title: "Cloud note",
              contentHtml: "<p>hi</p>",
              folderId: "folder-new",
              order: 1,
              createdAt: "2026-05-20T08:10:00.000Z",
              updatedAt: "2026-05-20T08:10:00.000Z",
            },
          },
          {
            entityType: "notebook_page",
            entityId: "page-pdf",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T08:11:00.000Z",
            payload: {
              id: "page-pdf",
              title: "Should not overwrite",
              contentHtml: "<p>nope</p>",
              order: 0,
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-20T08:11:00.000Z",
            },
          },
          {
            entityType: "notebook_document",
            entityId: "doc-new",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T08:15:00.000Z",
            payload: {
              id: "doc-new",
              title: "Renal notes",
              folderId: "folder-new",
              order: 0,
              createdAt: "2026-05-20T08:15:00.000Z",
              updatedAt: "2026-05-20T08:15:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      state,
      applyPreferences: async (preferences) => {
        appliedPreferences.push(preferences);
      },
    }),
  );

  assert.deepEqual(result, {
    received: 5,
    applied: 4,
    upserted: 4,
    deleted: 0,
    skipped: 1,
    cursor: 101,
  });
  const last = appliedPreferences[appliedPreferences.length - 1];
  assert.ok(last, "expected at least one applyPreferences call");
  assert.equal(last.notebookFolders.length, 2);
  const renamed = last.notebookFolders.find((f: { id: string }) => f.id === "folder-existing");
  assert.equal(renamed?.name, "Renamed");
  assert.equal(renamed?.order, 2);
  // PDF page must be preserved untouched.
  assert.equal(last.notebookPages.length, 2);
  const pdfPage = last.notebookPages.find((p: { id: string }) => p.id === "page-pdf");
  assert.equal(pdfPage?.title, "Local PDF");
  assert.equal(pdfPage?.kind, "pdf");
  assert.equal(pdfPage?.pdfFilename, "local.pdf");
  const newPage = last.notebookPages.find((p: { id: string }) => p.id === "page-new");
  assert.equal(newPage?.title, "Cloud note");
  assert.equal(newPage?.folderId, "folder-new");
  assert.equal(last.notebookDocuments.length, 1);
  assert.equal(last.notebookDocuments[0].id, "doc-new");
});

test("pullFromCloud refuses notebook deletes that would drop PDF-bearing local data", async () => {
  const state = createEmptyState();
  state.preferences.notebookPages = [
    {
      id: "page-pdf",
      title: "Local PDF",
      contentHtml: "",
      order: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      kind: "pdf",
      pdfFilename: "local.pdf",
    },
    {
      id: "page-text",
      title: "Local text",
      contentHtml: "<p>x</p>",
      order: 1,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];
  state.preferences.notebookDocuments = [
    {
      id: "doc-with-pdf",
      title: "Mixed doc",
      order: 0,
      pages: [
        {
          id: "embedded-pdf",
          title: "Embedded PDF",
          contentHtml: "",
          order: 0,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
          kind: "pdf",
          pdfFilename: "embedded.pdf",
        },
      ],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
  ];

  const appliedPreferences: Preferences[] = [];
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 102,
        entries: [
          {
            entityType: "notebook_page",
            entityId: "page-pdf",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-20T08:00:00.000Z",
          },
          {
            entityType: "notebook_page",
            entityId: "page-text",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-20T08:01:00.000Z",
          },
          {
            entityType: "notebook_document",
            entityId: "doc-with-pdf",
            operation: "delete",
            payload: null,
            clientUpdatedAt: "2026-05-20T08:02:00.000Z",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      state,
      applyPreferences: async (preferences) => {
        appliedPreferences.push(preferences);
      },
    }),
  );

  assert.deepEqual(result, {
    received: 3,
    applied: 1,
    upserted: 0,
    deleted: 1,
    skipped: 2,
    cursor: 102,
  });
  const last = appliedPreferences[appliedPreferences.length - 1];
  assert.ok(last, "expected applyPreferences to be called for the text delete");
  // PDF page remains; text page is gone.
  assert.equal(last.notebookPages.length, 1);
  assert.equal(last.notebookPages[0].id, "page-pdf");
  // Document with embedded PDF survives the cloud delete.
  assert.equal(last.notebookDocuments.length, 1);
  assert.equal(last.notebookDocuments[0].id, "doc-with-pdf");
});

test("pullFromCloud skips notebook upserts when the local record is newer (LWW)", async () => {
  const state = createEmptyState();
  state.preferences.notebookFolders = [
    {
      id: "folder-local-newer",
      name: "Local wins",
      order: 0,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    },
  ];

  let applyCalled = false;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        cursor: 103,
        entries: [
          {
            entityType: "notebook_folder",
            entityId: "folder-local-newer",
            operation: "upsert",
            clientUpdatedAt: "2026-05-20T11:00:00.000Z",
            payload: {
              id: "folder-local-newer",
              name: "Cloud loses",
              order: 9,
              createdAt: "2026-05-01T00:00:00.000Z",
              updatedAt: "2026-05-20T11:00:00.000Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await pullFromCloud(
    "token-x",
    "device-x",
    buildPullDependencies({
      state,
      applyPreferences: async () => {
        applyCalled = true;
      },
    }),
  );

  assert.equal(applyCalled, false);
  assert.deepEqual(result, {
    received: 1,
    applied: 0,
    upserted: 0,
    deleted: 0,
    skipped: 1,
    cursor: 103,
  });
});

test("pushAllEntities emits notebook folder/document/page upserts and skips PDF-bearing rows", async () => {
  const state = createEmptyState();
  state.preferences.updatedAt = "2026-05-09T00:00:00.000Z";
  state.preferences.notebookFolders = [
    {
      id: "folder-new",
      name: "Cardio",
      order: 1,
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
    },
    {
      id: "folder-old",
      name: "Stale",
      order: 0,
      createdAt: "2026-05-01T10:00:00.000Z",
      updatedAt: "2026-05-05T10:00:00.000Z",
    },
  ];
  state.preferences.notebookPages = [
    {
      id: "page-text-new",
      title: "Note",
      contentHtml: "<p>hi</p>",
      folderId: "folder-new",
      order: 0,
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
    },
    {
      id: "page-pdf-skip",
      title: "PDF",
      contentHtml: "",
      order: 1,
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
      kind: "pdf",
      pdfFilename: "x.pdf",
    },
  ];
  state.preferences.notebookDocuments = [
    {
      id: "doc-text-new",
      title: "Renal",
      folderId: "folder-new",
      order: 0,
      pages: [],
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
    },
    {
      id: "doc-with-pdf-skip",
      title: "Has PDF",
      order: 1,
      pages: [
        {
          id: "embedded-pdf",
          title: "Embedded",
          contentHtml: "",
          order: 0,
          createdAt: "2026-05-12T10:00:00.000Z",
          updatedAt: "2026-05-12T10:00:00.000Z",
          kind: "pdf",
          pdfFilename: "y.pdf",
        },
      ],
      createdAt: "2026-05-12T10:00:00.000Z",
      updatedAt: "2026-05-12T10:00:00.000Z",
    },
  ];

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 200 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  await pushAllEntities(
    "token-123",
    "device-123",
    state,
    "2026-05-10T00:00:00.000Z",
    [],
    {
      loadTfState: async () => createEmptyTfState(),
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    entities: Array<Record<string, unknown>>;
  };
  const notebookEntities = body.entities.filter((e) =>
    String(e.entityType).startsWith("notebook_"),
  );
  assert.deepEqual(notebookEntities, [
    {
      entityType: "notebook_folder",
      entityId: "folder-new",
      operation: "upsert",
      payload: {
        id: "folder-new",
        name: "Cardio",
        order: 1,
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T10:00:00.000Z",
    },
    {
      entityType: "notebook_page",
      entityId: "page-text-new",
      operation: "upsert",
      payload: {
        id: "page-text-new",
        title: "Note",
        contentHtml: "<p>hi</p>",
        folderId: "folder-new",
        order: 0,
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T10:00:00.000Z",
    },
    {
      entityType: "notebook_document",
      entityId: "doc-text-new",
      operation: "upsert",
      payload: {
        id: "doc-text-new",
        title: "Renal",
        folderId: "folder-new",
        order: 0,
        createdAt: "2026-05-12T10:00:00.000Z",
        updatedAt: "2026-05-12T10:00:00.000Z",
      },
      clientUpdatedAt: "2026-05-12T10:00:00.000Z",
    },
  ]);
});

// Regression: when syncAutoTrackerSessionLogs is first enabled, old auto-tracker
// logs whose updatedAt predates lastSyncedAt were silently excluded by the
// incremental filter. The fix resets lastSyncedAt to epoch before the next sync,
// so after = "1970-01-01T00:00:00.000Z" and every eligible session log passes.
test("pushAllEntities includes opted-in auto-tracker logs whose updatedAt predates the watermark when watermark is reset to epoch", async () => {
  const state = createEmptyState();
  state.preferences.syncAutoTrackerSessionLogs = true;

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 99 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const tfState = createEmptyTfState();
  // Session ended May 5 — well before a hypothetical lastSyncedAt of May 10.
  tfState.sessionLogs = [
    buildSessionLog({
      id: "auto-old-predates-watermark",
      method: "Question Bank [Auto]",
      notes: "",
      updatedAt: "2026-05-05T12:00:00.000Z",
      startISO: "2026-05-05T10:00:00.000Z",
      endISO: "2026-05-05T12:00:00.000Z",
      hours: 2,
    }),
    buildSessionLog({
      id: "manual-old-predates-watermark",
      method: "Manual Review",
      notes: "",
      updatedAt: "2026-05-05T09:00:00.000Z",
      startISO: "2026-05-05T08:00:00.000Z",
      endISO: "2026-05-05T09:00:00.000Z",
      hours: 1,
    }),
  ];

  // Simulate the epoch watermark that handleAutoTrackerSyncToggle writes when
  // the user enables opt-in. With a normal watermark ("2026-05-10") both logs
  // would be excluded; with epoch they both pass.
  const result = await pushAllEntities(
    "token-123",
    "device-123",
    state,
    "1970-01-01T00:00:00.000Z",
    [],
    {
      loadTfState: async () => tfState,
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  // preferences + 2 session_log upserts
  assert.deepEqual(result, { pushed: 3, cursor: 99 });

  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    entities: Array<Record<string, unknown>>;
  };
  const sessionLogIds = body.entities
    .filter((e) => e.entityType === "session_log")
    .map((e) => e.entityId);
  assert.deepEqual(sessionLogIds.sort(), [
    "auto-old-predates-watermark",
    "manual-old-predates-watermark",
  ]);
});

test("pushAllEntities excludes opted-in auto-tracker logs when watermark is recent (normal incremental sync)", async () => {
  const state = createEmptyState();
  state.preferences.syncAutoTrackerSessionLogs = true;

  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({ cursor: 100 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const tfState = createEmptyTfState();
  tfState.sessionLogs = [
    buildSessionLog({
      id: "auto-old-before-watermark",
      method: "Question Bank [Auto]",
      notes: "",
      updatedAt: "2026-05-05T12:00:00.000Z",
      startISO: "2026-05-05T10:00:00.000Z",
      endISO: "2026-05-05T12:00:00.000Z",
      hours: 2,
    }),
  ];

  // Normal incremental watermark: session is old, should be skipped (already pushed).
  const result = await pushAllEntities(
    "token-123",
    "device-123",
    state,
    "2026-05-10T00:00:00.000Z",
    [],
    {
      loadTfState: async () => tfState,
      getNow: () => FIXED_PUSH_TIME,
    },
  );

  // Only preferences pushed — the old auto log is excluded by the incremental filter.
  assert.deepEqual(result, { pushed: 1, cursor: 100 });
  const body = JSON.parse(String(fetchCalls[0]?.init?.body)) as {
    entities: Array<Record<string, unknown>>;
  };
  const sessionLogEntities = body.entities.filter((e) => e.entityType === "session_log");
  assert.equal(sessionLogEntities.length, 0);
});
