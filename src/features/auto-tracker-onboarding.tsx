import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Accessibility,
  Bell,
  Check,
  ChevronRight,
  HardDrive,
  Lock,
  Power,
} from "lucide-react";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
} from "../lib/reminders";
import {
  type AutoTrackerOnboardingState,
  type AutoTrackerOnboardingStepId,
  REQUIRED_ONBOARDING_STEPS,
  hasCompletedRequiredSteps,
  loadAutoTrackerOnboardingState,
  saveAutoTrackerOnboardingState,
} from "../lib/auto-tracker-onboarding";
import { cn } from "../lib/ui";

const LEGACY_BUNDLE_ID = "com.paul.step2ckcommandcenter";

type StepKind = "required" | "optional";
type StepStatus = "verified" | "manual" | "needsSetup";
type StepRequestMode = "notifications" | "accessibility" | "startAtLogin" | null;

interface OnboardingStep {
  id: AutoTrackerOnboardingStepId;
  kind: StepKind;
  title: string;
  body: string;
  instructions: string[];
  help: string;
  icon: (props: { className?: string }) => JSX.Element;
  openSettingsCommand: string;
  requestMode: StepRequestMode;
  requestButtonLabel?: string;
  supportsManualConfirmation: boolean;
}

interface PermissionSnapshot {
  notificationPermission: NotificationPermission | "unsupported";
  accessibilityTrusted: boolean | "unsupported";
  startAtLoginEnabled: boolean | "unsupported";
}

const STEPS: OnboardingStep[] = [
  {
    id: "notifications",
    kind: "required",
    title: "Enable Notifications",
    body: "TimeFolio uses notifications for timer updates, reminders, and setup alerts.",
    instructions: [
      "Click Request Access.",
      "Choose Allow in the macOS prompt.",
      "If the prompt does not appear, open Settings and enable TimeFolio manually.",
    ],
    help: "macOS can verify this permission automatically.",
    icon: (props) => <Bell {...props} />,
    openSettingsCommand: "open_notification_settings",
    requestMode: "notifications",
    requestButtonLabel: "Request Access",
    supportsManualConfirmation: false,
  },
  {
    id: "accessibility",
    kind: "required",
    title: "Grant Accessibility Access",
    body: "Accessibility lets TimeFolio identify the active app so study time can be tracked automatically.",
    instructions: [
      "Click Request Access.",
      "If macOS opens System Settings, enable TimeFolio from /Applications.",
      "Return here and click Check Again if the change does not appear immediately.",
    ],
    help: "macOS can verify Accessibility access automatically.",
    icon: (props) => <Accessibility {...props} />,
    openSettingsCommand: "open_accessibility_settings",
    requestMode: "accessibility",
    requestButtonLabel: "Request Access",
    supportsManualConfirmation: false,
  },
  {
    id: "fullDisk",
    kind: "required",
    title: "Allow Full Disk Access",
    body: "Full Disk Access helps TimeFolio read app activity consistently across macOS privacy boundaries.",
    instructions: [
      "Click Open Settings.",
      "Enable TimeFolio from /Applications in Full Disk Access.",
      "Return here and confirm after macOS shows it as enabled.",
    ],
    help: "macOS requires Full Disk Access to be enabled manually. There is no direct native allow prompt for this permission.",
    icon: (props) => <HardDrive {...props} />,
    openSettingsCommand: "open_full_disk_access_settings",
    requestMode: null,
    supportsManualConfirmation: true,
  },
  {
    id: "startAtLogin",
    kind: "optional",
    title: "Start at Login",
    body: "Optional, but recommended if you want TimeFolio ready each time you sign in.",
    instructions: [
      "Click Enable Start at Login.",
      "If macOS opens Login Items, keep TimeFolio enabled there.",
      "Use Check Again after returning if macOS approval finishes outside this window.",
    ],
    help: "TimeFolio does not have a separate native background-access prompt. This optional step only manages login-item startup.",
    icon: (props) => <Power {...props} />,
    openSettingsCommand: "open_login_items_settings",
    requestMode: "startAtLogin",
    requestButtonLabel: "Enable Start at Login",
    supportsManualConfirmation: false,
  },
];

