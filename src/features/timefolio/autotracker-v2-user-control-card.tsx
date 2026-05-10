import type { ReactNode } from "react";
import { Clock3, Play, Save } from "lucide-react";
import type { TfAutotrackerV2PreviewSpan } from "../../lib/tf-autotracker-v2-preview-spans";
import type { TfAutotrackerV2FinalizedPreviewSession } from "../../lib/tf-autotracker-v2-reducer-preview";
import {
  buildAutoTrackerV2StopSaveCopy,
  buildAutoTrackerV2UserModeSetupCopy,
  buildAutoTrackerV2UserModeStatusCopy,
  formatAutoTrackerV2ApproxDuration,
} from "../../lib/tf-autotracker-v2-user-mode-copy";
import { cn } from "../../lib/ui";
import type { AutoTrackerV2SessionControl } from "./autotracker-v2-session-control";

type AutoTrackerV2UserControlStripProps = {
  control: AutoTrackerV2SessionControl;
};

function actionButtonClassName(isRunning: boolean, disabled: boolean): string {
  const toneClass = isRunning
    ? "border-rose-500/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20";

  return [
    "inline-flex items-center justify-center gap-2 rounded-[20px] border px-4 py-3 text-sm font-semibold transition-colors",
    toneClass,
    disabled ? "cursor-not-allowed opacity-60" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function stateBadgeClassName(isRunning: boolean): string {
  return isRunning
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
    : "border-white/10 bg-slate-900/70 text-slate-200";
}

function setupBadgeClassName(tone: "ready" | "attention" | "unsupported"): string {
  switch (tone) {
    case "ready":
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";
    case "unsupported":
      return "border-rose-500/20 bg-rose-500/10 text-rose-100";
    case "attention":
    default:
      return "border-amber-500/20 bg-amber-500/10 text-amber-100";
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

function classificationBadgeClassName(classification: string): string {
  switch (classification) {
    case "tracked":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
    case "distraction":
      return "border-rose-500/20 bg-rose-500/10 text-rose-100";
    case "unclassified":
    default:
      return "border-white/10 bg-slate-900/70 text-slate-300";
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

function getPreviewSpanLabel(span: TfAutotrackerV2PreviewSpan): string {
  const matchedRuleName = span.matchedRuleName?.trim();
  if (matchedRuleName) {
    return matchedRuleName;
  }

  if (span.kind === "website") {
    const browserTitle = span.browserTitle?.trim();
    if (browserTitle) {
      return browserTitle;
    }
    const hostname = getHostname(span.browserUrl);
    if (hostname) {
      return hostname;
    }
  }

  const processIdentityName = span.processIdentityName?.trim();
  if (processIdentityName) {
    return processIdentityName;
  }

  const appName = span.appName?.trim();
  if (appName) {
    return appName;
  }

  return span.label?.trim() || (span.kind === "website" ? "Unknown website" : "Unknown app");
}

function getPreviewSpanDetail(span: TfAutotrackerV2PreviewSpan, label: string): string {
  if (span.classification === "unclassified") {
    return "Not matched to Allowed or Distraction rules yet.";
  }

  if (span.kind === "website") {
    const hostname = getHostname(span.browserUrl);
    if (hostname && hostname !== label) {
      return hostname;
    }
  }

  const appName = span.appName?.trim();
  if (appName && appName !== label) {
    return appName;
  }

  return span.classification === "distraction"
    ? "Will save as a distraction if you stop now."
    : "Counted as tracked study time.";
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

function getPreviewSessionDetail(session: TfAutotrackerV2FinalizedPreviewSession): string {
  const label = session.targetLabel.trim();
  const hostname = getHostname(session.browserUrl);
  if (hostname && hostname !== label) {
    return hostname;
  }

  const appName = session.appName?.trim();
  if (appName && appName !== label) {
    return appName;
  }

  return session.isDistraction ? "Will save as a distraction." : "Will save as tracked study time.";
}

function SummaryCard({
  label,
  value,
  detail,
  footer,
  valueClassName,
}: {
  label: string;
  value: string;
  detail: string;
  footer?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-h-[132px] flex-col gap-2 rounded-[22px] border border-white/10 bg-slate-950/40 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={cn("text-lg font-semibold text-slate-100", valueClassName)}>{value}</div>
      <div className="text-sm leading-6 text-slate-400">{detail}</div>
      {footer ? <div className="mt-auto">{footer}</div> : null}
    </div>
  );
}

export function AutoTrackerV2UserControlStrip({ control }: AutoTrackerV2UserControlStripProps) {
  const statusCopy = buildAutoTrackerV2UserModeStatusCopy({
    isRunning: control.isRunning,
    lastDetectedAppName: control.lastDetectedAppName,
    runningElapsedLabel: control.runningElapsedLabel,
  });
  const hasDetectedActivity = control.previewSpans.length > 0;
  const unclassifiedSpanCount = control.previewSpans.filter(
    (span) => span.classification === "unclassified",
  ).length;
  const saveableTrackedCount = control.stopSaveSelection.previewSessions.filter(
    (session) => !session.isDistraction,
  ).length;
  const saveableDistractionCount = control.stopSaveSelection.previewSessions.filter(
    (session) => session.isDistraction,
  ).length;
  const setupCopy = buildAutoTrackerV2UserModeSetupCopy({
    nativeStatus: control.nativeStatus,
    trackedRuleCount: control.trackedRuleCount,
    distractionRuleCount: control.distractionRuleCount,
    samplerHasError: control.message?.tone === "error",
  });
  const stopSaveCopy = buildAutoTrackerV2StopSaveCopy({
    isRunning: control.isRunning,
    saveableCount: control.stopSaveSelection.previewSessions.length,
    hasDetectedActivity,
    hasUnclassifiedActivity: unclassifiedSpanCount > 0,
    alreadyWritten: control.stopSaveSelection.reason === "alreadyWritten",
  });
  const currentSpanLabel = control.currentPreviewSpan
    ? getPreviewSpanLabel(control.currentPreviewSpan)
    : control.lastDetectedAppName?.trim() || "Nothing detected yet";
  const currentSpanDetail = control.currentPreviewSpan
    ? getPreviewSpanDetail(control.currentPreviewSpan, currentSpanLabel)
    : control.isRunning
      ? "Waiting for the first detected app or site."
      : "Start Auto-Tracking to populate the live run preview.";
  const currentSpanDurationMs = control.currentPreviewSpan
    ? getPreviewSpanDurationMs(control.currentPreviewSpan, control.previewNowMs)
    : null;
  const actionLabel = control.isActionBusy
    ? control.isRunning
      ? control.stopSaveSelection.previewSessions.length > 0
        ? "Stopping & Saving..."
        : "Stopping..."
      : "Starting..."
    : stopSaveCopy.actionLabel;
  const showRunPreview = control.isRunning || control.stopSaveSelection.previewSessions.length > 0;

  return (
    <section className="mt-4 flex flex-col gap-4 rounded-[28px] border border-white/10 bg-slate-950/35 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]">
            <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-200">
              Auto-Tracking
            </span>
            <span className={cn("rounded-full border px-3 py-1", stateBadgeClassName(control.isRunning))}>
              {control.isRunning ? "Running" : "Off"}
            </span>
            <span className={cn("rounded-full border px-3 py-1", setupBadgeClassName(setupCopy.tone))}>
              {setupCopy.label}
            </span>
            <span className="rounded-full border border-white/10 bg-slate-900/70 px-3 py-1 text-slate-300">
              {control.trackedRuleCount + control.distractionRuleCount} rules
            </span>
            {control.isRunning && control.stopSaveSelection.previewSessions.length > 0 ? (
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                {control.stopSaveSelection.previewSessions.length} ready to save
              </span>
            ) : null}
          </div>

          <div>
            <h4 className="text-base font-semibold text-slate-100">{statusCopy.statusLine}</h4>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              {control.isRunning
                ? "Live preview of the current run and exactly what Stop & Save will write to Session Log."
                : "Start Auto-Tracking to see the live run timeline, detected resource, and save preview here."}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">{setupCopy.detail}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={control.isRunning ? control.onStopAndSave : control.onStart}
          disabled={control.isActionBusy}
          className={actionButtonClassName(control.isRunning, control.isActionBusy)}
        >
          {control.isRunning ? <Save className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {actionLabel}
        </button>
      </div>

      {control.message ? (
        <div
          role="status"
          aria-live="polite"
          className={cn("rounded-[20px] border px-4 py-3 text-sm", messageClassName(control.message.tone))}
        >
          {control.message.text}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="Run Status"
          value={control.isRunning ? control.runningElapsedLabel ?? "Live" : "Off"}
          detail={statusCopy.lastDetectedLine}
          footer={
            <div className="inline-flex items-center gap-2 text-xs text-slate-400">
              <Clock3 className="h-3.5 w-3.5 text-slate-500" />
              {control.isRunning ? "Updates every second while Auto-Tracking runs." : "Shows the last detected app after each refresh."}
            </div>
          }
        />

        <SummaryCard
          label="Current Detected"
          value={currentSpanLabel}
          detail={currentSpanDetail}
          footer={
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {control.currentPreviewSpan ? (
                <>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 font-medium",
                      classificationBadgeClassName(control.currentPreviewSpan.classification),
                    )}
                  >
                    {control.currentPreviewSpan.classification}
                  </span>
                  <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-slate-300">
                    {control.currentPreviewSpan.kind === "website" ? "site" : "app"}
                  </span>
                  {currentSpanDurationMs !== null ? (
                    <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-slate-300">
                      {formatAutoTrackerV2ApproxDuration(currentSpanDurationMs)}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-slate-300">
                  Waiting
                </span>
              )}
            </div>
          }
        />

        <SummaryCard
          label="Stop & Save"
          value={
            control.stopSaveSelection.previewSessions.length > 0
              ? `${control.stopSaveSelection.previewSessions.length} ${
                  control.stopSaveSelection.previewSessions.length === 1 ? "entry ready" : "entries ready"
                }`
              : "Nothing ready"
          }
          detail={stopSaveCopy.summaryLine}
          footer={
            <div className="text-xs leading-5 text-slate-400">
              {stopSaveCopy.detailLine}
            </div>
          }
        />
      </div>

      {showRunPreview ? (
        <div className="flex flex-col gap-3 rounded-[24px] border border-white/10 bg-slate-950/45 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Current Run Preview
              </div>
              <div className="mt-1 text-sm text-slate-300">
                {control.stopSaveSelection.previewSessions.length > 0
                  ? "These classified spans are what Stop & Save will write right now."
                  : "Auto-Tracking is running, but there are no classified spans ready to save yet."}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-200">
                {saveableTrackedCount} tracked
              </span>
              <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-100">
                {saveableDistractionCount} distraction
              </span>
              {unclassifiedSpanCount > 0 ? (
                <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-slate-300">
                  {unclassifiedSpanCount} unclassified hidden
                </span>
              ) : null}
            </div>
          </div>

          {control.stopSaveSelection.previewSessions.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-white/10 bg-slate-950/30 px-4 py-4 text-sm leading-6 text-slate-400">
              {stopSaveCopy.detailLine}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {control.stopSaveSelection.previewSessions.map((session) => {
                const isActive = Boolean(
                  control.currentPreviewSpan &&
                    session.sourceSpanIds.includes(control.currentPreviewSpan.id),
                );

                return (
                  <div
                    key={session.previewSessionId}
                    className={cn(
                      "flex flex-col gap-2 rounded-[20px] border px-4 py-3",
                      isActive
                        ? "border-cyan-500/20 bg-cyan-500/10"
                        : "border-white/10 bg-slate-950/30",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-100">
                        {session.targetLabel}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-1 text-[11px] font-medium",
                          classificationBadgeClassName(
                            session.isDistraction ? "distraction" : "tracked",
                          ),
                        )}
                      >
                        {session.isDistraction ? "distraction" : "tracked"}
                      </span>
                      <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-[11px] font-medium text-slate-300">
                        {session.browserUrl ? "site" : "app"}
                      </span>
                      {isActive ? (
                        <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-100">
                          live
                        </span>
                      ) : null}
                      <span className="rounded-full border border-white/10 bg-slate-900/70 px-2 py-1 text-[11px] font-medium text-slate-300">
                        {formatAutoTrackerV2ApproxDuration(session.durationMs)}
                      </span>
                    </div>

                    <div className="text-sm text-slate-400">{getPreviewSessionDetail(session)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
