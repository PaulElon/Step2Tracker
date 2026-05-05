import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2ReducerPreview,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2ContinuousWritePreviewSessions,
  type TfAutotrackerV2FinalizedPreviewSession,
} from "../../src/lib/tf-autotracker-v2-reducer-preview.js";
import type { TfAutotrackerV2PreviewSpan } from "../../src/lib/tf-autotracker-v2-preview-spans.js";

function makeSpan(
  overrides: Partial<TfAutotrackerV2PreviewSpan> &
    Pick<TfAutotrackerV2PreviewSpan, "classification" | "classificationReason" | "id" | "kind" | "label" | "startedAtMs">,
): TfAutotrackerV2PreviewSpan {
  return {
    id: overrides.id,
    label: overrides.label,
    kind: overrides.kind,
    appName: overrides.appName,
    bundleId: overrides.bundleId,
    browserTitle: overrides.browserTitle,
    browserUrl: overrides.browserUrl,
    startedAtMs: overrides.startedAtMs,
    endedAtMs: overrides.endedAtMs ?? null,
    durationMs: overrides.durationMs ?? null,
    sourceEventIds: overrides.sourceEventIds ?? [overrides.id],
    classification: overrides.classification,
    classificationReason: overrides.classificationReason,
  };
}

function trackedUWorldSpan(overrides: Partial<TfAutotrackerV2PreviewSpan> = {}): TfAutotrackerV2PreviewSpan {
  return makeSpan({
    id: "span-uworld",
    label: "www.uworld.com",
    kind: "website",
    browserTitle: "UWorld",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    startedAtMs: 1_000,
    classification: "tracked",
    classificationReason: "matched website rule \"uworld.com\" by host uworld.com",
    ...overrides,
  });
}

function distractionRedditSpan(
  overrides: Partial<TfAutotrackerV2PreviewSpan> = {},
): TfAutotrackerV2PreviewSpan {
  return makeSpan({
    id: "span-reddit",
    label: "www.reddit.com",
    kind: "website",
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    startedAtMs: 20_000,
    endedAtMs: 50_000,
    durationMs: 30_000,
    classification: "distraction",
    classificationReason: "matched distraction website rule \"reddit.com\" by host reddit.com",
    ...overrides,
  });
}

function unclassifiedAppSpan(
  overrides: Partial<TfAutotrackerV2PreviewSpan> = {},
): TfAutotrackerV2PreviewSpan {
  return makeSpan({
    id: "span-app",
    label: "Calculator",
    kind: "app",
    appName: "Calculator",
    startedAtMs: 5_000,
    endedAtMs: 70_000,
    durationMs: 65_000,
    classification: "unclassified",
    classificationReason: "no matching rule",
    ...overrides,
  });
}

test("tracked UWorld open span produces a focused open reducer state", () => {
  const preview = buildAutoTrackerV2ReducerPreview([trackedUWorldSpan({ endedAtMs: null, durationMs: null })]);

  assert.equal(preview.state.status, "focused");
  assert.equal(preview.state.target.kind, "website");
  assert.equal(preview.state.target.stableId, "apps.uworld.com/courseapp");
  assert.equal(preview.state.target.label, "UWorld");
  assert.equal(preview.finalizedCount, 0);
  assert.deepEqual(preview.reducerEvents.map((event) => event.kind), ["targetFocused"]);
});

test("tracked UWorld then distraction Reddit under 60 seconds then tracked UWorld does not finalize early", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 35_000, durationMs: 15_000 }),
    trackedUWorldSpan({ startedAtMs: 50_000, endedAtMs: null, durationMs: null }),
  ]);

  assert.equal(preview.state.status, "focused");
  assert.equal(preview.state.target.stableId, "apps.uworld.com/courseapp");
  assert.equal(preview.finalizedCount, 1);
  assert.equal(preview.finalizedPreviewSessions.length, 1);
  assert.equal(preview.finalizedPreviewSessions[0]?.isDistraction, true);
  assert.deepEqual(preview.reducerEvents.map((event) => event.kind), [
    "targetFocused",
    "untrackedFocused",
    "targetFocused",
  ]);
});

