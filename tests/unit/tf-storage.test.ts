import assert from "node:assert/strict";
import test from "node:test";

import {
  createTfPersistenceApi,
  createQueuedTfStateSaver,
  deleteTfSessionLog,
  getEmptyTfAppState,
  loadTfState,
  normalizeTfAppState,
  saveTfState,
  TF_STORAGE_KEY,
  TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION,
  upsertTfSessionLog,
} from "../../src/lib/tf-storage.ts";
import { addDeletedNativeId, getDeletedNativeIds } from "../../src/lib/tf-deleted-native-ids.ts";
import { reconcileNativeSpansToSessions } from "../../src/lib/tf-native-span-reconciler.ts";
import type { TfAppState, TfSessionLog } from "../../src/types/models.ts";

class MemoryStorage {
  #store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#store.set(key, value);
  }

  removeItem(key: string): void {
    this.#store.delete(key);
  }

  clear(): void {
    this.#store.clear();
  }
}

const previousWindow = globalThis.window;
const previousLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

function installBrowserStorage() {
  const localStorage = new MemoryStorage();
  const nextWindow = {
    localStorage,
  } as Window;
  globalThis.window = nextWindow;
  (globalThis as { localStorage?: MemoryStorage }).localStorage = localStorage;
  return localStorage;
}

function restoreWindow() {
  if (previousWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    globalThis.window = previousWindow;
  }

  if (previousLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    (globalThis as { localStorage?: Storage }).localStorage = previousLocalStorage;
  }
}

function buildSession(id: string, method: string): TfSessionLog {
  return {
    id,
    date: "2026-05-06",
    method,
    methodKey: method.toLowerCase().replace(/\s+/gu, "-"),
    hours: 1,
    startISO: "2026-05-06T12:00:00.000Z",
    endISO: "2026-05-06T13:00:00.000Z",
    notes: "",
    isDistraction: false,
    isLive: false,
    updatedAt: "2026-05-06T13:00:00.000Z",
  };
}

test.afterEach(() => {
  restoreWindow();
});

test("upserted session logs stamp updatedAt, clear matching tombstones, and survive save/load edits", async () => {
  installBrowserStorage();

  const created = upsertTfSessionLog(getEmptyTfAppState(), {
    ...buildSession("manual-1", "Manual Review"),
    updatedAt: undefined,
  });
  const createdSession = created.sessionLogs[0];

  assert.ok(createdSession?.updatedAt);
  assert.equal(created.sessionLogTombstones.length, 0);

  await saveTfState(created);
  const loadedCreated = await loadTfState();
  assert.equal(loadedCreated.sessionLogs[0]?.updatedAt, createdSession?.updatedAt);

  const deleted = deleteTfSessionLog(loadedCreated, "manual-1");
  assert.equal(deleted.sessionLogs.length, 0);
  assert.equal(deleted.sessionLogTombstones[0]?.id, "manual-1");
  assert.ok(deleted.sessionLogTombstones[0]?.deletedAt);
  assert.equal(
    deleted.sessionLogTombstones[0]?.schemaVersion,
    TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION,
  );
  assert.equal(deleted.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(deleted.sessionLogTombstones[0]?.syncSource, "manual");

  const edited = upsertTfSessionLog(deleted, {
    ...buildSession("manual-1", "Manual Review"),
    notes: "edited",
  });

  assert.equal(edited.sessionLogs[0]?.notes, "edited");
  assert.ok(edited.sessionLogs[0]?.updatedAt);
  assert.notEqual(edited.sessionLogs[0]?.updatedAt, createdSession?.updatedAt);
  assert.deepEqual(edited.sessionLogTombstones, []);

  await saveTfState(edited);
  const loadedEdited = await loadTfState();
  assert.equal(loadedEdited.sessionLogs[0]?.updatedAt, edited.sessionLogs[0]?.updatedAt);
  assert.deepEqual(loadedEdited.sessionLogTombstones, []);
});

test("legacy session rows without updatedAt normalize to a stable fallback", async () => {
  const localStorage = installBrowserStorage();
  localStorage.setItem(
    TF_STORAGE_KEY,
    JSON.stringify({
      ...getEmptyTfAppState(),
      sessionLogs: [
        {
          id: "legacy-1",
          date: "2026-05-06",
          method: "Manual Review",
          methodKey: "manual-review",
          hours: 1,
          startISO: "2026-05-06T12:00:00.000Z",
          endISO: "2026-05-06T13:00:00.000Z",
          notes: "",
          isDistraction: false,
          isLive: false,
        },
      ],
    }),
  );

  const loaded = await loadTfState();
  assert.equal(loaded.sessionLogs[0]?.updatedAt, "2026-05-06T13:00:00.000Z");
});

test("delete session log survives a save/load round trip and preserves unrelated rows", async () => {
  installBrowserStorage();

  const initial: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogs: [
      buildSession("auto-1", "UWorld [Auto]"),
      buildSession("manual-1", "Manual Review"),
    ],
  };

  await saveTfState(initial);
  const deleted = deleteTfSessionLog(initial, "auto-1");
  await saveTfState(deleted);
  const loaded = await loadTfState();

  assert.deepEqual(
    loaded.sessionLogs.map((session) => session.id),
    ["manual-1"],
  );
  assert.equal(loaded.sessionLogs[0]?.method, "Manual Review");
  assert.equal(loaded.sessionLogTombstones[0]?.id, "auto-1");
  assert.ok(loaded.sessionLogTombstones[0]?.deletedAt);
  assert.equal(
    loaded.sessionLogTombstones[0]?.schemaVersion,
    TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION,
  );
  assert.equal(loaded.sessionLogTombstones[0]?.syncEligible, false);
  assert.equal(loaded.sessionLogTombstones[0]?.syncSource, undefined);
});

