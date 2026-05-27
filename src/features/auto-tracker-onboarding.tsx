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
  ShieldCheck,
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

const APP_DISPLAY_NAME = "TimeFolio";
const APP_INSTALL_NAME = "TimeFolio Study Tracker";
const APP_BUNDLE_ID = "com.paul.step2ckcommandcenter";

type StepKind = "required" | "optional";

interface OnboardingStep {
  id: AutoTrackerOnboardingStepId;
  kind: StepKind;
  title: string;
  body: string;
  instructions: string[];
  help: string;
  icon: (props: { className?: string }) => JSX.Element;
  openSettingsCommand: string;
  openButtonLabel: string;
  requestButtonLabel?: string;
  canVerify: boolean;
}

const STEPS: OnboardingStep[] = [
  {
    id: "notifications",
    kind: "required",
    title: "Enable Notifications",
    body: "TimeFolio uses notifications for timer updates, reminders, and setup alerts.",
    instructions: [
      "Click Request Notification Permission.",
      "Choose Allow in the macOS prompt.",
      "If the prompt does not appear, open Notification Settings and enable the installed app.",
    ],
    help: `Enable ${APP_INSTALL_NAME} in /Applications. macOS may list it as ${APP_DISPLAY_NAME}.`,
    icon: (props) => <Bell {...props} />,
    openSettingsCommand: "open_notification_settings",
    openButtonLabel: "Open Notification Settings",
    requestButtonLabel: "Request Notification Permission",
    canVerify: true,
  },
  {
    id: "accessibility",
    kind: "required",
    title: "Grant Accessibility Access",
    body: "Accessibility lets TimeFolio identify the active app so study time can be tracked automatically.",
    instructions: [
      "Click Request Accessibility Access.",
      `Enable ${APP_INSTALL_NAME} in /Applications if macOS opens System Settings.`,
      "Return here and click I enabled this if macOS does not report the change immediately.",
    ],
    help: `App identity: ${APP_DISPLAY_NAME} (${APP_BUNDLE_ID}). Duplicate entries can appear after reinstalling.`,
    icon: (props) => <Accessibility {...props} />,
    openSettingsCommand: "open_accessibility_settings",
    openButtonLabel: "Open Accessibility Settings",
    requestButtonLabel: "Request Accessibility Access",
    canVerify: true,
  },
  {
    id: "fullDisk",
    kind: "required",
    title: "Allow Full Disk Access",
    body: "Full Disk Access helps TimeFolio read app activity consistently across macOS privacy boundaries.",
    instructions: [
      "Open Full Disk Access.",
      `Enable ${APP_INSTALL_NAME} in /Applications.`,
      "Restart TimeFolio if macOS asks or tracking still looks incomplete.",
    ],
    help: "TimeFolio cannot reliably verify Full Disk Access from this setup screen, so confirm it here after enabling it.",
    icon: (props) => <HardDrive {...props} />,
    openSettingsCommand: "open_full_disk_access_settings",
    openButtonLabel: "Open Full Disk Access",
    canVerify: false,
  },
  {
    id: "background",
    kind: "required",
    title: "Allow Background Access",
    body: "Background access lets Auto-Tracker keep working while TimeFolio is not the frontmost window.",
    instructions: [
      "Open Login Items & Extensions.",
      `Find ${APP_INSTALL_NAME} or ${APP_DISPLAY_NAME}.`,
      "Allow it to run in the background, then confirm here.",
    ],
    help: "macOS does not expose a reliable current-app background access check to this app yet.",
    icon: (props) => <ShieldCheck {...props} />,
    openSettingsCommand: "open_login_items_settings",
    openButtonLabel: "Open Login Items & Extensions",
    canVerify: false,
  },
  {
    id: "startAtLogin",
    kind: "optional",
    title: "Start at Login",
    body: "Optional, but recommended if you want Auto-Tracker ready every time you start your Mac.",
    instructions: [
      "Open Login Items & Extensions.",
      `Add ${APP_INSTALL_NAME} under Open at Login.`,
      "Confirm here if you enabled it.",
    ],
    help: "This is optional and does not block Done.",
    icon: (props) => <Power {...props} />,
    openSettingsCommand: "open_login_items_settings",
    openButtonLabel: "Open Login Items & Extensions",
    canVerify: false,
  },
];