test("tracked UWorld then distraction Reddit for at least 60 seconds finalizes the prior session", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ]);

  assert.equal(preview.state.status, "idle");
  assert.equal(preview.finalizedCount, 2);
  assert.deepEqual(preview.reducerEvents.map((event) => event.kind), [
    "targetFocused",
    "untrackedFocused",
    "tick",
  ]);
  assert.equal(preview.finalizedPreviewSessions.length, 2);
  assert.deepEqual(preview.finalizedPreviewSessions[0], {
    previewSessionId: "website:apps.uworld.com/courseapp:0",
    startedAtMs: 0,
    endedAtMs: 20_000,
    durationMs: 20_000,
    targetLabel: "UWorld",
    sourceTargetStableId: "apps.uworld.com/courseapp",
    sourceSpanIds: ["span-uworld", "span-reddit"],
    sourceEventIds: ["span-uworld", "span-reddit"],
    appName: undefined,
    bundleId: undefined,
    browserTitle: "UWorld",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    classificationReason: "matched website rule \"uworld.com\" by host uworld.com",
    classification: "tracked",
    finalizedBy: "awayGraceElapsed",
    isDistraction: false,
  });
  assert.equal(preview.finalizedPreviewSessions[1]?.isDistraction, true);
});

test("distraction-only finalized spans create finalized distraction preview sessions", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    distractionRedditSpan({ startedAtMs: 1_000, endedAtMs: 2_000, durationMs: 1_000 }),
    distractionRedditSpan({
      id: "span-reddit-2",
      startedAtMs: 3_000,
      endedAtMs: 4_000,
      durationMs: 1_000,
    }),
  ]);

  assert.equal(preview.state.status, "idle");
  assert.equal(preview.finalizedCount, 2);
  assert.equal(preview.finalizedPreviewSessions.length, 2);
  assert.equal(preview.reducerEvents.length, 0);
  assert.equal(preview.ignoredSpans.length, 0);
  assert.deepEqual(preview.finalizedPreviewSessions.map((session) => session.isDistraction), [
    true,
    true,
  ]);
});

test("unclassified-only spans do not create a tracked reducer session", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    unclassifiedAppSpan({ startedAtMs: 1_000, endedAtMs: 2_000, durationMs: 1_000 }),
    unclassifiedAppSpan({
      id: "span-app-2",
      startedAtMs: 3_000,
      endedAtMs: 4_000,
      durationMs: 1_000,
    }),
  ]);

  assert.equal(preview.state.status, "idle");
  assert.equal(preview.finalizedCount, 0);
  assert.equal(preview.finalizedPreviewSessions.length, 0);
  assert.equal(preview.reducerEvents.length, 0);
  assert.equal(preview.ignoredSpans.length, 2);
});

test("tracked Anki then unclassified app for at least 60 seconds finalizes according to reducer output", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    makeSpan({
      id: "span-anki",
      label: "Anki",
      kind: "app",
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
      startedAtMs: 0,
      endedAtMs: 5_000,
      durationMs: 5_000,
      classification: "tracked",
      classificationReason: "matched app rule \"/Applications/Anki.app\" by app name Anki",
    }),
    unclassifiedAppSpan({ startedAtMs: 5_000, endedAtMs: 75_000, durationMs: 70_000 }),
  ]);

  assert.equal(preview.state.status, "idle");
  assert.equal(preview.finalizedCount, 1);
  assert.equal(preview.reducerEvents.at(-1)?.kind, "tick");
});

test("open tracked span remains open and focused", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: null, durationMs: null }),
  ]);

  assert.equal(preview.state.status, "focused");
  assert.equal(preview.state.target.label, "UWorld");
  assert.equal(preview.finalizedCount, 0);
  assert.equal(preview.finalizedPreviewSessions.length, 0);
});

test("ignored spans are reported with reasons", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    distractionRedditSpan({ startedAtMs: 1_000, endedAtMs: null, durationMs: null }),
  ]);

  assert.equal(preview.ignoredSpans.length, 1);
  assert.equal(preview.ignoredSpans[0]?.classification, "distraction");
  assert.match(preview.ignoredSpans[0]?.reason ?? "", /tracked reducer session/);
});

test("input order is sorted by startedAtMs before reducer mapping", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ id: "span-late", startedAtMs: 20_000, endedAtMs: null, durationMs: null }),
    distractionRedditSpan({ id: "span-middle", startedAtMs: 10_000, endedAtMs: 15_000, durationMs: 5_000 }),
    trackedUWorldSpan({ id: "span-early", startedAtMs: 0, endedAtMs: 5_000, durationMs: 5_000 }),
  ]);

  assert.deepEqual(preview.reducerEvents.map((event) => event.timestampMs), [0, 10_000, 20_000]);
  assert.deepEqual(preview.reducerEvents.map((event) => event.kind), [
    "targetFocused",
    "untrackedFocused",
    "targetFocused",
  ]);
});

