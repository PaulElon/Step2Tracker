import { useEffect, useRef, useState } from "react";
import { FF } from "../../lib/feature-flags";
import {
  buildAutoTrackerV2PreviewSpans,
  type TfAutotrackerV2ClassificationSettings,
  type TfAutotrackerV2PreviewSpan,
} from "../../lib/tf-autotracker-v2-preview-spans";
import {
  buildAutoTrackerV2ReducerPreview,
  mapAutoTrackerV2FinalizedPreviewSessionToSessionLog,
  selectAutoTrackerV2StopSavePreviewSessions,
  type TfAutotrackerV2FinalizedPreviewSession,
  type TfAutotrackerV2StopSaveSelection,
} from "../../lib/tf-autotracker-v2-reducer-preview";
import {
  getAutoTrackerV2NativeSamplerStatus,
  snapshotAutoTrackerV2Native,
  startAutoTrackerV2NativeSampler,
  stopAutoTrackerV2NativeSampler,
  type AutoTrackerV2NativeSamplerStatus,
  type AutoTrackerV2NativeSnapshot,
  type AutoTrackerV2NativeStatus,
} from "../../lib/tf-autotracker-v2-native-events";
import { useTimeFolioStore } from "../../state/tf-store";
import type { TfSessionLog } from "../../types/models";

export type AutoTrackerV2UserControlMessage = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

export type AutoTrackerV2SessionControl = {
  isRunning: boolean;
  isActionBusy: boolean;
  isStopAndSaveBusy: boolean;
  lastDetectedAppName: string | null;
  runningElapsedLabel: string | null;
  nativeStatus: AutoTrackerV2NativeStatus | null;
  previewSpans: TfAutotrackerV2PreviewSpan[];
  currentPreviewSpan: TfAutotrackerV2PreviewSpan | null;
  stopSaveSelection: TfAutotrackerV2StopSaveSelection;
  previewNowMs: number;
  trackedRuleCount: number;
  distractionRuleCount: number;
  message: AutoTrackerV2UserControlMessage;
  onStart: () => void;
  onStopAndSave: () => void;
};

function makeAutoTrackerV2PreviewSessionLogId(previewSessionId: string): string {
  const normalizedPreviewId =
    previewSessionId
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60) || "preview-session";
  const uniqueSuffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return `tf-auto-v2-preview-${normalizedPreviewId}-${uniqueSuffix}`;
}

function toSessionLog(
  previewSession: TfAutotrackerV2FinalizedPreviewSession,
): TfSessionLog {
  return mapAutoTrackerV2FinalizedPreviewSessionToSessionLog(
    previewSession,
    makeAutoTrackerV2PreviewSessionLogId(previewSession.previewSessionId),
  );
}

function formatElapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function useAutoTrackerV2SessionControl(): AutoTrackerV2SessionControl {
  const { state, upsertSessionLog } = useTimeFolioStore();
  const [v2SamplerStatus, setV2SamplerStatus] = useState<AutoTrackerV2NativeSamplerStatus | null>(
    null,
  );
  const [v2Snapshot, setV2Snapshot] = useState<AutoTrackerV2NativeSnapshot | null>(null);
  const [v2SamplerActionBusy, setV2SamplerActionBusy] = useState(false);
  const [v2IsStopFinalizing, setV2IsStopFinalizing] = useState(false);
  const [v2UserModeMessage, setV2UserModeMessage] =
    useState<AutoTrackerV2UserControlMessage>(null);
  const [v2WrittenPreviewSessionIds, setV2WrittenPreviewSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [v2RunningStartedAtMs, setV2RunningStartedAtMs] = useState<number | null>(null);
  const [v2RunningNowMs, setV2RunningNowMs] = useState<number>(() => Date.now());
  const v2WritingPreviewSessionIdsRef = useRef<Set<string>>(new Set());

  const classificationSettings: TfAutotrackerV2ClassificationSettings = {
    autoApps: state.trackerPrefs.customAutoApps,
    autoWebsites: state.trackerPrefs.customAutoWebsites,
    distractionApps: state.trackerPrefs.customDistractionApps,
    distractionWebsites: state.trackerPrefs.customDistractionWebsites,
  };
  const trackedRuleCount =
    classificationSettings.autoApps.length + classificationSettings.autoWebsites.length;
  const distractionRuleCount =
    classificationSettings.distractionApps.length + classificationSettings.distractionWebsites.length;
  const previewSpans = buildAutoTrackerV2PreviewSpans(v2Snapshot?.events ?? [], classificationSettings);
  const reducerPreview = buildAutoTrackerV2ReducerPreview(previewSpans);
  const isRunning = v2SamplerStatus?.running === true;
  const isActionBusy = v2SamplerActionBusy || v2IsStopFinalizing;
  const lastDetectedAppName = v2SamplerStatus?.lastObservedAppName ?? null;
  const previewNowMs = isRunning ? v2RunningNowMs : Date.now();
  const stopSaveSelection = selectAutoTrackerV2StopSavePreviewSessions({
    finalizedPreviewSessions: reducerPreview.finalizedPreviewSessions,
    previewSpans,
    state: reducerPreview.state,
    nowMs: previewNowMs,
    writtenPreviewSessionIds: new Set([
      ...v2WrittenPreviewSessionIds,
      ...v2WritingPreviewSessionIdsRef.current,
    ]),
  });
  const currentPreviewSpan = previewSpans.at(-1) ?? null;
  const runningElapsedLabel =
    isRunning && v2RunningStartedAtMs !== null
      ? formatElapsedLabel(v2RunningNowMs - v2RunningStartedAtMs)
      : null;

  async function refreshSamplerState() {
    try {
      const [samplerStatus, snapshot] = await Promise.all([
        getAutoTrackerV2NativeSamplerStatus(),
        snapshotAutoTrackerV2Native(),
      ]);
      setV2SamplerStatus(samplerStatus);
      setV2Snapshot(snapshot);
    } catch (error) {
      setV2UserModeMessage({
        tone: "error",
        text:
          error instanceof Error && error.message
            ? error.message
            : "Unable to refresh Auto-Tracking status.",
      });
    }
  }

  useEffect(() => {
    if (!FF.autotrackerV2UserMode) {
      return;
    }

    void refreshSamplerState();
  }, []);

  useEffect(() => {
    if (!FF.autotrackerV2UserMode || !isRunning) {
      return;
    }

    const refreshIntervalId = window.setInterval(() => {
      void refreshSamplerState();
    }, 1500);
    const clockIntervalId = window.setInterval(() => {
      setV2RunningNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(refreshIntervalId);
      window.clearInterval(clockIntervalId);
    };
  }, [isRunning]);

  async function handleStart() {
    if (isActionBusy || isRunning) {
      return;
    }

    setV2UserModeMessage(null);
    setV2SamplerActionBusy(true);
    try {
      const samplerStatus = await startAutoTrackerV2NativeSampler();
      const startedAtMs = Date.now();
      setV2SamplerStatus(samplerStatus);
      setV2RunningStartedAtMs(startedAtMs);
      setV2RunningNowMs(startedAtMs);
      await refreshSamplerState();
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Unable to start Auto-Tracking.";
      setV2UserModeMessage({
        tone: "error",
        text: message,
      });
    } finally {
      setV2SamplerActionBusy(false);
    }
  }

  async function handleStopAndSave() {
    if (v2SamplerActionBusy || v2IsStopFinalizing) {
      return;
    }

    setV2UserModeMessage(null);
    setV2IsStopFinalizing(true);

    try {
      const nowMs = Date.now();
      const selection = selectAutoTrackerV2StopSavePreviewSessions({
        finalizedPreviewSessions: reducerPreview.finalizedPreviewSessions,
        previewSpans,
        state: reducerPreview.state,
        nowMs,
        writtenPreviewSessionIds: new Set([
          ...v2WrittenPreviewSessionIds,
          ...v2WritingPreviewSessionIdsRef.current,
        ]),
      });
      let stoppedSampler = false;
      const selectionCount = selection.previewSessions.length;
      const hasDetectedActivity = previewSpans.length > 0;
      const hasUnclassifiedActivity = previewSpans.some(
        (span) => span.classification === "unclassified",
      );

      if (isRunning) {
        const samplerStatus = await stopAutoTrackerV2NativeSampler();
        setV2SamplerStatus(samplerStatus);
        stoppedSampler = true;
      }

      if (selectionCount === 0) {
        setV2UserModeMessage({
          tone: "info",
          text: stoppedSampler
            ? selection.reason === "alreadyWritten"
              ? "Auto-Tracking stopped. All classified spans from this run were already saved."
              : hasUnclassifiedActivity
                ? "Auto-Tracking stopped. Nothing was saved because this run only had unclassified activity."
                : hasDetectedActivity
                  ? "Auto-Tracking stopped. No classified spans were ready to save."
                  : "Auto-Tracking stopped. No activity was detected."
            : selection.reason === "alreadyWritten"
              ? "Those classified spans were already saved."
              : hasUnclassifiedActivity
                ? "Nothing is ready to save yet because this run is still unclassified."
                : hasDetectedActivity
                  ? "No classified spans are ready to save yet."
                  : "No activity is ready to save yet.",
        });
        return;
      }

      for (const previewSession of selection.previewSessions) {
        v2WritingPreviewSessionIdsRef.current.add(previewSession.previewSessionId);
      }
      try {
        for (const previewSession of selection.previewSessions) {
          const sessionLog = toSessionLog(previewSession);
          await upsertSessionLog(sessionLog);
          setV2WrittenPreviewSessionIds((current) => {
            if (current.has(previewSession.previewSessionId)) {
              return current;
            }
            const next = new Set(current);
            next.add(previewSession.previewSessionId);
            return next;
          });
        }
        setV2UserModeMessage({
          tone: "success",
          text: stoppedSampler
            ? `Auto-Tracking stopped and saved ${selectionCount} Session Log ${
                selectionCount === 1 ? "entry" : "entries"
              }.`
            : `Saved ${selectionCount} Session Log ${
                selectionCount === 1 ? "entry" : "entries"
              }.`,
        });
        await refreshSamplerState();
      } finally {
        for (const previewSession of selection.previewSessions) {
          v2WritingPreviewSessionIdsRef.current.delete(previewSession.previewSessionId);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Unable to stop and save Auto-Tracking.";
      setV2UserModeMessage({
        tone: "error",
        text: message,
      });
    } finally {
      setV2IsStopFinalizing(false);
    }
  }

  return {
    isRunning,
    isActionBusy,
    isStopAndSaveBusy: isActionBusy,
    lastDetectedAppName,
    runningElapsedLabel,
    nativeStatus: v2Snapshot?.status ?? null,
    previewSpans,
    currentPreviewSpan,
    stopSaveSelection,
    previewNowMs,
    trackedRuleCount,
    distractionRuleCount,
    message: v2UserModeMessage,
    onStart: () => {
      void handleStart();
    },
    onStopAndSave: () => {
      void handleStopAndSave();
    },
  };
}
