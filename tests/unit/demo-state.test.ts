import assert from "node:assert/strict";
import test from "node:test";

import { loadDemoMode, saveDemoMode } from "../../src/lib/demo-state.ts";

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

test("loadDemoMode returns false when nothing stored", () => {
  installStorage();
  assert.equal(loadDemoMode(), false);
});

test("saveDemoMode(true) persists and loadDemoMode returns true", () => {
  installStorage();
  saveDemoMode(true);
  assert.equal(loadDemoMode(), true);
});

test("saveDemoMode(false) removes the key and loadDemoMode returns false", () => {
  installStorage();
  saveDemoMode(true);
  saveDemoMode(false);
  assert.equal(loadDemoMode(), false);
});

test("loadDemoMode returns false when localStorage throws", () => {
  restoreStorage();
  assert.equal(loadDemoMode(), false);
});

test("saveDemoMode is a no-op when localStorage throws", () => {
  restoreStorage();
  assert.doesNotThrow(() => {
    saveDemoMode(true);
  });
});
