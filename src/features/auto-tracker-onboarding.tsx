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

type StepKind = "required" | "optional";

interface OnboardingStep {
  id: AutoTrackerOnboardingStepId;
  kind: StepKind;
  title: string;
  body: string;
  instructions: string[];
  icon: (props: { className?: string }) => JSX.Element;
  openSettingsCommand: string;
  openButtonLabel: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: "notifications",
    kind: "required",
    title: "Enable Notifications",
    body: "TimeFolio uses notifications for timer updates, reminders, and setup alerts.",
    instructions: [
      "Click “Open Notification Settings”",
      "Select TimeFolio",
      "Turn on Allow Notifications",
    ],
    icon: (props) => <Bell {...props} />,
    openSettingsCommand: "open_notification_settings",
    openButtonLabel: "Open Notification Settings",
  },
  {
    id: "accessibility",
    kind: "required",
    title: "Grant Accessibility Access",
    body: "Accessibility lets TimeFolio identify the active app so study time can be tracked automatically.",
    instructions: [
      "Click “Open Accessibility Settings”",
      "Enable TimeFolio",
      "Restart TimeFolio if macOS asks",
    ],
    icon: (props) => <Accessibility {...props} />,
    openSettingsCommand: "open_accessibility_settings",
    openButtonLabel: "Open Accessibility Settings",
  },
  {
    id: "fullDisk",
    kind: "required",
    title: "Allow Full Disk Access",
    body: "Full Disk Access helps TimeFolio read app activity consistently across macOS privacy boundaries.",
    instructions: [
      "Click “Open Full Disk Access”",
      "Enable TimeFolio",
      "Restart TimeFolio if prompted",
    ],
    icon: (props) => <HardDrive {...props} />,
    openSettingsCommand: "open_full_disk_access_settings",
    openButtonLabel: "Open Full Disk Access",
  },
  {
    id: "background",
    kind: "required",
    title: "Allow Background Access",
    body: "Background access lets Auto-Tracker keep working while TimeFolio is not the frontmost window.",
    instructions: [
      "Open Login Items & Extensions",
      "Find TimeFolio",
      "Allow it to run in the background",
    ],
    icon: (props) => <ShieldCheck {...props} />,
    openSettingsCommand: "open_login_items_settings",
    openButtonLabel: "Open Login Items & Extensions",
  },
  {
    id: "startAtLogin",
    kind: "optional",
    title: "Start at Login",
    body: "Optional, but recommended if you want Auto-Tracker ready every time you start your Mac.",
    instructions: [
      "Open Login Items & Extensions",
      "Add TimeFolio under “Open at Login”",
      "Confirm TimeFolio is listed",
    ],
    icon: (props) => <Power {...props} />,
    openSettingsCommand: "open_login_items_settings",
    openButtonLabel: "Open Login Items & Extensions",
  },
];

function stepIcon(step: OnboardingStep, className: string) {
  return step.icon({ className });
}

interface AutoTrackerOnboardingProps {
  onComplete: () => void;
}