test("maps a finalized UWorld preview session to a concise Session Log payload", () => {
  const previewSession: TfAutotrackerV2FinalizedPreviewSession = {
    previewSessionId: "website:apps.uworld.com/courseapp:1746453600000",
    startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
    endedAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
    durationMs: 30 * 60_000,
    targetLabel: "UWorld",
    sourceTargetStableId: "apps.uworld.com/courseapp",
    sourceSpanIds: ["span-1", "span-2"],
    sourceEventIds: ["event-1", "event-2"],
    browserTitle: "UWorld Step 2",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    classificationReason: "matched website rule \"uworld.com\" by host uworld.com",
    classification: "tracked",
    finalizedBy: "awayGraceElapsed",
    isDistraction: false,
  };

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    previewSession,
    "tf-auto-v2-preview-write-1",
  );

  assert.deepEqual(sessionLog, {
    id: "tf-auto-v2-preview-write-1",
    date: "2025-05-05",
    method: "UWorld [Auto]",
    methodKey: "auto-v2-preview-uworld",
    hours: 0.5,
    startISO: "2025-05-05T14:00:00.000Z",
    endISO: "2025-05-05T14:30:00.000Z",
    notes: "",
    isDistraction: false,
    isLive: false,
  });
});

test("maps a finalized distraction preview session to a distraction Session Log payload", () => {
  const previewSession = {
    previewSessionId: "website:reddit.com/r/medicine:1746453600000",
    startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
    endedAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
    durationMs: 30 * 60_000,
    targetLabel: "Reddit",
    sourceTargetStableId: "reddit.com/r/medicine",
    sourceSpanIds: ["span-reddit", "span-reddit-2"],
    sourceEventIds: ["event-1", "event-2"],
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    classificationReason: "matched distraction website rule \"reddit.com\" by host reddit.com",
    finalizedBy: "awayGraceElapsed",
    classification: "distraction",
    isDistraction: true,
  } as TfAutotrackerV2FinalizedPreviewSession;

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    previewSession,
    "tf-auto-v2-preview-write-1",
  );

  assert.deepEqual(sessionLog, {
    id: "tf-auto-v2-preview-write-1",
    date: "2025-05-05",
    method: "Reddit [Auto]",
    methodKey: "auto-v2-preview-reddit",
    hours: 0.5,
    startISO: "2025-05-05T14:00:00.000Z",
    endISO: "2025-05-05T14:30:00.000Z",
    notes: "",
    isDistraction: true,
    isLive: false,
  });
});

test("maps a finalized Anki preview session to a concise Session Log payload", () => {
  const previewSession: TfAutotrackerV2FinalizedPreviewSession = {
    previewSessionId: "app:/Applications/Anki.app:1746457200000",
    startedAtMs: Date.parse("2025-05-05T15:00:00.000Z"),
    endedAtMs: Date.parse("2025-05-05T15:45:00.000Z"),
    durationMs: 45 * 60_000,
    targetLabel: "Anki",
    sourceTargetStableId: "/Applications/Anki.app",
    sourceSpanIds: ["span-anki", "span-notes"],
    sourceEventIds: ["event-anki", "event-notes"],
    appName: "Anki",
    bundleId: "net.ankiweb.dtop",
    classificationReason: "matched app rule \"/Applications/Anki.app\" by app name Anki",
    classification: "tracked",
    finalizedBy: "manualStop",
    isDistraction: false,
  };

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    previewSession,
    "tf-auto-v2-preview-write-2",
  );

  assert.equal(sessionLog.method, "Anki [Auto]");
  assert.equal(sessionLog.methodKey, "auto-v2-preview-anki");
  assert.equal(sessionLog.notes, "");
  assert.ok(!sessionLog.method.includes("[AUTO V2 PREVIEW]"));
  assert.doesNotMatch(sessionLog.notes, /previewSessionId=|sourceSpanIds=|sourceEventIds=|browserUrl=|browserTitle=|\|/);
});

