import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../src/lib/tf-autotracker-v2-preview-spans.js";
import {
  deriveAutoTrackerV2RecoveryHydration,
  mergeAutoTrackerV2DevRecoveryState,
  assessAutoTrackerV2RecoveredPreviewSession,
  buildAutoTrackerV2ReducerPreview,
  finalizeAutoTrackerV2RecoveredPreviewSession,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2RecoveredPreviewSession,
  selectAutoTrackerV2ContinuousWritePreviewSessions,
  selectAutoTrackerV2StopFinalizePreviewSession,
  type TfAutotrackerV2FinalizedPreviewSession,
} from "../../src/lib/tf-autotracker-v2-reducer-preview.js";
import type {
  AutoTrackerV2NativeRecoveryDiagnostics,
  AutoTrackerV2NativeRecoveryState,
  AutoTrackerV2NativeSamplerStatus,
} from "../../src/lib/tf-autotracker-v2-native-events.js";
import type { TfAutoTrackerV2DevPersistedOpenPreviewSession } from "../../src/types/models.js";
import { normalizeTfAutoTrackerV2DevPersistedState } from "../../src/lib/tf-storage.js";

function makeSpan(
  overrides: Partial<TfAutotrackerV2PreviewSpan> &
    Pick<TfAutotrackerV2PreviewSpan, "classification" | "classificationReason" | "id" | "kind" | "label" | "startedAtMs">,
): TfAutotrackerV2PreviewSpan {
  return {
    id: overrides.id,
    label: overrides.label,
    kind: overrides.kind,
    matchedRuleName: overrides.matchedRuleName,
    matchedRuleTarget: overrides.matchedRuleTarget,
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
    matchedRuleName: "UWorld",
    matchedRuleTarget: "https://apps.uworld.com",
    browserTitle: "UWorld",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    startedAtMs: 1_000,
    classification: "tracked",
    classificationReason: 'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
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
    matchedRuleName: "Reddit",
    matchedRuleTarget: "https://www.reddit.com",
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    startedAtMs: 20_000,
    endedAtMs: 50_000,
    durationMs: 30_000,
    classification: "distraction",
    classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
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

function timeFolioUnclassifiedSpan(
  overrides: Partial<TfAutotrackerV2PreviewSpan> = {},
): TfAutotrackerV2PreviewSpan {
  return unclassifiedAppSpan({
    label: "TimeFolio",
    appName: "TimeFolio",
    startedAtMs: 30_000,
    endedAtMs: null,
    durationMs: null,
    ...overrides,
  });
}

function recoveredTrackedUWorldSession(
  overrides: Partial<TfAutoTrackerV2DevPersistedOpenPreviewSession> = {},
): TfAutoTrackerV2DevPersistedOpenPreviewSession {
  return {
    previewSessionId: "website:apps.uworld.com/courseapp:0",
    startedAtMs: 0,
    lastSeenAtMs: 90_000,
    targetLabel: "UWorld",
    matchedRuleName: "UWorld",
    matchedRuleTarget: "https://apps.uworld.com",
    sourceTargetStableId: "apps.uworld.com/courseapp",
    sourceSpanIds: ["span-uworld"],
    sourceEventIds: ["span-uworld"],
    appName: undefined,
    bundleId: undefined,
    browserTitle: "UWorld",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    classificationReason: 'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
    classification: "tracked",
    isDistraction: false,
    ...overrides,
  };
}

function recoveredDistractionRedditSession(
  overrides: Partial<TfAutoTrackerV2DevPersistedOpenPreviewSession> = {},
): TfAutoTrackerV2DevPersistedOpenPreviewSession {
  return {
    previewSessionId: "website:reddit.com/r/medicine:20_000",
    startedAtMs: 20_000,
    lastSeenAtMs: 80_000,
    targetLabel: "Reddit",
    matchedRuleName: "Reddit",
    matchedRuleTarget: "https://www.reddit.com",
    sourceTargetStableId: "reddit.com/r/medicine",
    sourceSpanIds: ["span-reddit"],
    sourceEventIds: ["span-reddit"],
    appName: undefined,
    bundleId: undefined,
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
    classification: "distraction",
    isDistraction: true,
    ...overrides,
  };
}

function makeRecoveryDiagnostics(
  overrides: Partial<AutoTrackerV2NativeRecoveryDiagnostics> = {},
): AutoTrackerV2NativeRecoveryDiagnostics {
  return {
    source: "primary",
    recoveryFilePath:
      "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
    primaryRecoveryFilePath:
      "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
    writeFilePath:
      "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
    readFilePath:
      "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
    selectedReadSource: "primary",
    exists: true,
    sizeBytes: 4096,
    modifiedAtMs: 90_000,
    parsedSchemaVersion: 1,
    eventsCount: 2,
    lastObservedAppName: "Safari",
    lastObservedBundleId: "com.apple.Safari",
    lastObservedBrowserTitle: "UWorld",
    lastObservedBrowserUrl: "https://apps.uworld.com/courseapp/step2",
    readError: null,
    fallbackCandidates: [],
    lastWriteByteCount: null,
    fileExistsAfterWrite: null,
    readbackAfterWriteEventsCount: null,
    ...overrides,
  };
}

function makeLiveSamplerStatus(
  overrides: Partial<AutoTrackerV2NativeSamplerStatus> = {},
): AutoTrackerV2NativeSamplerStatus {
  return {
    running: false,
    intervalMs: 3_000,
    tickCount: 0,
    lastTickStartedAtMs: null,
    lastTickCompletedAtMs: null,
    lastAppendedCount: 0,
    lastError: null,
    lastObservedAppName: null,
    lastObservedBundleId: null,
    bufferCount: 0,
    recoveryFilePath: null,
    recoveryWritePath: null,
    recoveryReadPath: null,
    recoveryWriteCount: 0,
    lastRecoveryWriteAtMs: null,
    lastRecoveryWriteError: null,
    lastRecoveryEventsCount: 0,
    lastRecoveryWriteByteCount: null,
    lastRecoveryReadbackEventsCount: null,
    recoveryFileExistsAfterWrite: null,
    ...overrides,
  };
}

const defaultClassificationSettings: TfAutotrackerV2ClassificationSettings = {
  autoApps: [],
  autoWebsites: [
    {
      id: "rule-uworld",
      name: "UWorld",
      target: "https://apps.uworld.com",
      kind: "website",
    },
  ],
  distractionApps: [],
  distractionWebsites: [
    {
      id: "rule-reddit",
      name: "Reddit",
      target: "https://www.reddit.com",
      kind: "website",
    },
  ],
};

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
    matchedRuleName: "UWorld",
    matchedRuleTarget: "https://apps.uworld.com",
    classificationReason: 'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
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
      matchedRuleName: "Anki",
      matchedRuleTarget: "/Applications/Anki.app",
      startedAtMs: 0,
      endedAtMs: 5_000,
      durationMs: 5_000,
      classification: "tracked",
      classificationReason: 'matched app rule "Anki" (/Applications/Anki.app) by app name Anki',
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
    targetLabel: "Course App",
    sourceTargetStableId: "apps.uworld.com/courseapp",
    sourceSpanIds: ["span-1", "span-2"],
    sourceEventIds: ["event-1", "event-2"],
    matchedRuleName: "UWorld",
    matchedRuleTarget: "https://apps.uworld.com",
    browserTitle: "r/popular - UWorld",
    browserUrl: "https://apps.uworld.com/courseapp/step2",
    classificationReason: 'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
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
    targetLabel: "r/popular",
    sourceTargetStableId: "reddit.com/r/medicine",
    sourceSpanIds: ["span-reddit", "span-reddit-2"],
    sourceEventIds: ["event-1", "event-2"],
    matchedRuleName: "Reddit",
    matchedRuleTarget: "https://www.reddit.com",
    browserTitle: "r/popular - Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
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
    matchedRuleName: "Anki",
    matchedRuleTarget: "/Applications/Anki.app",
    appName: "Anki",
    bundleId: "net.ankiweb.dtop",
    classificationReason: 'matched app rule "Anki" (/Applications/Anki.app) by app name Anki',
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
      matchedRuleName: "Anki",
      matchedRuleTarget: "/Applications/Anki.app",
      startedAtMs: 100_000,
      endedAtMs: null,
      durationMs: null,
      classification: "tracked",
      classificationReason: 'matched app rule "Anki" (/Applications/Anki.app) by app name Anki',
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
    matchedRuleName: "Reddit",
    matchedRuleTarget: "https://www.reddit.com",
    browserTitle: "Reddit",
    browserUrl: "https://www.reddit.com/r/medicine",
    classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
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

test("continuous write does not dedupe different preview session ids that share the same rule name", () => {
  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [
      {
        previewSessionId: "website:reddit.com/r/popular:1",
        startedAtMs: 1_000,
        endedAtMs: 2_000,
        durationMs: 1_000,
        targetLabel: "r/popular",
        matchedRuleName: "Reddit",
        matchedRuleTarget: "https://www.reddit.com",
        sourceTargetStableId: "reddit.com/r/popular",
        sourceSpanIds: ["span-reddit-1"],
        sourceEventIds: ["event-reddit-1"],
        browserTitle: "r/popular",
        browserUrl: "https://www.reddit.com/r/popular",
        classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
        classification: "distraction",
        finalizedBy: "manualStop",
        isDistraction: true,
      },
      {
        previewSessionId: "website:reddit.com/r/medicine:2",
        startedAtMs: 3_000,
        endedAtMs: 4_000,
        durationMs: 1_000,
        targetLabel: "r/medicine",
        matchedRuleName: "Reddit",
        matchedRuleTarget: "https://www.reddit.com",
        sourceTargetStableId: "reddit.com/r/medicine",
        sourceSpanIds: ["span-reddit-2"],
        sourceEventIds: ["event-reddit-2"],
        browserTitle: "r/medicine",
        browserUrl: "https://www.reddit.com/r/medicine",
        classificationReason: 'matched distraction website rule "Reddit" (https://www.reddit.com) by host reddit.com',
        classification: "distraction",
        finalizedBy: "manualStop",
        isDistraction: true,
      },
    ],
    state: {
      status: "idle",
      lastEventMs: 0,
    },
    writtenPreviewSessionIds: [],
  });

  assert.deepEqual(selection.previewSessions.map((session) => session.previewSessionId), [
    "website:reddit.com/r/popular:1",
    "website:reddit.com/r/medicine:2",
  ]);
  assert.equal(selection.skippedDuplicateCount, 0);
  assert.deepEqual(selection.names, ["Reddit", "Reddit"]);
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

test("persisted dev state round trip keeps events and written ids", () => {
  const restored = normalizeTfAutoTrackerV2DevPersistedState(
    JSON.parse(
      JSON.stringify({
        schemaVersion: 1,
        lastPersistedAtMs: 123_456,
        events: [
          {
            id: "event-1",
            kind: "targetFocused",
            timestampMs: 1_000,
            platform: "macos",
            appName: "Anki",
            bundleId: "net.ankiweb.dtop",
          },
        ],
        writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
        samplerStatus: {
          running: false,
          intervalMs: 3_000,
          tickCount: 5,
          lastTickStartedAtMs: 90_000,
          lastTickCompletedAtMs: 93_000,
          lastAppendedCount: 1,
          lastError: null,
          lastObservedAppName: "Anki",
          lastObservedBundleId: "net.ankiweb.dtop",
          bufferCount: 1,
        },
        continuousWriteStatus: {
          writtenCount: 1,
          names: ["UWorld"],
          skippedDuplicateCount: 0,
          error: null,
        },
        lastSamplerRunning: true,
        lastSamplerTickCompletedAtMs: 93_000,
        lastEligibleOpenPreviewSession: recoveredTrackedUWorldSession(),
        recoveryStatus: "recoverable",
        lastRecoveryMessage: "Recovered active UWorld preview session.",
      }),
    ),
  );

  assert.ok(restored);
  assert.equal(restored.schemaVersion, 1);
  assert.equal(restored.lastPersistedAtMs, 123_456);
  assert.equal(restored.events.length, 1);
  assert.equal(restored.events[0]?.id, "event-1");
  assert.deepEqual(restored.writtenPreviewSessionIds, ["website:apps.uworld.com/courseapp:0"]);
  assert.equal(restored.samplerStatus?.lastObservedAppName, "Anki");
  assert.deepEqual(restored.continuousWriteStatus?.names, ["UWorld"]);
  assert.equal(restored.lastSamplerRunning, true);
  assert.equal(restored.lastSamplerTickCompletedAtMs, 93_000);
  assert.equal(restored.lastEligibleOpenPreviewSession?.matchedRuleName, "UWorld");
  assert.equal(restored.recoveryStatus, "recoverable");
  assert.equal(restored.lastRecoveryMessage, "Recovered active UWorld preview session.");
});

test("duplicate guard survives restored written preview session ids", () => {
  const restored = normalizeTfAutoTrackerV2DevPersistedState({
    schemaVersion: 1,
    lastPersistedAtMs: 123_456,
    events: [],
    writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
  });
  assert.ok(restored);

  const preview = buildAutoTrackerV2ReducerPreview([
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ]);

  const selection = selectAutoTrackerV2ContinuousWritePreviewSessions({
    finalizedPreviewSessions: [preview.finalizedPreviewSessions[0]!],
    state: preview.state,
    writtenPreviewSessionIds: restored.writtenPreviewSessionIds,
  });

  assert.deepEqual(selection.previewSessions, []);
  assert.equal(selection.skippedDuplicateCount, 1);
});

test("native recovery merge prefers newer sampler state and preserves local duplicate guards", () => {
  const localState = normalizeTfAutoTrackerV2DevPersistedState({
    schemaVersion: 1,
    lastPersistedAtMs: 100_000,
    events: [
      {
        id: "event-local-1",
        kind: "targetFocused",
        timestampMs: 10_000,
        platform: "macos",
        browserTitle: "UWorld",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
      },
    ],
    writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
    samplerStatus: {
      running: false,
      intervalMs: 3_000,
      tickCount: 3,
      lastTickStartedAtMs: 11_000,
      lastTickCompletedAtMs: 12_000,
      lastAppendedCount: 1,
      lastError: null,
      lastObservedAppName: "Safari",
      lastObservedBundleId: "com.apple.Safari",
      bufferCount: 1,
    },
    continuousWriteStatus: {
      writtenCount: 1,
      names: ["UWorld"],
      skippedDuplicateCount: 0,
      error: null,
    },
    lastSamplerRunning: false,
    lastSamplerTickCompletedAtMs: 12_000,
    lastEligibleOpenPreviewSession: recoveredTrackedUWorldSession({ lastSeenAtMs: 12_000 }),
    recoveryStatus: "recoverable",
    lastRecoveryMessage: "Recovered UWorld locally.",
  });
  assert.ok(localState);

  const nativeRecovery: AutoTrackerV2NativeRecoveryState = {
    schemaVersion: 1,
    lastPersistedAtMs: 200_000,
    lastObservedEventTimestampMs: 40_000,
    lastObservedAppName: "Safari",
    lastObservedBundleId: "com.apple.Safari",
    lastObservedBrowserTitle: "Reddit",
    lastObservedBrowserUrl: "https://www.reddit.com/r/medicine",
    samplerStatus: {
      running: true,
      intervalMs: 3_000,
      tickCount: 9,
      lastTickStartedAtMs: 39_000,
      lastTickCompletedAtMs: 40_000,
      lastAppendedCount: 1,
      lastError: null,
      lastObservedAppName: "Safari",
      lastObservedBundleId: "com.apple.Safari",
      bufferCount: 2,
    },
    events: [
      {
        id: "event-local-1",
        kind: "targetFocused",
        timestampMs: 10_000,
        platform: "macos",
        browserTitle: "UWorld",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
      },
      {
        id: "event-native-2",
        kind: "untrackedFocused",
        timestampMs: 40_000,
        platform: "macos",
        browserTitle: "Reddit",
        browserUrl: "https://www.reddit.com/r/medicine",
      },
    ],
  };

  const merged = mergeAutoTrackerV2DevRecoveryState({
    localPersistedState: localState,
    nativeRecoveryState: nativeRecovery,
  });

  assert.ok(merged);
  assert.equal(merged.lastPersistedAtMs, 200_000);
  assert.deepEqual(merged.writtenPreviewSessionIds, ["website:apps.uworld.com/courseapp:0"]);
  assert.deepEqual(merged.continuousWriteStatus?.names, ["UWorld"]);
  assert.equal(merged.lastSamplerRunning, true);
  assert.equal(merged.lastSamplerTickCompletedAtMs, 40_000);
  assert.equal(merged.samplerStatus?.tickCount, 9);
  assert.deepEqual(
    merged.events.map((event) => event.id),
    ["event-local-1", "event-native-2"],
  );
});

test("startup hydration rebuilds preview from native recovery events", () => {
  const recoveryState: AutoTrackerV2NativeRecoveryState = {
    schemaVersion: 1,
    lastPersistedAtMs: 200_000,
    lastObservedEventTimestampMs: 61_000,
    lastObservedAppName: "Safari",
    lastObservedBundleId: "com.apple.Safari",
    lastObservedBrowserTitle: "UWorld",
    lastObservedBrowserUrl: "https://apps.uworld.com/courseapp/step2",
    samplerStatus: makeLiveSamplerStatus({
      running: true,
      tickCount: 4,
      lastTickStartedAtMs: 58_000,
      lastTickCompletedAtMs: 61_000,
      lastObservedAppName: "Safari",
      lastObservedBundleId: "com.apple.Safari",
      recoveryFilePath:
        "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
      recoveryWritePath:
        "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
      recoveryReadPath:
        "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
      recoveryWriteCount: 4,
      lastRecoveryWriteAtMs: 61_000,
      lastRecoveryEventsCount: 2,
      lastRecoveryWriteByteCount: 4096,
      lastRecoveryReadbackEventsCount: 2,
      recoveryFileExistsAfterWrite: true,
    }),
    events: [
      {
        id: "event-1",
        kind: "targetFocused",
        timestampMs: 0,
        platform: "macos",
        browserTitle: "UWorld",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
      },
      {
        id: "event-2",
        kind: "targetFocused",
        timestampMs: 61_000,
        platform: "macos",
        browserTitle: "UWorld Review",
        browserUrl: "https://apps.uworld.com/courseapp/step2/review",
      },
    ],
  };

  const hydration = deriveAutoTrackerV2RecoveryHydration({
    liveSamplerStatus: makeLiveSamplerStatus(),
    recoveryDiagnostics: makeRecoveryDiagnostics(),
    recoveryState,
  });

  assert.ok(hydration.snapshot);
  const previewSpans = buildAutoTrackerV2PreviewSpans(
    hydration.snapshot.events,
    defaultClassificationSettings,
  );
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const recovered = selectAutoTrackerV2RecoveredPreviewSession({
    previewSpans,
    state: preview.state,
    lastSeenAtMs: hydration.samplerStatus?.lastTickCompletedAtMs ?? 61_000,
  });

  assert.deepEqual(
    hydration.snapshot.events.map((event) => event.id),
    ["event-1", "event-2"],
  );
  assert.equal(previewSpans[0]?.matchedRuleName, "UWorld");
  assert.equal(recovered?.matchedRuleName, "UWorld");
  assert.equal(recovered?.lastSeenAtMs, 61_000);
});

test("startup hydration does not let empty live sampler status wipe native recovery file metadata", () => {
  const hydration = deriveAutoTrackerV2RecoveryHydration({
    liveSamplerStatus: makeLiveSamplerStatus(),
    recoveryDiagnostics: makeRecoveryDiagnostics({
      eventsCount: 2,
      modifiedAtMs: 61_000,
    }),
    recoveryState: {
      schemaVersion: 1,
      lastPersistedAtMs: 200_000,
      lastObservedEventTimestampMs: 61_000,
      lastObservedAppName: "Safari",
      lastObservedBundleId: "com.apple.Safari",
      lastObservedBrowserTitle: "UWorld",
      lastObservedBrowserUrl: "https://apps.uworld.com/courseapp/step2",
      samplerStatus: makeLiveSamplerStatus({
        running: true,
        tickCount: 4,
        lastTickStartedAtMs: 58_000,
        lastTickCompletedAtMs: 61_000,
        recoveryFilePath:
          "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
        recoveryWritePath:
          "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
        recoveryReadPath:
          "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
        recoveryWriteCount: 4,
        lastRecoveryWriteAtMs: 61_000,
        lastRecoveryEventsCount: 2,
        lastRecoveryWriteByteCount: 4096,
        lastRecoveryReadbackEventsCount: 2,
        recoveryFileExistsAfterWrite: true,
      }),
      events: [
        {
          id: "event-1",
          kind: "targetFocused",
          timestampMs: 0,
          platform: "macos",
          browserTitle: "UWorld",
          browserUrl: "https://apps.uworld.com/courseapp/step2",
        },
      ],
    },
  });

  assert.equal(hydration.samplerStatus?.running, false);
  assert.equal(hydration.samplerStatus?.tickCount, 4);
  assert.equal(hydration.samplerStatus?.recoveryWriteCount, 4);
  assert.equal(hydration.samplerStatus?.lastRecoveryEventsCount, 2);
  assert.equal(
    hydration.samplerStatus?.recoveryFilePath,
    "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
  );
  assert.equal(hydration.recoveryDiagnostics?.selectedReadSource, "primary");
});

test("startup hydration keeps diagnostics for an empty native recovery file without creating a recovered session", () => {
  const hydration = deriveAutoTrackerV2RecoveryHydration({
    liveSamplerStatus: makeLiveSamplerStatus(),
    recoveryDiagnostics: makeRecoveryDiagnostics({
      eventsCount: 0,
      sizeBytes: 512,
      modifiedAtMs: 20_000,
    }),
    recoveryState: {
      schemaVersion: 1,
      lastPersistedAtMs: 20_000,
      lastObservedEventTimestampMs: null,
      lastObservedAppName: null,
      lastObservedBundleId: null,
      lastObservedBrowserTitle: null,
      lastObservedBrowserUrl: null,
      samplerStatus: makeLiveSamplerStatus({
        recoveryFilePath:
          "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
      }),
      events: [],
    },
  });

  const emptyPreview = buildAutoTrackerV2ReducerPreview([]);
  const recovered = selectAutoTrackerV2RecoveredPreviewSession({
    previewSpans: [],
    state: emptyPreview.state,
    lastSeenAtMs: hydration.samplerStatus?.lastTickCompletedAtMs ?? 0,
  });

  assert.equal(hydration.snapshot, null);
  assert.equal(hydration.recoveryDiagnostics?.exists, true);
  assert.equal(hydration.recoveryDiagnostics?.parsedSchemaVersion, 1);
  assert.equal(hydration.recoveryDiagnostics?.selectedReadSource, "primary");
  assert.equal(hydration.samplerStatus?.lastRecoveryEventsCount, 0);
  assert.equal(recovered, null);
});

test("recovery assessment returns recoverable when the gap is below 60 seconds", () => {
  const assessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: recoveredTrackedUWorldSession({ lastSeenAtMs: 90_000 }),
    nowMs: 120_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(assessment.status, "recoverable");
  assert.equal(assessment.canFinalize, false);
  assert.equal(assessment.gapMs, 30_000);
});

test("recovery assessment returns finalizable when the gap is at least 60 seconds", () => {
  const assessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: recoveredTrackedUWorldSession({ lastSeenAtMs: 90_000 }),
    nowMs: 150_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(assessment.status, "finalizable");
  assert.equal(assessment.canFinalize, true);
  assert.equal(assessment.gapMs, 60_000);
});

test("recovery assessment ignores an unclassified recovered session", () => {
  const assessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: recoveredTrackedUWorldSession({
      classification: "unclassified",
      isDistraction: false,
    }),
    nowMs: 150_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(assessment.status, "ignored");
  assert.equal(assessment.canFinalize, false);
});

test("recovery assessment treats an already written recovered session as finalized", () => {
  const restored = normalizeTfAutoTrackerV2DevPersistedState({
    schemaVersion: 1,
    lastPersistedAtMs: 123_456,
    events: [],
    writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
    lastEligibleOpenPreviewSession: recoveredTrackedUWorldSession(),
  });
  assert.ok(restored);

  const assessment = assessAutoTrackerV2RecoveredPreviewSession({
    recoveredPreviewSession: restored.lastEligibleOpenPreviewSession,
    nowMs: 180_000,
    writtenPreviewSessionIds: restored.writtenPreviewSessionIds,
  });

  assert.equal(assessment.status, "finalized");
  assert.equal(assessment.canFinalize, false);
});

test("recovery selector extracts the last eligible tracked preview session", () => {
  const previewSpans = [trackedUWorldSpan({ startedAtMs: 0, endedAtMs: null, durationMs: null })];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);

  const recovered = selectAutoTrackerV2RecoveredPreviewSession({
    previewSpans,
    state: preview.state,
    lastSeenAtMs: 95_000,
  });

  assert.deepEqual(recovered, recoveredTrackedUWorldSession({ lastSeenAtMs: 95_000 }));
});

test("recovered tracked session maps to clean UWorld [Auto]", () => {
  const finalized = finalizeAutoTrackerV2RecoveredPreviewSession(
    recoveredTrackedUWorldSession({
      startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
      lastSeenAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
    }),
  );
  assert.ok(finalized);

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    finalized,
    "tf-auto-v2-preview-write-recovered-uworld",
  );

  assert.equal(finalized.endedAtMs, Date.parse("2025-05-05T14:30:00.000Z"));
  assert.equal(sessionLog.method, "UWorld [Auto]");
  assert.equal(sessionLog.isDistraction, false);
});