export function AutoTrackerOnboarding({ onComplete }: AutoTrackerOnboardingProps): JSX.Element {
  const [state, setState] = useState<AutoTrackerOnboardingState>(() =>
    loadAutoTrackerOnboardingState(),
  );
  const [activeStepId, setActiveStepId] = useState<AutoTrackerOnboardingStepId>(STEPS[0].id);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >("unsupported");
  const [openingSettings, setOpeningSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const permission = await getNotificationPermissionStatus();
      if (cancelled) return;
      setNotificationPermission(permission);
      if (permission === "granted") {
        setState((prev) => {
          if (prev.confirmedSteps.includes("notifications")) return prev;
          const next: AutoTrackerOnboardingState = {
            ...prev,
            confirmedSteps: [...prev.confirmedSteps, "notifications"],
          };
          saveAutoTrackerOnboardingState(next);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeStep = useMemo(
    () => STEPS.find((step) => step.id === activeStepId) ?? STEPS[0],
    [activeStepId],
  );

  const requiredComplete = hasCompletedRequiredSteps(state);

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

  const handleOpenSettings = useCallback(async () => {
    setSettingsError(null);
    setOpeningSettings(true);
    try {
      if (activeStep.id === "notifications") {
        const permission = await requestNotificationPermission();
        setNotificationPermission(permission);
        if (permission === "granted") {
          confirmStep("notifications");
          return;
        }
      }
      await invoke(activeStep.openSettingsCommand);
    } catch (error) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Unable to open System Settings from here.",
      );
    } finally {
      setOpeningSettings(false);
    }
  }, [activeStep, confirmStep]);

  const handleFinish = useCallback(() => {
    if (!requiredComplete) return;
    const next: AutoTrackerOnboardingState = {
      ...state,
      completed: true,
      completedAt: new Date().toISOString(),
    };
    saveAutoTrackerOnboardingState(next);
    setState(next);
    onComplete();
  }, [onComplete, requiredComplete, state]);

  const activeIsNotifications = activeStep.id === "notifications";
  const activeConfirmed = state.confirmedSteps.includes(activeStep.id);
  const requiredRemaining = REQUIRED_ONBOARDING_STEPS.filter(
    (id) => !state.confirmedSteps.includes(id),
  ).length;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/85 backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(89,240,222,0.10),transparent_30%)]" />

      <div
        className="relative flex h-[min(720px,90vh)] w-[min(1080px,94vw)] overflow-hidden rounded-[28px] border border-white/10 shadow-[0_60px_120px_rgba(0,0,0,0.55)]"
        style={{ background: "rgba(15,18,32,0.92)" }}
      >
        <aside
          className="relative flex w-[360px] shrink-0 flex-col gap-6 border-r border-white/5 p-7"
          style={{ background: "rgba(11,13,24,0.85)" }}
        >
          <div className="flex flex-col gap-3">
            <img
              src="/TimeFolioLogo.png"
              alt="TimeFolio"
              className="h-12 w-12 rounded-[14px] bg-white object-contain shadow-[0_8px_20px_rgba(0,0,0,0.45)]"
            />
            <div>
              <h1 className="text-[22px] font-semibold leading-tight text-white">
                Welcome to TimeFolio
              </h1>
              <p className="mt-1.5 text-[13px] leading-snug text-slate-400">
                Finish these steps so Auto-Tracker can work reliably.
              </p>
            </div>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-subtle">
            {STEPS.map((step) => {
              const isActive = step.id === activeStepId;
              const isDone = state.confirmedSteps.includes(step.id);
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setActiveStepId(step.id)}
                  className={[
                    "group flex w-full items-center gap-3 rounded-[14px] border px-3 py-2.5 text-left transition",
                    isActive
                      ? "border-white/10 bg-white/[0.06]"
                      : "border-transparent hover:border-white/5 hover:bg-white/[0.03]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                      isDone
                        ? "bg-[#7c5cff] text-white"
                        : "bg-white/[0.05] text-slate-300",
                    ].join(" ")}
                  >
                    {isDone ? (
                      <Check className="h-4 w-4" strokeWidth={2.8} />
                    ) : (
                      stepIcon(step, "h-4 w-4")
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-white">
                      {step.title}
                    </span>
                    <span
                      className={[
                        "mt-0.5 block text-[11px] font-medium uppercase tracking-[0.14em]",
                        step.kind === "required"
                          ? "text-[#a48dff]"
                          : "text-slate-500",
                      ].join(" ")}
                    >
                      {isDone ? "Enabled" : step.kind === "required" ? "Required" : "Optional"}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
                </button>
              );
            })}
          </nav>

          <div className="flex items-start gap-2 border-t border-white/5 pt-4 text-[11.5px] leading-snug text-slate-500">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span>
              Your privacy is the priority. TimeFolio keeps tracking data local by default.
            </span>
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center px-12 pt-12">
            <div className="relative flex h-44 w-full items-center justify-center">
              <div
                className="absolute inset-x-12 inset-y-2 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(124,92,255,0.18) 0%, rgba(124,92,255,0) 65%)",
                }}
              />
              <div
                className="absolute h-32 w-32 rounded-full border border-white/5"
                style={{ boxShadow: "0 0 60px rgba(124,92,255,0.12) inset" }}
              />
              <div
                className="absolute h-44 w-44 rounded-full border border-white/[0.04]"
              />
              <div
                className="relative flex h-24 w-24 items-center justify-center rounded-[28px]"
                style={{
                  background:
                    "linear-gradient(160deg, #8b6cff 0%, #6c4cf0 60%, #4f33c2 100%)",
                  boxShadow:
                    "0 24px 50px rgba(76,46,200,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
                }}
              >
                {stepIcon(activeStep, "h-12 w-12 text-white")}
                {activeConfirmed ? (
                  <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400 text-slate-900 shadow-[0_8px_18px_rgba(16,185,129,0.45)]">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-8 text-center">
              <h2 className="text-[26px] font-semibold leading-tight text-white">
                {activeStep.title}
              </h2>
              <p className="mx-auto mt-3 max-w-[440px] text-[13.5px] leading-relaxed text-slate-400">
                {activeStep.body}
              </p>
            </div>

            <div
              className="mt-7 w-full max-w-[460px] rounded-[18px] border border-white/[0.06] px-5 py-4"
              style={{ background: "rgba(255,255,255,0.025)" }}
            >
              <ol className="space-y-3">
                {activeStep.instructions.map((instruction, index) => (
                  <li key={instruction} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-slate-300">
                      {index + 1}
                    </span>
                    <span className="text-[13px] text-slate-300">{instruction}</span>
                  </li>
                ))}
              </ol>
            </div>

            {activeIsNotifications && notificationPermission === "granted" ? (
              <p className="mt-4 text-[12px] text-emerald-300">
                Notifications are enabled on this Mac.
              </p>
            ) : null}

            {settingsError ? (
              <p className="mt-4 text-[12px] text-rose-300">{settingsError}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-white/5 px-12 py-6">
            <div className="text-[12px] text-slate-500">
              {requiredRemaining === 0
                ? "All required steps complete. You can finish setup."
                : `${requiredRemaining} required step${requiredRemaining === 1 ? "" : "s"} remaining`}
            </div>
            <div className="flex items-center gap-2.5">
              {activeConfirmed ? (
                <button
                  type="button"
                  onClick={() => unconfirmStep(activeStep.id)}
                  className="rounded-[14px] border border-white/10 px-4 py-2.5 text-[13px] font-medium text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  Mark as not enabled
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => confirmStep(activeStep.id)}
                  className="rounded-[14px] border border-white/10 px-4 py-2.5 text-[13px] font-medium text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  I enabled this
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleOpenSettings()}
                disabled={openingSettings}
                className="rounded-[14px] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(108,76,240,0.45)] transition disabled:opacity-60"
                style={{
                  background: "linear-gradient(135deg, #8b6cff 0%, #6c4cf0 100%)",
                }}
              >
                {openingSettings ? "Opening…" : activeStep.openButtonLabel}
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={!requiredComplete}
                className="rounded-[14px] px-5 py-2.5 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background: "linear-gradient(135deg, #59f0de 0%, #4dbcff 100%)",
                  boxShadow: requiredComplete
                    ? "0 10px 24px rgba(77,188,255,0.35)"
                    : "none",
                }}
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
