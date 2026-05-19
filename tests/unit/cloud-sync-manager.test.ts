import assert from "node:assert/strict";
import test from "node:test";

import { pushAllEntities } from "../../src/lib/cloud-sync-manager.ts";
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

  assert.deepEqual(result, { pushed: 5, cursor: 77 });
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