test("recovered distraction session maps to clean Reddit [Auto] with distraction preserved", () => {
  const finalized = finalizeAutoTrackerV2RecoveredPreviewSession(
    recoveredDistractionRedditSession({
      startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
      lastSeenAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
    }),
  );
  assert.ok(finalized);

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    finalized,
    "tf-auto-v2-preview-write-recovered-reddit",
  );

  assert.equal(finalized.endedAtMs, Date.parse("2025-05-05T14:30:00.000Z"));
  assert.equal(sessionLog.method, "Reddit [Auto]");
  assert.equal(sessionLog.isDistraction, true);
});

test("recovered finalization uses lastSeenAtMs instead of the later recovery click time", () => {
  const finalized = finalizeAutoTrackerV2RecoveredPreviewSession(
    recoveredTrackedUWorldSession({
      startedAtMs: 10_000,
      lastSeenAtMs: 40_000,
    }),
  );
  assert.ok(finalized);

  assert.equal(finalized.endedAtMs, 40_000);
  assert.equal(finalized.durationMs, 30_000);
  assert.equal(finalized.finalizedBy, "manualStop");
});

test("stop-finalize writes the active tracked preview session", () => {
  const previewSpans = [trackedUWorldSpan({ startedAtMs: 0, endedAtMs: null, durationMs: null })];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 75_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "tracked");
  assert.equal(selection.previewSession?.targetLabel, "UWorld");
  assert.equal(selection.previewSession?.startedAtMs, 0);
  assert.equal(selection.previewSession?.endedAtMs, 75_000);
  assert.equal(selection.previewSession?.finalizedBy, "manualStop");
});

