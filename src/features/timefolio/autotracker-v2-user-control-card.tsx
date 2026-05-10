import type { TfAutotrackerV2PreviewSpan } from "../../lib/tf-autotracker-v2-preview-spans";
import type { TfAutotrackerV2FinalizedPreviewSession } from "../../lib/tf-autotracker-v2-reducer-preview";
import {
  buildAutoTrackerV2StopSaveCopy,
  buildAutoTrackerV2UserModeSetupCopy,
  buildAutoTrackerV2UserModeStatusCopy,
  formatAutoTrackerV2ApproxDuration,
  formatAutoTrackerV2SavedRunSummary,
} from "../../lib/tf-autotracker-v2-user-mode-copy";
import { cn } from "../../lib/ui";
import type { AutoTrackerV2SessionControl } from "./autotracker-v2-session-control";

const MAX_VISIBLE_TIMELINE_ROWS = 5;

type AutoTrackerV2UserControlStripProps = {
  control: AutoTrackerV2SessionControl;
};

function actionButtonClassName(isRunning: boolean, disabled: boolean): string {
  return [
    "inline-flex min-h-11 items-center justify-center rounded-[18px] border px-4 py-2.5 text-sm font-semibold transition-colors",
    isRunning
      ? "border-white/10 bg-white/[0.08] text-slate-100 hover:bg-white/[0.12]"
      : "border-cyan-400/20 bg-cyan-400/[0.12] text-cyan-50 hover:bg-cyan-400/[0.18]",
    disabled ? "cursor-not-allowed opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function statusPillClassName(
  tone: "off" | "running" | "saved" | "needsSetup" | "checking",
): string {
  switch (tone) {
    case "running":
      return "border-emerald-400/20 bg-emerald-400/[0.12] text-emerald-100";
    case "saved":
      return "border-cyan-400/20 bg-cyan-400/[0.12] text-cyan-100";
    case "needsSetup":
      return "border-amber-400/20 bg-amber-400/[0.12] text-amber-100";
    case "checking":
      return "border-white/10 bg-white/5 text-slate-300";
    case "off":
    default:
      return "border-white/10 bg-white/5 text-slate-200";
  }
}

function messageClassName(tone: "success" | "error" | "info"): string {
  switch (tone) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-100";
    case "error":
      return "border-rose-500/20 bg-rose-500/10 text-rose-100";
    case "info":
    default:
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";
  }
}

function getHostname(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function isSafeVisibleAppLabel(value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  if (trimmed.length > 80) {
    return false;
  }

  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.toLowerCase().includes(".app")) {
    return false;
  }

  if (/^[a-z0-9.-]+$/iu.test(trimmed) && trimmed.includes(".")) {
    return false;
  }

  return true;
}

function getPreviewSpanLabel(span: TfAutotrackerV2PreviewSpan): string {
  const matchedRuleName = span.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  if (span.kind === "website") {
    const hostname = getHostname(span.browserUrl);
    if (hostname) {
      return hostname;
    }
  }

  const processIdentityName = span.processIdentityName?.trim();
  if (processIdentityName && isSafeVisibleAppLabel(processIdentityName)) {
    return processIdentityName;
  }

  const appName = span.appName?.trim();
  if (appName && isSafeVisibleAppLabel(appName)) {
    return appName;
  }

  const label = span.label?.trim();
  if (label && isSafeVisibleAppLabel(label)) {
    return label;
  }

  return span.kind === "website" ? "Unknown website" : "Unknown app";
}

function getPreviewSpanDurationMs(
  span: TfAutotrackerV2PreviewSpan,
  previewNowMs: number,
): number | null {
  if (typeof span.durationMs === "number" && Number.isFinite(span.durationMs)) {
    return span.durationMs;
  }

  if (!Number.isFinite(span.startedAtMs)) {
    return null;
  }

  return Math.max(0, previewNowMs - span.startedAtMs);
}

function getPreviewSessionLabel(session: TfAutotrackerV2FinalizedPreviewSession): string {
  const matchedRuleName = session.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  const explicitLabel = session.targetLabel.trim();
  if (explicitLabel) {
    return explicitLabel;
  }

  const hostname = getHostname(session.browserUrl);
  if (hostname) {
    return hostname;
  }

  const appName = session.appName?.trim();
  if (appName) {
    return appName;
  }

  return "Auto-Tracked";
}