test("delete session log stamps sync eligibility from the live row before removal", () => {
  const safeDeleted = deleteTfSessionLog(
    {
      ...getEmptyTfAppState(),
      sessionLogs: [buildSession("manual-1", "Manual Review")],
    },
    "manual-1",
  );

  assert.equal(safeDeleted.sessionLogTombstones[0]?.schemaVersion, TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION);
  assert.equal(safeDeleted.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(safeDeleted.sessionLogTombstones[0]?.syncSource, "manual");

  const unsafeCases: Array<{ name: string; session: TfSessionLog }> = [
    {
      name: "native",
      session: buildSession("nat-device-1-span-1", "UWorld"),
    },
    {
      name: "auto-method",
      session: buildSession("auto-1", "UWorld [Auto]"),
    },
    {
      name: "live",
      session: {
        ...buildSession("live-1", "Manual Review"),
        isLive: true,
      },
    },
    {
      name: "unsafe-notes",
      session: {
        ...buildSession("manual-unsafe", "Manual Review"),
        notes: "browserUrl=https://apps.uworld.com browserTitle=UWorld",
      },
    },
  ];

  for (const testCase of unsafeCases) {
    const deleted = deleteTfSessionLog(
      {
        ...getEmptyTfAppState(),
        sessionLogs: [testCase.session],
      },
      testCase.session.id,
    );

    assert.equal(
      deleted.sessionLogTombstones[0]?.schemaVersion,
      TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION,
      `${testCase.name} tombstone should keep the metadata schema`,
    );
    assert.equal(
      deleted.sessionLogTombstones[0]?.syncEligible,
      false,
      `${testCase.name} tombstone should be sync-ineligible`,
    );
    assert.equal(
      deleted.sessionLogTombstones[0]?.syncSource,
      undefined,
      `${testCase.name} tombstone should not claim a safe source`,
    );
  }
});

test("legacy tombstones without eligibility metadata stay sync-ineligible after normalization", () => {
  const normalized = normalizeTfAppState({
    ...getEmptyTfAppState(),
    sessionLogTombstones: [
      {
        id: "legacy-1",
        deletedAt: "2026-05-06T13:00:00.000Z",
      },
    ],
  });

  assert.equal(normalized.sessionLogTombstones[0]?.schemaVersion, undefined);
  assert.notEqual(normalized.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(normalized.sessionLogTombstones[0]?.syncSource, undefined);
});

test("native load wins over stale local fallback and refreshes it", async () => {
  const localStorage = installBrowserStorage();
  const staleLocalState: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogs: [
      buildSession("auto-1", "UWorld [Auto]"),
      buildSession("manual-1", "Manual Review"),
    ],
  };
  localStorage.setItem("timefolio-tracker:state", JSON.stringify(staleLocalState));

  const nativeState: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogs: [buildSession("manual-1", "Manual Review")],
  };

  const api = createTfPersistenceApi({
    isNativeRuntime: () => true,
    localStorage,
    loadNativeState: async () => nativeState,
    saveNativeState: async (state) => state,
    resetNativeState: async () => getEmptyTfAppState(),
  });

  const loaded = await api.load();

  assert.deepEqual(loaded.sessionLogs.map((session) => session.id), ["manual-1"]);
  const refreshedLocal = JSON.parse(localStorage.getItem("timefolio-tracker:state") ?? "null") as TfAppState;
  assert.deepEqual(refreshedLocal.sessionLogs.map((session) => session.id), ["manual-1"]);
});