test("stop-finalize writes the awayPending tracked preview session when a newer TimeFolio span is present", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 60_000, durationMs: 60_000 }),
    timeFolioUnclassifiedSpan({ startedAtMs: 61_000, endedAtMs: null, durationMs: null }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 75_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(preview.state.status, "awayPending");
  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "tracked");
  assert.equal(selection.previewSession?.targetLabel, "UWorld");
  assert.equal(selection.previewSession?.startedAtMs, 0);
  assert.equal(selection.previewSession?.endedAtMs, 75_000);
  assert.equal(selection.previewSession?.isDistraction, false);
});

test("stop-finalize writes the active distraction preview session", () => {
  const previewSpans = [
    distractionRedditSpan({
      startedAtMs: 20_000,
      endedAtMs: null,
      durationMs: null,
    }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "distraction");
  assert.equal(selection.previewSession?.isDistraction, true);
  assert.equal(selection.previewSession?.targetLabel, "Reddit");
  assert.equal(selection.previewSession?.startedAtMs, 20_000);
  assert.equal(selection.previewSession?.endedAtMs, 95_000);
  assert.equal(selection.previewSession?.finalizedBy, "manualStop");
});

test("stop-finalize writes the awayPending distraction preview session with isDistraction true", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({
      startedAtMs: 20_000,
      endedAtMs: null,
      durationMs: null,
    }),
    timeFolioUnclassifiedSpan({ startedAtMs: 40_000, endedAtMs: null, durationMs: null }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(preview.state.status, "awayPending");
  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "distraction");
  assert.equal(selection.previewSession?.isDistraction, true);
  assert.equal(selection.previewSession?.targetLabel, "Reddit");
  assert.equal(selection.previewSession?.startedAtMs, 20_000);
  assert.equal(selection.previewSession?.endedAtMs, 95_000);
  assert.equal(selection.previewSession?.finalizedBy, "manualStop");
});