export function AutoTrackerV2UserControlStrip({ control }: AutoTrackerV2UserControlStripProps) {
  const setupCopy = buildAutoTrackerV2UserModeSetupCopy({
    nativeStatus: control.nativeStatus,
    trackedRuleCount: control.trackedRuleCount,
    distractionRuleCount: control.distractionRuleCount,
    samplerHasError: control.message?.tone === "error",
  });
  const hasSavedRun = !control.isRunning && (control.lastSavedRunSummary?.entryCount ?? 0) > 0;
  const isCheckingSetup = !control.isRunning && !hasSavedRun && setupCopy.label === "Checking setup";
  const needsSetup =
    !control.isRunning &&
    !hasSavedRun &&
    !isCheckingSetup &&
    setupCopy.tone !== "ready" &&
    setupCopy.label !== "Needs attention";
  const statusCopy = buildAutoTrackerV2UserModeStatusCopy({
    isRunning: control.isRunning,
    runningElapsedLabel: control.runningElapsedLabel,
    savedEntryCount: control.lastSavedRunSummary?.entryCount ?? 0,
    needsSetup,
  });
  const classifiedPreviewSessions = control.stopSaveSelection.previewSessions;
  const hasDetectedActivity = control.previewSpans.length > 0;
  const hasUnclassifiedActivity = control.previewSpans.some(
    (span) => span.classification === "unclassified",
  );
  const stopSaveCopy = buildAutoTrackerV2StopSaveCopy({
    isRunning: control.isRunning,
    saveableCount: classifiedPreviewSessions.length,
    hasDetectedActivity,
    hasUnclassifiedActivity,
    alreadyWritten: hasSavedRun,
  });
  const currentSpanLabel = control.currentPreviewSpan
    ? getPreviewSpanLabel(control.currentPreviewSpan)
    : control.lastDetectedAppName?.trim() || "Nothing detected yet";
  const currentSpanDurationMs = control.currentPreviewSpan
    ? getPreviewSpanDurationMs(control.currentPreviewSpan, control.previewNowMs)
    : null;
  const savedSummary = hasSavedRun
    ? formatAutoTrackerV2SavedRunSummary(control.lastSavedRunSummary?.names ?? [])
    : null;
  const visibleTimelineClassName =
    classifiedPreviewSessions.length > MAX_VISIBLE_TIMELINE_ROWS
      ? "max-h-56 overflow-y-auto pr-1"
      : "";
  const statusTone: "off" | "running" | "saved" | "needsSetup" | "checking" = control.isRunning
    ? "running"
    : hasSavedRun
      ? "saved"
      : needsSetup
        ? "needsSetup"
        : isCheckingSetup
          ? "checking"
          : "off";
  const actionLabel = control.isActionBusy
    ? control.isRunning
      ? classifiedPreviewSessions.length > 0
        ? "Stopping & Saving..."
        : "Stopping..."
      : hasSavedRun
        ? "Starting..."
        : "Starting..."
    : stopSaveCopy.actionLabel;
  const shouldShowMessage =
    control.message !== null &&
    (control.message.tone === "error" || control.message.tone === "info");

  return (
    <section className="mt-4 rounded-[24px] border border-white/10 bg-slate-950/35 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.18)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold text-slate-100">Auto-Tracking</h4>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
              statusPillClassName(statusTone),
            )}
          >
            {statusCopy.pillLabel}
          </span>
          {statusCopy.metaLabel ? (
            <span className="text-sm font-medium tabular-nums text-slate-300">
              {statusCopy.metaLabel}
            </span>
          ) : null}
        </div>
      </div>

      {shouldShowMessage ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mt-3 rounded-[18px] border px-3 py-2 text-sm",
            messageClassName(control.message!.tone),
          )}
        >
          {control.message!.text}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-3">
        {control.isRunning ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="text-slate-400">Current:</span>
              <span className="min-w-0 truncate font-medium text-slate-100">{currentSpanLabel}</span>
              {currentSpanDurationMs !== null ? (
                <span className="text-xs tabular-nums text-slate-500">
                  {formatAutoTrackerV2ApproxDuration(currentSpanDurationMs)}
                </span>
              ) : null}
            </div>

            {classifiedPreviewSessions.length > 0 ? (
              <div
                className={cn(
                  "rounded-[20px] bg-white/[0.03] px-3",
                  visibleTimelineClassName,
                )}
              >
                {classifiedPreviewSessions.map((session) => {
                  const isActive = Boolean(
                    control.currentPreviewSpan &&
                      session.sourceSpanIds.includes(control.currentPreviewSpan.id),
                  );

                  return (
                    <div
                      key={session.previewSessionId}
                      className="flex items-center gap-3 border-b border-white/6 py-2.5 last:border-b-0"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {isActive ? (
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.12)]"
                          />
                        ) : (
                          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white/12" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                          {getPreviewSessionLabel(session)}
                        </span>
                        {session.isDistraction ? (
                          <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-rose-100">
                            distraction
                          </span>
                        ) : null}
                        {isActive ? (
                          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-200">
                            live
                          </span>
                        ) : null}
                      </div>
                      <span className="text-sm tabular-nums text-slate-400">
                        {formatAutoTrackerV2ApproxDuration(session.durationMs)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-400">
                {stopSaveCopy.supportingLine ?? "Nothing tracked yet"}
              </div>
            )}
          </>
        ) : hasSavedRun ? (
          <div className="text-sm leading-6 text-slate-300">{savedSummary}</div>
        ) : (
          <div className="text-sm leading-6 text-slate-400">
            {setupCopy.detail ?? "Track study apps and sites automatically."}
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={control.isRunning ? control.onStopAndSave : control.onStart}
            disabled={control.isActionBusy}
            className={actionButtonClassName(control.isRunning, control.isActionBusy)}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