test("continuous write selects finalized tracked and distraction sessions but leaves open sessions alone", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
    makeSpan({
      id: "span-anki",
      label: "Anki",
      kind: "app",
      appName: "Anki",
      bundleId: "net.ankiweb.dtop",
      startedAtMs: 100_000,
      endedAtMs: null,
      durationMs: null,
      classification: "tracked",
      classificationReason: "matched app rule \"/Applications/Anki.app\" by app name Anki",
    }),
  ]);
  const distractionPreviewSession = {
    previewSessionId: "website:reddit.com/r/medicine:20_000",
    startedAtMs: 20_000,
    endedAtMs: 90_000,
    durationMs: 70_000,
    targetLabel: "Reddit",
    sourceTargetStableId: "reddit.com/r/medicine",
    sourceSpanIds: ["span-reddit"],
    sourceEventIds: ["span-reddit"],
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    classificationReason: "matched distraction website rule \"reddit.com\" by host reddit.com",
    finalizedBy: "awayGraceElapsed",
    classification: "distraction",
    isDistraction: true,
  } as TfAutotrackerV2FinalizedPreviewSession;

  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [preview.finalizedPreviewSessions[0]!, distractionPreviewSession],
    state: preview.state,
    writtenPreviewSessionIds: [],
  });

  assert.equal(preview.state.status, "focused");
  assert.deepEqual(selection.previewSessions.map((session) => session.previewSessionId), [
    "website:apps.uworld.com/courseapp:0",
    distractionPreviewSession.previewSessionId,
  ]);
  assert.deepEqual(selection.names, ["UWorld", "Reddit"]);
});

test("continuous write excludes duplicate preview session ids", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ]);
  const [finalizedPreviewSession] = preview.finalizedPreviewSessions;
  assert.ok(finalizedPreviewSession);

  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [finalizedPreviewSession, finalizedPreviewSession],
    state: preview.state,
    writtenPreviewSessionIds: [],
  });

  assert.deepEqual(selection.previewSessions.map((session) => session.previewSessionId), [
    finalizedPreviewSession.previewSessionId,
  ]);
  assert.equal(selection.skippedDuplicateCount, 1);
});

test("continuous write excludes unclassified preview sessions", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ]);
  const unclassifiedPreviewSession = {
    previewSessionId: "website:example.com:20_000",
    startedAtMs: 20_000,
    endedAtMs: 90_000,
    durationMs: 70_000,
    targetLabel: "Example",
    sourceTargetStableId: "example.com",
    sourceSpanIds: ["span-example"],
    sourceEventIds: ["span-example"],
    browserUrl: "https://example.com",
    classificationReason: "no matching rule",
    finalizedBy: "awayGraceElapsed",
    classification: "unclassified",
    isDistraction: false,
  } as TfAutotrackerV2FinalizedPreviewSession;

  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [preview.finalizedPreviewSessions[0]!, unclassifiedPreviewSession],
    state: preview.state,
    writtenPreviewSessionIds: [],
  });

  assert.deepEqual(selection.previewSessions.map((session) => session.previewSessionId), [
    "website:apps.uworld.com/courseapp:0",
  ]);
});

test("continuous write excludes already written preview session ids", () => {
  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ]);
  const [finalizedPreviewSession] = preview.finalizedPreviewSessions;
  assert.ok(finalizedPreviewSession);

  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [finalizedPreviewSession],
    state: preview.state,
    writtenPreviewSessionIds: [finalizedPreviewSession.previewSessionId],
  });

  assert.deepEqual(selection.previewSessions, []);
  assert.equal(selection.skippedDuplicateCount, 1);
});

test("continuous write emits session names for success status", () => {
  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [
      {
        previewSessionId: "website:apps.uworld.com/courseapp:1746453600000",
        startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
        endedAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
        durationMs: 30 * 60_000,
        targetLabel: "UWorld",
        sourceTargetStableId: "apps.uworld.com/courseapp",
        sourceSpanIds: ["span-1"],
        sourceEventIds: ["event-1"],
        browserTitle: "UWorld Step 2",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
        classificationReason: "matched website rule \"uworld.com\" by host uworld.com",
        classification: "tracked",
        finalizedBy: "awayGraceElapsed",
        isDistraction: false,
      },
      {
        previewSessionId: "app:/Applications/Anki.app:1746457200000",
        startedAtMs: Date.parse("2025-05-05T15:00:00.000Z"),
        endedAtMs: Date.parse("2025-05-05T15:45:00.000Z"),
        durationMs: 45 * 60_000,
        targetLabel: "Anki",
        sourceTargetStableId: "/Applications/Anki.app",
        sourceSpanIds: ["span-anki"],
        sourceEventIds: ["event-anki"],
        appName: "Anki",
        bundleId: "net.ankiweb.dtop",
        classificationReason: "matched app rule \"/Applications/Anki.app\" by app name Anki",
        classification: "tracked",
        finalizedBy: "manualStop",
        isDistraction: false,
      },
    ],
    state: {
      status: "idle",
      lastEventMs: 0,
    },
    writtenPreviewSessionIds: [],
  });

  assert.deepEqual(selection.names, ["UWorld", "Anki"]);
});
