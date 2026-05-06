import assert from "node:assert/strict";
import test from "node:test";

import {
  createTfPersistenceApi,
  createQueuedTfStateSaver,
  deleteTfSessionLog,
  getEmptyTfAppState,
  loadTfState,
  saveTfState,
} from "../../src/lib/tf-storage.ts";
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

function installBrowserStorage() {
  const localStorage = new MemoryStorage();
  const nextWindow = {
    localStorage,
  } as Window;
  globalThis.window = nextWindow;
  return localStorage;
}

function restoreWindow() {
  if (previousWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
    return;
  }

  globalThis.window = previousWindow;
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
  };
}

test.afterEach(() => {
  restoreWindow();
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
