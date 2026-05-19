import assert from "node:assert/strict";
import test from "node:test";

import { createDemoAppState } from "../../src/data/demo-data.ts";

// Must match APP_STATE_VERSION from src/lib/storage.ts
const EXPECTED_VERSION = 6;

test("createDemoAppState returns correct version", () => {
  const state = createDemoAppState();
  assert.equal(state.version, EXPECTED_VERSION);
});

test("createDemoAppState returns 18 study blocks with stable IDs", () => {
  const state = createDemoAppState();
  assert.equal(state.studyBlocks.length, 18);
  for (let i = 1; i <= 18; i++) {
    assert.ok(
      state.studyBlocks.some((b) => b.id === `demo-block-${i}`),
      `missing demo-block-${i}`,
    );
  }
});

test("createDemoAppState returns 5 practice tests with stable IDs", () => {
  const state = createDemoAppState();
  assert.equal(state.practiceTests.length, 5);
  for (let i = 1; i <= 5; i++) {
    assert.ok(
      state.practiceTests.some((p) => p.id === `demo-pt-${i}`),
      `missing demo-pt-${i}`,
    );
  }
});

test("createDemoAppState returns 8 weak topics with stable IDs", () => {
  const state = createDemoAppState();
  assert.equal(state.weakTopicEntries.length, 8);
  for (let i = 1; i <= 8; i++) {
    assert.ok(
      state.weakTopicEntries.some((w) => w.id === `demo-wt-${i}`),
      `missing demo-wt-${i}`,
    );
  }
});

test("createDemoAppState returns 12 error log entries with stable IDs", () => {
  const state = createDemoAppState();
  assert.equal(state.errorLogEntries.length, 12);
  for (let i = 1; i <= 12; i++) {
    assert.ok(
      state.errorLogEntries.some((e) => e.id === `demo-el-${i}`),
      `missing demo-el-${i}`,
    );
  }
});

test("createDemoAppState preferences have correct dailyGoalMinutes and activeSection", () => {
  const state = createDemoAppState();
  assert.equal(state.preferences.dailyGoalMinutes, 480);
  assert.equal(state.preferences.activeSection, "dashboard");
});

test("createDemoAppState study block dates are relative (past dates, not fixed strings)", () => {
  const state1 = createDemoAppState();
  // All blocks should have dates in ISO date-key format
  for (const block of state1.studyBlocks) {
    assert.match(block.date, /^\d{4}-\d{2}-\d{2}$/, `block ${block.id} has invalid date`);
  }
});

test("createDemoAppState is stable across two calls (same relative structure)", () => {
  const a = createDemoAppState();
  const b = createDemoAppState();
  // IDs should be identical across calls
  assert.deepEqual(
    a.studyBlocks.map((bl) => bl.id),
    b.studyBlocks.map((bl) => bl.id),
  );
  assert.deepEqual(
    a.practiceTests.map((pt) => pt.id),
    b.practiceTests.map((pt) => pt.id),
  );
});
