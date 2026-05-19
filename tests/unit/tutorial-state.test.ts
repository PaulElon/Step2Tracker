import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceTutorial,
  completeTutorial,
  loadTutorialState,
  resetTutorialState,
  saveTutorialState,
  skipTutorial,
  startTutorial,
  TUTORIAL_STEPS,
} from "../../src/lib/tutorial-state.ts";

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

const previousLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

function installStorage(): MemoryStorage {
  const store = new MemoryStorage();
  (globalThis as { localStorage?: MemoryStorage }).localStorage = store;
  return store;
}

function restoreStorage(): void {
  if (previousLocalStorage === undefined) {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  } else {
    (globalThis as { localStorage?: Storage }).localStorage = previousLocalStorage;
  }
}

test.afterEach(() => {
  restoreStorage();
});

test("loadTutorialState returns empty default when nothing stored", () => {
  installStorage();
  const state = loadTutorialState();
  assert.equal(state.active, false);
  assert.equal(state.completed, false);
  assert.equal(state.skipped, false);
  assert.equal(state.currentStepId, null);
  assert.deepEqual(state.completedStepIds, []);
});

test("saveTutorialState and loadTutorialState round-trip", () => {
  installStorage();
  const saved = startTutorial();
  const loaded = loadTutorialState();
  assert.deepEqual(loaded, saved);
});

test("resetTutorialState clears persisted state", () => {
  installStorage();
  startTutorial();
  const reset = resetTutorialState();
  assert.equal(reset.active, false);
  assert.equal(reset.currentStepId, null);
  const loaded = loadTutorialState();
  assert.deepEqual(loaded, reset);
});

test("startTutorial sets active=true and currentStepId to first step", () => {
  installStorage();
  const state = startTutorial();
  assert.equal(state.active, true);
  assert.equal(state.currentStepId, TUTORIAL_STEPS[0]?.id);
  assert.equal(state.completed, false);
  assert.equal(state.skipped, false);
  assert.deepEqual(state.completedStepIds, []);
});

test("advanceTutorial moves through all steps and completes", () => {
  installStorage();
  let state = startTutorial();

  for (let i = 0; i < TUTORIAL_STEPS.length - 1; i++) {
    const before = state.currentStepId;
    state = advanceTutorial(state);
    assert.notEqual(state.currentStepId, before);
    assert.equal(state.active, true);
    assert.ok(state.completedStepIds.includes(before!));
  }

  // advance past the last step
  state = advanceTutorial(state);
  assert.equal(state.active, false);
  assert.equal(state.completed, true);
  assert.equal(state.completedStepIds.length, TUTORIAL_STEPS.length);
});

test("advanceTutorial is a no-op when not active", () => {
  installStorage();
  const idle = loadTutorialState();
  const result = advanceTutorial(idle);
  assert.deepEqual(result, idle);
});

test("skipTutorial sets active=false and skipped=true", () => {
  installStorage();
  const started = startTutorial();
  const skipped = skipTutorial(started);
  assert.equal(skipped.active, false);
  assert.equal(skipped.skipped, true);
  const loaded = loadTutorialState();
  assert.equal(loaded.skipped, true);
});

test("completeTutorial sets active=false and completed=true", () => {
  installStorage();
  const started = startTutorial();
  const done = completeTutorial(started);
  assert.equal(done.active, false);
  assert.equal(done.completed, true);
  const loaded = loadTutorialState();
  assert.equal(loaded.completed, true);
});

test("loadTutorialState returns default when localStorage throws", () => {
  // Do not install storage — globalThis.localStorage may be undefined in Node
  restoreStorage(); // ensure no storage
  const state = loadTutorialState();
  assert.equal(state.active, false);
  assert.equal(state.currentStepId, null);
});

test("saveTutorialState is a no-op when localStorage throws", () => {
  restoreStorage();
  // Should not throw
  assert.doesNotThrow(() => {
    saveTutorialState({
      active: false,
      completed: false,
      skipped: false,
      currentStepId: null,
      completedStepIds: [],
    });
  });
});

test("TUTORIAL_STEPS has notebook step marked notebookOnly", () => {
  const notebook = TUTORIAL_STEPS.find((s) => s.id === "notebook");
  assert.ok(notebook, "notebook step must exist");
  assert.equal(notebook.notebookOnly, true);
});
