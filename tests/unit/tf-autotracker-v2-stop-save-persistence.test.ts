import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
} from "../../src/lib/tf-autotracker-v2-preview-spans.js";
import {
  buildAutoTrackerV2ReducerPreview,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2StopSavePreviewSessions,
} from "../../src/lib/tf-autotracker-v2-reducer-preview.js";
import type { AutoTrackerV2NativeEvent } from "../../src/lib/tf-autotracker-v2-native-events.js";
import { persistAutoTrackerV2StopSaveSelection } from "../../src/lib/tf-autotracker-v2-stop-save-persistence.js";
import type { TfSessionLog } from "../../src/types/models.js";

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

const SETTINGS: TfAutotrackerV2ClassificationSettings = {
  autoApps: [],
  autoWebsites: [
    {
      id: "rule-uworld",
      name: "UWorld",
      target: "https://apps.uworld.com",
      kind: "website",
    },
    {
      id: "rule-truelearn",
      name: "TrueLearn",
      target: "https://www.truelearn.com",
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

test("stop/save persists each eligible entry once, clears pending run state, and keeps hydration clean", async () => {
  let liveRunEvents: AutoTrackerV2NativeEvent[] = [
    makeEvent({
      id: "ev-uworld",
      kind: "untrackedFocused",
      timestampMs: 1_000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "UWorld",
      browserUrl: "https://apps.uworld.com/courseapp/step2",
    }),
    makeEvent({
      id: "ev-truelearn",
      kind: "untrackedFocused",
      timestampMs: 5_000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "TrueLearn",
      browserUrl: "https://www.truelearn.com/dashboard",
    }),
    makeEvent({
      id: "ev-reddit",
      kind: "untrackedFocused",
      timestampMs: 9_000,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserTitle: "Reddit",
      browserUrl: "https://www.reddit.com/r/step2",
    }),
  ];

  const initialPreviewSpans = buildAutoTrackerV2PreviewSpans(liveRunEvents, SETTINGS);
  const initialReducerPreview = buildAutoTrackerV2ReducerPreview(initialPreviewSpans);
  const stopSaveSelection = selectAutoTrackerV2StopSavePreviewSessions({
    finalizedPreviewSessions: initialReducerPreview.finalizedPreviewSessions,
    previewSpans: initialPreviewSpans,
    state: initialReducerPreview.state,
    nowMs: 12_000,
    writtenPreviewSessionIds: [],
  });
  assert.equal(stopSaveSelection.previewSessions.length, 3);

  const persistedLogs: TfSessionLog[] = [];
  const persistedPreviewSessionIds: string[] = [];
  let clearSavedRunStateCount = 0;

  await persistAutoTrackerV2StopSaveSelection({
    previewSessions: stopSaveSelection.previewSessions,
    toSessionLog: (previewSession) =>
      mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
        previewSession,
        `log-${previewSession.previewSessionId}`,
      ),
    upsertSessionLog: async (sessionLog) => {
      persistedLogs.push(sessionLog);
    },
    onPreviewSessionPersisted: (previewSessionId) => {
      persistedPreviewSessionIds.push(previewSessionId);
    },
    clearSavedRunState: async () => {
      clearSavedRunStateCount += 1;
      liveRunEvents = [];
    },
  });

  assert.equal(clearSavedRunStateCount, 1);
  assert.equal(persistedLogs.length, 3);
  assert.equal(new Set(persistedLogs.map((sessionLog) => sessionLog.id)).size, 3);
  assert.deepEqual(
    persistedPreviewSessionIds,
    stopSaveSelection.previewSessions.map((previewSession) => previewSession.previewSessionId),
  );

  const afterSavePreviewSpans = buildAutoTrackerV2PreviewSpans(liveRunEvents, SETTINGS);
  const afterSaveReducerPreview = buildAutoTrackerV2ReducerPreview(afterSavePreviewSpans);
  const afterSaveSelection = selectAutoTrackerV2StopSavePreviewSessions({
    finalizedPreviewSessions: afterSaveReducerPreview.finalizedPreviewSessions,
    previewSpans: afterSavePreviewSpans,
    state: afterSaveReducerPreview.state,
    nowMs: 14_000,
    writtenPreviewSessionIds: [],
  });

  assert.equal(afterSaveSelection.previewSessions.length, 0);

  const hydratedPreviewSpans = buildAutoTrackerV2PreviewSpans(liveRunEvents, SETTINGS);
  const hydratedReducerPreview = buildAutoTrackerV2ReducerPreview(hydratedPreviewSpans);
  const hydratedSelection = selectAutoTrackerV2StopSavePreviewSessions({
    finalizedPreviewSessions: hydratedReducerPreview.finalizedPreviewSessions,
    previewSpans: hydratedPreviewSpans,
    state: hydratedReducerPreview.state,
    nowMs: 14_500,
    writtenPreviewSessionIds: [],
  });

  assert.equal(hydratedSelection.previewSessions.length, 0);
});

test("stop/save does not clear pending run state when persistence fails", async () => {
  const previewSpans = buildAutoTrackerV2PreviewSpans(
    [
      makeEvent({
        id: "ev-uworld-open",
        kind: "untrackedFocused",
        timestampMs: 2_000,
        appName: "Google Chrome",
        bundleId: "com.google.Chrome",
        browserTitle: "UWorld",
        browserUrl: "https://apps.uworld.com/courseapp/step2",
      }),
    ],
    SETTINGS,
  );
  const reducerPreview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const stopSaveSelection = selectAutoTrackerV2StopSavePreviewSessions({
    finalizedPreviewSessions: reducerPreview.finalizedPreviewSessions,
    previewSpans,
    state: reducerPreview.state,
    nowMs: 4_000,
    writtenPreviewSessionIds: [],
  });
  assert.equal(stopSaveSelection.previewSessions.length, 1);

  let clearSavedRunStateCount = 0;

  await assert.rejects(
    persistAutoTrackerV2StopSaveSelection({
      previewSessions: stopSaveSelection.previewSessions,
      toSessionLog: (previewSession) =>
        mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
          previewSession,
          `log-${previewSession.previewSessionId}`,
        ),
      upsertSessionLog: async () => {
        throw new Error("write failed");
      },
      clearSavedRunState: async () => {
        clearSavedRunStateCount += 1;
      },
    }),
    /write failed/,
  );

  assert.equal(clearSavedRunStateCount, 0);
});