function stepIcon(step: OnboardingStep, className: string) {
  return step.icon({ className });
}

function getStepStatusCopy(status: StepStatus, step: OnboardingStep): string {
  if (status === "verified") {
    return step.kind === "optional" ? "Enabled" : "Verified";
  }
  if (status === "manual") {
    return "Confirmed";
  }
  return step.kind === "optional" ? "Optional" : "Needs setup";
}

function getVerificationCopy(status: StepStatus, step: OnboardingStep): string {
  if (status === "verified") {
    return "Verified by macOS";
  }
  if (status === "manual") {
    return "Marked enabled by you";
  }
  return step.kind === "optional" ? "Optional" : "Needs setup";
}

interface AutoTrackerOnboardingProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function AutoTrackerOnboarding({
  onComplete,
  onSkip,
}: AutoTrackerOnboardingProps): JSX.Element {
  const [state, setState] = useState<AutoTrackerOnboardingState>(() =>
    loadAutoTrackerOnboardingState(),
  );
  const [activeStepId, setActiveStepId] = useState<AutoTrackerOnboardingStepId>(STEPS[0].id);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | "unsupported">(
    "unsupported",
  );
  const [startAtLoginEnabled, setStartAtLoginEnabled] = useState<boolean | "unsupported">(
    "unsupported",
  );
  const [isBusy, setIsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const confirmStep = useCallback((id: AutoTrackerOnboardingStepId) => {
    setState((prev) => {
      if (prev.confirmedSteps.includes(id)) return prev;
      const next: AutoTrackerOnboardingState = {
        ...prev,
        confirmedSteps: [...prev.confirmedSteps, id],
      };
      saveAutoTrackerOnboardingState(next);
      return next;
    });
  }, []);

  const unconfirmStep = useCallback((id: AutoTrackerOnboardingStepId) => {
    setState((prev) => {
      if (!prev.confirmedSteps.includes(id)) return prev;
      const next: AutoTrackerOnboardingState = {
        ...prev,
        confirmedSteps: prev.confirmedSteps.filter((entry) => entry !== id),
      };
      saveAutoTrackerOnboardingState(next);
      return next;
    });
  }, []);

  const readPermissionSnapshot = useCallback(async (): Promise<PermissionSnapshot> => {
    const [nextNotificationPermission, nextAccessibilityTrusted, nextStartAtLoginEnabled] =
      await Promise.all([
        getNotificationPermissionStatus(),
        (async () => {
          try {
            return await invoke<boolean>("get_accessibility_permission_status");
          } catch {
            return "unsupported" as const;
          }
        })(),
        (async () => {
          try {
            return await invoke<boolean>("get_start_at_login_status");
          } catch {
            return "unsupported" as const;
          }
        })(),
      ]);

    return {
      notificationPermission: nextNotificationPermission,
      accessibilityTrusted: nextAccessibilityTrusted,
      startAtLoginEnabled: nextStartAtLoginEnabled,
    };
  }, []);

  const applyPermissionSnapshot = useCallback(
    (snapshot: PermissionSnapshot) => {
      setNotificationPermission(snapshot.notificationPermission);
      setAccessibilityTrusted(snapshot.accessibilityTrusted);
      setStartAtLoginEnabled(snapshot.startAtLoginEnabled);

      if (snapshot.notificationPermission !== "granted") {
        unconfirmStep("notifications");
      }
      if (snapshot.accessibilityTrusted !== true) {
        unconfirmStep("accessibility");
      }
      if (snapshot.startAtLoginEnabled !== true) {
        unconfirmStep("startAtLogin");
      }
    },
    [unconfirmStep],
  );

  const refreshPermissionSnapshot = useCallback(async () => {
    const snapshot = await readPermissionSnapshot();
    applyPermissionSnapshot(snapshot);
    return snapshot;
  }, [applyPermissionSnapshot, readPermissionSnapshot]);

  useEffect(() => {
    void refreshPermissionSnapshot();
  }, [refreshPermissionSnapshot]);

  useEffect(() => {
    const handleFocus = () => {
      void refreshPermissionSnapshot();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPermissionSnapshot();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPermissionSnapshot]);

  const getStepStatus = useCallback(
    (id: AutoTrackerOnboardingStepId): StepStatus => {
      if (id === "notifications" && notificationPermission === "granted") {
        return "verified";
      }
      if (id === "accessibility" && accessibilityTrusted === true) {
        return "verified";
      }
      if (id === "startAtLogin" && startAtLoginEnabled === true) {
        return "verified";
      }
      if (state.confirmedSteps.includes(id)) {
        return "manual";
      }
      return "needsSetup";
    },
    [accessibilityTrusted, notificationPermission, startAtLoginEnabled, state.confirmedSteps],
  );

  const activeStep = useMemo(
    () => STEPS.find((step) => step.id === activeStepId) ?? STEPS[0],
    [activeStepId],
  );

  const completionState = useMemo(() => {
    const nextConfirmedSteps = STEPS.filter((step) => getStepStatus(step.id) !== "needsSetup").map(
      (step) => step.id,
    );
    return {
      ...state,
      confirmedSteps: nextConfirmedSteps,
    };
  }, [getStepStatus, state]);

  const requiredComplete = hasCompletedRequiredSteps(completionState);
  const requiredRemaining = REQUIRED_ONBOARDING_STEPS.filter(
    (id) => getStepStatus(id) === "needsSetup",
  ).length;
  const activeStepStatus = getStepStatus(activeStep.id);
  const activeStepVerified = activeStepStatus === "verified";
  const activeStepManual = activeStepStatus === "manual";

  const handleRequestPermission = useCallback(async () => {
    if (!activeStep.requestMode) {
      return;
    }

    setSettingsError(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      if (activeStep.requestMode === "notifications") {
        await requestNotificationPermission();
        const snapshot = await refreshPermissionSnapshot();
        setStatusMessage(
          snapshot.notificationPermission === "granted"
            ? "Notifications are enabled."
            : "macOS did not grant notifications from the prompt. Open Settings to finish this manually.",
        );
        return;
      }

      if (activeStep.requestMode === "accessibility") {
        await invoke<boolean>("request_accessibility_permission");
        const snapshot = await refreshPermissionSnapshot();
        setStatusMessage(
          snapshot.accessibilityTrusted === true
            ? "Accessibility access is enabled."
            : "If macOS opened System Settings, enable TimeFolio there and then click Check Again.",
        );
        return;
      }

      if (activeStep.requestMode === "startAtLogin") {
        await invoke<boolean>("enable_start_at_login");
        const snapshot = await refreshPermissionSnapshot();
        setStatusMessage(
          snapshot.startAtLoginEnabled === true
            ? "Start at Login is enabled for TimeFolio."
            : "macOS did not report Start at Login as enabled yet. Open Settings and click Check Again after approving it.",
        );
      }
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to request this permission from here.",
      );
    } finally {
      setIsBusy(false);
    }
  }, [activeStep.requestMode, refreshPermissionSnapshot]);

  const handleOpenSettings = useCallback(async () => {
    setSettingsError(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      await invoke(activeStep.openSettingsCommand);
      if (activeStep.id === "fullDisk") {
        setStatusMessage("System Settings is open. Enable TimeFolio there, then return and click I Enabled This.");
      } else {
        setStatusMessage("System Settings is open. Return here and click Check Again after making the change.");
      }
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to open System Settings from here.",
      );
    } finally {
      setIsBusy(false);
    }
  }, [activeStep.id, activeStep.openSettingsCommand]);

  const handleCheckAgain = useCallback(async () => {
    setSettingsError(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      const snapshot = await refreshPermissionSnapshot();
      const verified =
        activeStep.id === "notifications"
          ? snapshot.notificationPermission === "granted"
          : activeStep.id === "accessibility"
            ? snapshot.accessibilityTrusted === true
            : activeStep.id === "startAtLogin"
              ? snapshot.startAtLoginEnabled === true
              : false;

      setStatusMessage(
        verified
          ? `${activeStep.title} is enabled.`
          : `${activeStep.title} still needs setup.`,
      );
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to check the current permission status.",
      );
    } finally {
      setIsBusy(false);
    }
  }, [activeStep.id, activeStep.title, refreshPermissionSnapshot]);

  const handleManualConfirmation = useCallback(() => {
    setSettingsError(null);
    setStatusMessage(null);
    confirmStep(activeStep.id);
    setStatusMessage("Marked enabled by you.");
  }, [activeStep.id, confirmStep]);

  const handleFinish = useCallback(() => {
    if (!requiredComplete) return;
    const next: AutoTrackerOnboardingState = {
      ...completionState,
      completed: true,
      completedAt: new Date().toISOString(),
      deferredAt: null,
    };
    saveAutoTrackerOnboardingState(next);
    setState(next);
    onComplete();
  }, [completionState, onComplete, requiredComplete]);

  const handleSkip = useCallback(() => {
    const next: AutoTrackerOnboardingState = {
      ...state,
      completed: false,
      deferredAt: new Date().toISOString(),
    };
    saveAutoTrackerOnboardingState(next);
    setState(next);
    onSkip();
  }, [onSkip, state]);

  const showOpenSettingsAction = true;
  const showCheckAgainAction =
    activeStep.id === "notifications" ||
    activeStep.id === "accessibility" ||
    activeStep.id === "startAtLogin";
  const showManualConfirmationAction = activeStep.supportsManualConfirmation;

  return (
    <div className="autotracker-onboarding fixed inset-0 z-[10000] flex bg-[#080b15] text-[#f8fafc]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,92,255,0.2),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(89,240,222,0.12),transparent_34%)]" />

      <div className="relative grid h-full w-full grid-cols-[320px_minmax(0,1fr)] overflow-hidden border border-white/10 bg-[#0d1220] shadow-[0_40px_110px_rgba(0,0,0,0.48)]">
        <aside className="flex min-h-0 flex-col gap-5 border-r border-white/10 bg-[#080c17]/95 p-6">
          <div className="flex flex-col gap-3">
            <img
              src="/TimeFolioLogo.png"
              alt="TimeFolio"
              className="h-12 w-12 rounded-[14px] bg-white object-contain shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
            />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff8ec]">
                Auto-Tracker setup
              </p>
              <h1 className="mt-2 text-[24px] font-semibold leading-tight text-white">
                Finish TimeFolio setup
              </h1>
              <p className="mt-2 text-[13px] leading-5 text-[#a7b3c7]">
                Complete the required permissions now, or return later from Settings.
              </p>
            </div>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 scrollbar-subtle">
            {STEPS.map((step) => {
              const stepStatus = getStepStatus(step.id);
              const isActive = step.id === activeStepId;
              const isDone = stepStatus !== "needsSetup";
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    setActiveStepId(step.id);
                    setSettingsError(null);
                    setStatusMessage(null);
                  }}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-[16px] border px-3 py-3 text-left transition",
                    isActive
                      ? "border-[#8b6cff]/45 bg-[#171d33]"
                      : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.05]",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isDone
                        ? "bg-[#22d3a6] text-[#04110e]"
                        : isActive
                          ? "bg-[#7c5cff] text-white"
                          : "bg-white/[0.08] text-[#cbd5e1]",
                    )}
                  >
                    {isDone ? (
                      <Check className="h-4 w-4" strokeWidth={3} />
                    ) : (
                      stepIcon(step, "h-4 w-4")
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#f8fafc]">
                      {step.title}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                          step.kind === "required"
                            ? "bg-[#8b6cff]/18 text-[#c7b8ff]"
                            : "bg-white/[0.08] text-[#bac4d2]",
                        )}
                      >
                        {step.kind}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                          stepStatus === "verified"
                            ? "bg-[#22d3a6]/16 text-[#75f0cc]"
                            : stepStatus === "manual"
                              ? "bg-[#7dd3fc]/16 text-[#c6f1ff]"
                              : step.kind === "optional"
                                ? "bg-white/[0.08] text-[#bac4d2]"
                                : "bg-[#f59e0b]/12 text-[#f8d48a]",
                        )}
                      >
                        {getStepStatusCopy(stepStatus, step)}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#64748b]" />
                </button>
              );
            })}
          </nav>

          <div className="space-y-3 border-t border-white/10 pt-4">
            <div className="flex items-start gap-2 text-[11.5px] leading-5 text-[#9aa6bb]">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8ff8ec]" />
              <span>Tracking data stays local by default. These permissions only affect this Mac.</span>
            </div>
            <p className="text-[11.5px] leading-5 text-[#8d99ad]">
              If macOS shows duplicate TimeFolio entries, enable the TimeFolio app you just opened from /Applications. Old copies in Downloads can leave stale entries until removed.
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-[#101524]/95">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-10 py-6">
            <div className="relative flex h-28 w-full max-w-[560px] items-center justify-center">
              <div className="absolute inset-x-12 inset-y-4 rounded-full bg-[#6d5dfc]/10 blur-2xl" />
              <div className="absolute h-24 w-24 rounded-full border border-white/10" />
              <div className="absolute h-36 w-36 rounded-full border border-white/[0.05]" />
              <div className="relative flex h-[84px] w-[84px] items-center justify-center rounded-[24px] bg-[linear-gradient(160deg,#8b6cff_0%,#6c4cf0_62%,#4f33c2_100%)] shadow-[0_24px_50px_rgba(76,46,200,0.45),inset_0_1px_0_rgba(255,255,255,0.25)]">
                {stepIcon(activeStep, "h-10 w-10 text-white")}
                {activeStepStatus !== "needsSetup" ? (
                  <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#22d3a6] text-[#04110e] shadow-[0_8px_18px_rgba(16,185,129,0.45)]">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-3 max-w-[620px] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff8ec]">
                {activeStep.kind === "required" ? "Required" : "Optional"}
              </p>
              <h2 className="mt-2 text-[28px] font-semibold leading-tight text-white">
                {activeStep.title}
              </h2>
              <p className="mx-auto mt-3 max-w-[520px] text-[14px] leading-6 text-[#b3bed0]">
                {activeStep.body}
              </p>
            </div>

            <div className="mt-5 grid w-full max-w-[680px] gap-3">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.045] px-5 py-4">
                <ol className="space-y-3">
                  {activeStep.instructions.map((instruction, index) => (
                    <li key={instruction} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#8b6cff]/18 text-[11px] font-semibold text-[#d5ccff]">
                        {index + 1}
                      </span>
                      <span className="text-[13px] leading-5 text-[#d8e0eb]">{instruction}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-[16px] border border-[#8ff8ec]/15 bg-[#8ff8ec]/[0.07] px-4 py-3">
                <p className="text-[12px] font-semibold text-[#dffef9]">
                  Enable TimeFolio in macOS Settings.
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[#b7e7df]">
                  {activeStep.help}
                </p>
                <details className="mt-3 rounded-[12px] border border-white/10 bg-black/10 px-3 py-2 text-left">
                  <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-[#dffef9]">
                    Need help finding the right entry?
                  </summary>
                  <div className="mt-2 space-y-2 text-[12px] leading-5 text-[#cfe6e2]">
                    <p>
                      Choose the TimeFolio app you just opened from /Applications. Older app copies can leave duplicate entries in Settings until they are removed.
                    </p>
                    <p className="text-[#9ed8cf]">
                      Technical identifier: <span className="font-mono text-[11px]">{LEGACY_BUNDLE_ID}</span>
                    </p>
                  </div>
                </details>
              </div>

              <div className="rounded-[16px] border border-white/10 bg-[#070b14]/55 px-4 py-3">
                <p className="text-[12px] font-semibold text-[#f8fafc]">Status</p>
                <p className="mt-1 text-[12px] leading-5 text-[#aeb9ca]">
                  {getVerificationCopy(activeStepStatus, activeStep)}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-[#8fa0b8]">
                  {activeStepVerified
                    ? "TimeFolio checked the current macOS state for this step."
                    : activeStepManual
                      ? "This step is counted because you confirmed it manually."
                      : activeStep.supportsManualConfirmation
                        ? "TimeFolio cannot verify this permission directly, so this step finishes only after you confirm it."
                        : "Use Request Access, Open Settings, or Check Again to finish this step."}
                </p>
              </div>

              {statusMessage ? (
                <p className="text-[12px] leading-5 text-[#75f0cc]">{statusMessage}</p>
              ) : null}

              {settingsError ? (
                <p className="text-[12px] leading-5 text-[#fca5a5]">{settingsError}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-white/10 bg-[#0b1020]/92 px-8 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={handleSkip}
                className="inline-flex h-11 items-center justify-center rounded-[14px] px-3 text-[13px] font-semibold text-[#cbd5e1] transition hover:text-white"
              >
                Set Up Later
              </button>
              <div className="text-[12px] leading-5 text-[#a2aec2]">
                {requiredRemaining === 0
                  ? "All required steps are complete."
                  : `${requiredRemaining} required step${requiredRemaining === 1 ? "" : "s"} remaining`}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {showCheckAgainAction ? (
                <button
                  type="button"
                  onClick={() => void handleCheckAgain()}
                  disabled={isBusy}
                  className="inline-flex h-11 min-w-[124px] items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.04] px-4 text-[13px] font-semibold text-[#d8e0eb] transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Checking..." : "Check Again"}
                </button>
              ) : null}

              {showOpenSettingsAction ? (
                <button
                  type="button"
                  onClick={() => void handleOpenSettings()}
                  disabled={isBusy}
                  className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-[14px] border border-[#8ff8ec]/20 bg-[#102538] px-4 text-[13px] font-semibold text-[#e6fffb] transition hover:bg-[#15324a] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Opening..." : "Open Settings"}
                </button>
              ) : null}

              {showManualConfirmationAction ? (
                <button
                  type="button"
                  onClick={handleManualConfirmation}
                  className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.04] px-4 text-[13px] font-semibold text-[#d8e0eb] transition hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                >
                  I Enabled This
                </button>
              ) : null}

              {activeStep.requestMode ? (
                <button
                  type="button"
                  onClick={() => void handleRequestPermission()}
                  disabled={isBusy}
                  className="inline-flex h-11 min-w-[168px] items-center justify-center rounded-[14px] bg-[#7c5cff] px-4 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(108,76,240,0.45)] transition hover:bg-[#8b6cff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Working..." : activeStep.requestButtonLabel}
                </button>
              ) : null}

              <button
                type="button"
                onClick={handleFinish}
                disabled={!requiredComplete}
                className="inline-flex h-11 min-w-[108px] items-center justify-center rounded-[14px] bg-[#22d3a6] px-5 text-[13px] font-semibold text-[#04110e] transition hover:bg-[#36e0b5] disabled:cursor-not-allowed disabled:bg-[#244055] disabled:text-[#8190a6]"
              >
                Done
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
