import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoTrackerV2PreviewSpans } from "../../src/lib/tf-autotracker-v2-preview-spans.js";
import type { AutoTrackerV2NativeEvent } from "../../src/lib/tf-autotracker-v2-native-events.js";

function makeEvent(
  overrides: Partial<AutoTrackerV2NativeEvent> &
    Pick<AutoTrackerV2NativeEvent, "kind" | "timestampMs">,
): AutoTrackerV2NativeEvent {
  return {
    id: overrides.id ?? `ev-${overrides.timestampMs}`,
    platform: "macos",
    ...overrides,
  };
}

test("Anki event produces one open app span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.kind, "app");
  assert.equal(span.label, "Anki");
  assert.equal(span.appName, "Anki");
  assert.equal(span.bundleId, "net.ankiweb.dtop");
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
  assert.deepEqual(span.sourceEventIds, ["ev-1"]);
});

test("Chrome UWorld URL event produces one open website span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "UWorld USMLE Step 2 CK",
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.equal(span.kind, "website");
  assert.equal(span.label, "www.uworld.com");
  assert.equal(span.browserUrl, "https://www.uworld.com/qbank/test");
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
  assert.deepEqual(span.sourceEventIds, ["ev-1"]);
});

test("Chrome UWorld then AMBOSS closes first span and opens second", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      appName: "Google Chrome",
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 5000,
      appName: "Google Chrome",
      browserUrl: "https://www.amboss.com/us/learn",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 2);

  const uworld = spans[0];
  assert.equal(uworld.kind, "website");
  assert.equal(uworld.label, "www.uworld.com");
  assert.equal(uworld.endedAtMs, 5000);
  assert.equal(uworld.durationMs, 4000);

  const amboss = spans[1];
  assert.equal(amboss.kind, "website");
  assert.equal(amboss.label, "www.amboss.com");
  assert.equal(amboss.startedAtMs, 5000);
  assert.equal(amboss.endedAtMs, null);
  assert.equal(amboss.durationMs, null);
});

test("Repeated same URL samples merge into one span and accumulate source event IDs", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 2000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
    makeEvent({
      id: "ev-3",
      kind: "untrackedFocused",
      timestampMs: 3000,
      browserUrl: "https://www.uworld.com/qbank/test",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.deepEqual(span.sourceEventIds, ["ev-1", "ev-2", "ev-3"]);
  assert.equal(span.startedAtMs, 1000);
  assert.equal(span.endedAtMs, null);
  assert.equal(span.durationMs, null);
});

test("App then website then app creates three spans with correct boundaries", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 0,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 5000,
      appName: "Google Chrome",
      browserUrl: "https://uworld.com/qbank",
    }),
    makeEvent({
      id: "ev-3",
      kind: "targetFocused",
      timestampMs: 10000,
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 3);

  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].label, "Anki");
  assert.equal(spans[0].startedAtMs, 0);
  assert.equal(spans[0].endedAtMs, 5000);
  assert.equal(spans[0].durationMs, 5000);

  assert.equal(spans[1].kind, "website");
  assert.equal(spans[1].startedAtMs, 5000);
  assert.equal(spans[1].endedAtMs, 10000);
  assert.equal(spans[1].durationMs, 5000);

  assert.equal(spans[2].kind, "app");
  assert.equal(spans[2].label, "Anki");
  assert.equal(spans[2].startedAtMs, 10000);
  assert.equal(spans[2].endedAtMs, null);
  assert.equal(spans[2].durationMs, null);
});

test("Error and idle events are ignored", () => {
  const events = [
    makeEvent({ id: "ev-1", kind: "error", timestampMs: 0, error: "some error" }),
    makeEvent({ id: "ev-2", kind: "idleChanged", timestampMs: 1000, isIdle: true }),
    makeEvent({ id: "ev-3", kind: "targetFocused", timestampMs: 2000, appName: "Anki" }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].appName, "Anki");
  assert.equal(spans[0].startedAtMs, 2000);
});

test("Unsorted input is sorted by timestampMs before mapping", () => {
  const events = [
    makeEvent({
      id: "ev-3",
      kind: "untrackedFocused",
      timestampMs: 3000,
      browserUrl: "https://amboss.com/learn",
    }),
    makeEvent({ id: "ev-1", kind: "targetFocused", timestampMs: 1000, appName: "Anki" }),
    makeEvent({
      id: "ev-2",
      kind: "untrackedFocused",
      timestampMs: 2000,
      browserUrl: "https://uworld.com/qbank",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 3);

  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].startedAtMs, 1000);
  assert.equal(spans[0].endedAtMs, 2000);

  assert.equal(spans[1].kind, "website");
  assert.equal(spans[1].startedAtMs, 2000);
  assert.equal(spans[1].endedAtMs, 3000);

  assert.equal(spans[2].kind, "website");
  assert.equal(spans[2].startedAtMs, 3000);
  assert.equal(spans[2].endedAtMs, null);
});

test("Malformed URL does not crash and creates a website span", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "untrackedFocused",
      timestampMs: 1000,
      browserUrl: "not-a-valid-url",
      browserTitle: "Some Page",
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, "website");
  assert.ok(spans[0].label.length > 0);
  assert.equal(spans[0].startedAtMs, 1000);
  assert.equal(spans[0].endedAtMs, null);
});

test("Missing appName and bundleId falls back to Unknown app label", () => {
  const events = [
    makeEvent({
      id: "ev-1",
      kind: "targetFocused",
      timestampMs: 1000,
    }),
  ];
  const spans = buildAutoTrackerV2PreviewSpans(events);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].kind, "app");
  assert.equal(spans[0].label, "Unknown app");
});