function stepIcon(step: OnboardingStep, className: string) {
  return step.icon({ className });
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const permission = await getNotificationPermissionStatus();
      if (cancelled) return;
      setNotificationPermission(permission);
      if (permission === "granted") {
        confirmStep("notifications");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmStep]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const trusted = await invoke<boolean>("get_accessibility_permission_status");
        if (cancelled) return;
        setAccessibilityTrusted(trusted);
        if (trusted) {
          confirmStep("accessibility");
        }
      } catch {
        if (!cancelled) {
          setAccessibilityTrusted("unsupported");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [confirmStep]);

  const activeStep = useMemo(
    () => STEPS.find((step) => step.id === activeStepId) ?? STEPS[0],
    [activeStepId],
  );

  const requiredComplete = hasCompletedRequiredSteps(state);
  const activeConfirmed = state.confirmedSteps.includes(activeStep.id);
  const requiredRemaining = REQUIRED_ONBOARDING_STEPS.filter(
    (id) => !state.confirmedSteps.includes(id),
  ).length;

  const handleRequestPermission = useCallback(async () => {
    setSettingsError(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      if (activeStep.id === "notifications") {
        const permission = await requestNotificationPermission();
        setNotificationPermission(permission);
        if (permission === "granted") {
          confirmStep("notifications");
          setStatusMessage("Notifications are enabled on this Mac.");
        } else {
          setStatusMessage("macOS did not grant notifications from the prompt. Open settings to enable them manually.");
        }
        return;
      }

      if (activeStep.id === "accessibility") {
        const trusted = await invoke<boolean>("request_accessibility_permission");
        setAccessibilityTrusted(trusted);
        if (trusted) {
          confirmStep("accessibility");
          setStatusMessage("Accessibility access is enabled on this Mac.");
        } else {
          setStatusMessage("If the native prompt did not appear, open Accessibility Settings and enable the installed app.");
        }
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
  }, [activeStep.id, confirmStep]);

  const handleOpenSettings = useCallback(async () => {
    setSettingsError(null);
    setStatusMessage(null);
    setIsBusy(true);
    try {
      await invoke(activeStep.openSettingsCommand);
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to open System Settings from here.",
      );
    } finally {
      setIsBusy(false);
    }
  }, [activeStep.openSettingsCommand]);

  const handleFinish = useCallback(() => {
    if (!requiredComplete) return;
    const next: AutoTrackerOnboardingState = {
      ...state,
      completed: true,
      completedAt: new Date().toISOString(),
      deferredAt: null,
    };
    saveAutoTrackerOnboardingState(next);
    setState(next);
    onComplete();
  }, [onComplete, requiredComplete, state]);

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

  const directRequestAvailable = activeStep.id === "notifications" || activeStep.id === "accessibility";
  const verifiedStatus =
    activeStep.id === "notifications"
      ? notificationPermission === "granted"
      : activeStep.id === "accessibility"
        ? accessibilityTrusted === true
        : false;

  return (
    <div className="autotracker-onboarding fixed inset-0 z-[10000] flex bg-[#080b15] text-[#f8fafc]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,92,255,0.20),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(89,240,222,0.12),transparent_34%)]" />

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
              <h1 className="mt-2 text-[24px] font-semibold leading-tight text-[#ffffff]">
                TimeFolio privacy permissions
              </h1>
              <p className="mt-2 text-[13px] leading-5 text-[#a7b3c7]">
                Finish the required steps now, or set this up later from Settings.
              </p>
            </div>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 scrollbar-subtle">
            {STEPS.map((step) => {
              const isActive = step.id === activeStepId;
              const isDone = state.confirmedSteps.includes(step.id);
              const statusLabel = isDone
                ? "Enabled"
                : step.kind === "required"
                  ? "Needs setup"
                  : "Optional";
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    setActiveStepId(step.id);
                    setSettingsError(null);
                    setStatusMessage(null);
                  }}
                  className={[
                    "group flex w-full items-center gap-3 rounded-[16px] border px-3 py-3 text-left transition",
                    isActive
                      ? "border-[#8b6cff]/45 bg-[#171d33]"
                      : "border-transparent bg-transparent hover:border-white/10 hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      isDone
                        ? "bg-[#22d3a6] text-[#04110e]"
                        : isActive
                          ? "bg-[#7c5cff] text-white"
                          : "bg-white/[0.08] text-[#cbd5e1]",
                    ].join(" ")}
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
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                          step.kind === "required"
                            ? "bg-[#8b6cff]/18 text-[#c7b8ff]"
                            : "bg-white/[0.08] text-[#bac4d2]",
                        ].join(" ")}
                      >
                        {step.kind}
                      </span>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                          isDone
                            ? "bg-[#22d3a6]/16 text-[#75f0cc]"
                            : "bg-[#f59e0b]/12 text-[#f8d48a]",
                        ].join(" ")}
                      >
                        {statusLabel}
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
              If macOS shows duplicate TimeFolio entries, enable the installed app you just opened in /Applications. Old app copies can be removed later from Applications or Downloads.
            </p>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-[#101524]/95">
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-10 py-8 scrollbar-subtle">
            <div className="relative flex h-36 w-full max-w-[560px] items-center justify-center">
              <div className="absolute inset-x-8 inset-y-4 rounded-full bg-[#6d5dfc]/10 blur-2xl" />
              <div className="absolute h-28 w-28 rounded-full border border-white/10" />
              <div className="absolute h-40 w-40 rounded-full border border-white/[0.05]" />
              <div className="relative flex h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-[linear-gradient(160deg,#8b6cff_0%,#6c4cf0_62%,#4f33c2_100%)] shadow-[0_24px_50px_rgba(76,46,200,0.45),inset_0_1px_0_rgba(255,255,255,0.25)]">
                {stepIcon(activeStep, "h-11 w-11 text-white")}
                {activeConfirmed ? (
                  <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#22d3a6] text-[#04110e] shadow-[0_8px_18px_rgba(16,185,129,0.45)]">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 max-w-[600px] text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8ff8ec]">
                {activeStep.kind === "required" ? "Required" : "Optional"}
              </p>
              <h2 className="mt-2 text-[28px] font-semibold leading-tight text-[#ffffff]">
                {activeStep.title}
              </h2>
              <p className="mx-auto mt-3 max-w-[500px] text-[14px] leading-6 text-[#b3bed0]">
                {activeStep.body}
              </p>
            </div>

            <div className="mt-6 grid w-full max-w-[640px] gap-4">
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
                  Enable {APP_INSTALL_NAME} in /Applications.
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[#b7e7df]">
                  {activeStep.help}
                </p>
              </div>

              {activeStep.canVerify ? (
                <div className="rounded-[16px] border border-white/10 bg-[#070b14]/55 px-4 py-3">
                  <p className="text-[12px] font-semibold text-[#f8fafc]">
                    Verification
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-[#aeb9ca]">
                    {verifiedStatus
                      ? "TimeFolio verified this permission as enabled."
                      : "TimeFolio has not verified this permission yet. You can request it, open settings, or explicitly confirm after enabling it."}
                  </p>
                </div>
              ) : null}

              {statusMessage ? (
                <p className="text-[12px] leading-5 text-[#75f0cc]">{statusMessage}</p>
              ) : null}

              {settingsError ? (
                <p className="text-[12px] leading-5 text-[#fca5a5]">{settingsError}</p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 bg-[#0b1020]/92 px-8 py-5">
            <div className="text-[12px] leading-5 text-[#a2aec2]">
              {requiredRemaining === 0
                ? "All required steps are complete."
                : `${requiredRemaining} required step${requiredRemaining === 1 ? "" : "s"} remaining`}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleSkip}
                className="rounded-[14px] border border-white/10 px-4 py-2.5 text-[13px] font-semibold text-[#cbd5e1] transition hover:border-white/20 hover:text-white"
              >
                Set up later
              </button>
              {activeConfirmed ? (
                <button
                  type="button"
                  onClick={() => unconfirmStep(activeStep.id)}
                  className="rounded-[14px] border border-white/10 px-4 py-2.5 text-[13px] font-semibold text-[#cbd5e1] transition hover:border-white/20 hover:text-white"
                >
                  Mark not enabled
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => confirmStep(activeStep.id)}
                  className="rounded-[14px] border border-white/10 px-4 py-2.5 text-[13px] font-semibold text-[#cbd5e1] transition hover:border-white/20 hover:text-white"
                >
                  I enabled this
                </button>
              )}
              {directRequestAvailable ? (
                <button
                  type="button"
                  onClick={() => void handleRequestPermission()}
                  disabled={isBusy}
                  className="rounded-[14px] bg-[#7c5cff] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(108,76,240,0.45)] transition hover:bg-[#8b6cff] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBusy ? "Requesting..." : activeStep.requestButtonLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleOpenSettings()}
                disabled={isBusy}
                className="rounded-[14px] border border-[#8ff8ec]/20 bg-[#102538] px-4 py-2.5 text-[13px] font-semibold text-[#e6fffb] transition hover:bg-[#15324a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBusy ? "Opening..." : activeStep.openButtonLabel}
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={!requiredComplete}
                className="rounded-[14px] bg-[#22d3a6] px-5 py-2.5 text-[13px] font-semibold text-[#04110e] transition hover:bg-[#36e0b5] disabled:cursor-not-allowed disabled:bg-[#244055] disabled:text-[#8190a6]"
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
