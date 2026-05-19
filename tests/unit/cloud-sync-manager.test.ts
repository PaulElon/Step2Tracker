import assert from "node:assert/strict";
import test from "node:test";

import { pullFromCloud, pushAllEntities } from "../../src/lib/cloud-sync-manager.ts";
import type { CloudDeleteTombstone } from "../../src/lib/native-persistence.ts";
import type { AppState } from "../../src/types/models.ts";

const previousFetch = globalThis.fetch;

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
    },
  };
}

test("pushAllEntities sends recent upserts and delete tombstones and preserves the worker cursor", async () => {
  const state = createEmptyState();
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
  );

  assert.deepEqual(result, { pushed: 7, cursor: 77 });
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

test("pushAllEntities skips the network request when no entity changed after the watermark", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not run");
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
  );

  assert.deepEqual(result, { pushed: 0, cursor: null });
  assert.equal(fetchCalled, false);
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