test("native save failures surface instead of silently falling back", async () => {
  const localStorage = installBrowserStorage();
  const staleLocalState: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogs: [buildSession("auto-1", "UWorld [Auto]")],
  };
  localStorage.setItem("timefolio-tracker:state", JSON.stringify(staleLocalState));

  const api = createTfPersistenceApi({
    isNativeRuntime: () => true,
    localStorage,
    loadNativeState: async () => staleLocalState,
    saveNativeState: async () => {
      throw new Error("native save failed");
    },
    resetNativeState: async () => getEmptyTfAppState(),
  });

  await assert.rejects(
    api.save({
      ...getEmptyTfAppState(),
      sessionLogs: [buildSession("manual-1", "Manual Review")],
    }),
    /native save failed/,
  );
  assert.deepEqual(
    JSON.parse(localStorage.getItem("timefolio-tracker:state") ?? "null").sessionLogs.map(
      (session: TfSessionLog) => session.id,
    ),
    ["auto-1"],
  );
});

test("queued saves mark older snapshots stale so a newer delete can win", async () => {
  const savedSnapshots: string[][] = [];
  let releaseFirstSave = () => {};
  const firstSaveGate = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  let saveCount = 0;
  const saver = createQueuedTfStateSaver(async (state) => {
    saveCount += 1;
    if (saveCount === 1) {
      await firstSaveGate;
    }
    savedSnapshots.push(state.sessionLogs.map((session) => session.id));
    return state;
  });

  const initial: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogs: [
      buildSession("auto-1", "UWorld [Auto]"),
      buildSession("manual-1", "Manual Review"),
    ],
  };

  const firstSave = saver.enqueue(initial);
  const secondSave = saver.enqueue(deleteTfSessionLog(initial, "auto-1"));
  releaseFirstSave();

  const firstResult = await firstSave;
  const secondResult = await secondSave;

  assert.equal(firstResult.isLatest, false);
  assert.equal(secondResult.isLatest, true);
  assert.deepEqual(savedSnapshots, [
    ["auto-1", "manual-1"],
    ["manual-1"],
  ]);
});

test("native deletion suppression still prevents nat-* rows from being re-imported", () => {
  installBrowserStorage();

  const nativeId = "nat-device-1-span-1";
  const deletedState = deleteTfSessionLog(
    {
      ...getEmptyTfAppState(),
      sessionLogs: [buildSession(nativeId, "UWorld [Auto]")],
    },
    nativeId,
  );
  addDeletedNativeId(nativeId);

  const reconciled = reconcileNativeSpansToSessions(
    [
      {
        device_id: "device-1",
        span_id: "span-1",
        start_ts: 1_714_992_000_000,
        end_ts: 1_714_995_600_000,
        name: "Google Chrome",
        title: "UWorld Step 2",
        kind: "tracked",
      },
    ],
    deletedState.sessionLogs,
    getDeletedNativeIds(),
  );

  assert.equal(deletedState.sessionLogTombstones[0]?.id, nativeId);
  assert.equal(deletedState.sessionLogTombstones[0]?.syncEligible, false);
  assert.equal(reconciled.newEntries.length, 0);
  assert.equal(reconciled.skipped, 1);
});

test("native persistence api keeps tombstone eligibility metadata on save and load", async () => {
  const localStorage = installBrowserStorage();
  const nativeState: TfAppState = {
    ...getEmptyTfAppState(),
    sessionLogTombstones: [
      {
        id: "manual-1",
        deletedAt: "2026-05-06T13:00:00.000Z",
        schemaVersion: TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION,
        syncEligible: true,
        syncSource: "manual",
      },
      {
        id: "legacy-1",
        deletedAt: "2026-05-06T12:00:00.000Z",
      },
    ],
  };

  const api = createTfPersistenceApi({
    isNativeRuntime: () => true,
    localStorage,
    loadNativeState: async () => nativeState,
    saveNativeState: async (state) => state,
    resetNativeState: async () => getEmptyTfAppState(),
  });

  const loaded = await api.load();
  assert.equal(loaded.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(loaded.sessionLogTombstones[0]?.syncSource, "manual");
  assert.notEqual(loaded.sessionLogTombstones[1]?.syncEligible, true);

  const saved = await api.save(nativeState);
  assert.equal(saved.sessionLogTombstones[0]?.schemaVersion, TF_SESSION_LOG_TOMBSTONE_SCHEMA_VERSION);
  assert.equal(saved.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(saved.sessionLogTombstones[0]?.syncSource, "manual");

  const persisted = JSON.parse(localStorage.getItem(TF_STORAGE_KEY) ?? "null") as TfAppState;
  assert.equal(persisted.sessionLogTombstones[0]?.syncEligible, true);
  assert.equal(persisted.sessionLogTombstones[0]?.syncSource, "manual");
  assert.equal(persisted.sessionLogTombstones[1]?.syncEligible, undefined);
});