test("stop-finalize excludes an active unclassified preview session", () => {
  const previewSpans = [timeFolioUnclassifiedSpan({ startedAtMs: 10_000 })];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "noActiveSession");
  assert.equal(selection.previewSession, null);
});

test("stop-finalize does not write an awayPending tracked preview session twice", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 60_000, durationMs: 60_000 }),
    timeFolioUnclassifiedSpan({ startedAtMs: 61_000, endedAtMs: null, durationMs: null }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 75_000,
    writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
  });

  assert.equal(selection.reason, "alreadyWritten");
  assert.equal(selection.previewSession, null);
});

test("stop-finalize is a no-op when there is no active preview session", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: 10_000, durationMs: 10_000 }),
    distractionRedditSpan({ startedAtMs: 20_000, endedAtMs: 90_000, durationMs: 70_000 }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "noActiveSession");
  assert.equal(selection.previewSession, null);
});

test("stop-finalize picks the last eligible tracked preview session before a newer TimeFolio span", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: null, durationMs: null }),
    timeFolioUnclassifiedSpan({ startedAtMs: 40_000 }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 75_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "tracked");
  assert.equal(selection.previewSession?.targetLabel, "UWorld");
  assert.equal(selection.previewSession?.endedAtMs, 75_000);
});

test("stop-finalize picks the last eligible distraction preview session before a newer TimeFolio span", () => {
  const previewSpans = [
    distractionRedditSpan({
      startedAtMs: 20_000,
      endedAtMs: null,
      durationMs: null,
    }),
    timeFolioUnclassifiedSpan({ startedAtMs: 40_000 }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "distraction");
  assert.equal(selection.previewSession?.isDistraction, true);
  assert.equal(selection.previewSession?.targetLabel, "Reddit");
  assert.equal(selection.previewSession?.endedAtMs, 95_000);
});

test("stop-finalize skips already-written ids and falls back to the next eligible preview session", () => {
  const previewSpans = [
    trackedUWorldSpan({ startedAtMs: 0, endedAtMs: null, durationMs: null }),
    distractionRedditSpan({
      startedAtMs: 20_000,
      endedAtMs: null,
      durationMs: null,
    }),
    timeFolioUnclassifiedSpan({ startedAtMs: 40_000 }),
  ];
  const preview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const selection = selectAutoTrackerV2StopFinalizePreviewSession({
    previewSpans,
    state: preview.state,
    nowMs: 95_000,
    writtenPreviewSessionIds: ["website:apps.uworld.com/courseapp:0"],
  });

  assert.equal(selection.reason, "eligible");
  assert.equal(selection.previewSession?.classification, "distraction");
  assert.equal(selection.previewSession?.isDistraction, true);
  assert.equal(selection.previewSession?.targetLabel, "Reddit");
});

test("visible title remains Resource [Auto]", () => {
  const previewSession: TfAutotrackerV2FinalizedPreviewSession = {
    previewSessionId: "website:resource.example.com/course:1746453600000",
    startedAtMs: Date.parse("2025-05-05T14:00:00.000Z"),
    endedAtMs: Date.parse("2025-05-05T14:30:00.000Z"),
    durationMs: 30 * 60_000,
    targetLabel: "Resource",
    sourceTargetStableId: "resource.example.com/course",
    sourceSpanIds: ["span-resource"],
    sourceEventIds: ["event-resource"],
    matchedRuleName: "Resource",
    matchedRuleTarget: "https://resource.example.com",
    browserTitle: "Resource",
    browserUrl: "https://resource.example.com/course",
    classificationReason: 'matched website rule "Resource" (https://resource.example.com) by host resource.example.com',
    classification: "tracked",
    finalizedBy: "manualStop",
    isDistraction: false,
  };

  const sessionLog = mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    previewSession,
    "tf-auto-v2-preview-write-resource",
  );

  assert.equal(sessionLog.method, "Resource [Auto]");
  assert.equal(sessionLog.methodKey, "auto-v2-preview-resource");
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
        matchedRuleName: "UWorld",
        matchedRuleTarget: "https://apps.uworld.com",
        browserTitle: "UWorld Step 2",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
        classificationReason: 'matched website rule "UWorld" (https://apps.uworld.com) by host apps.uworld.com',
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
        matchedRuleName: "Anki",
        matchedRuleTarget: "/Applications/Anki.app",
        appName: "Anki",
        bundleId: "net.ankiweb.dtop",
        classificationReason: 'matched app rule "Anki" (/Applications/Anki.app) by app name Anki',
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
