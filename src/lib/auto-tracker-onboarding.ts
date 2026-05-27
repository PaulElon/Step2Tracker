export type AutoTrackerOnboardingStepId =
  | "notifications"
  | "accessibility"
  | "fullDisk"
  | "background"
  | "startAtLogin";

export interface AutoTrackerOnboardingState {
  completed: boolean;
  confirmedSteps: AutoTrackerOnboardingStepId[];
  completedAt: string | null;
  deferredAt: string | null;
}

const STORAGE_KEY = "tf:autotracker-onboarding:v1";

const EMPTY: AutoTrackerOnboardingState = {
  completed: false,
  confirmedSteps: [],
  completedAt: null,
  deferredAt: null,
};

export const REQUIRED_ONBOARDING_STEPS: AutoTrackerOnboardingStepId[] = [
  "notifications",
  "accessibility",
  "fullDisk",
  "background",
];

export const OPTIONAL_ONBOARDING_STEPS: AutoTrackerOnboardingStepId[] = ["startAtLogin"];

export function loadAutoTrackerOnboardingState(): AutoTrackerOnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<AutoTrackerOnboardingState>;
    const confirmedSteps: AutoTrackerOnboardingStepId[] = Array.isArray(parsed.confirmedSteps)
      ? parsed.confirmedSteps.filter(
          (id): id is AutoTrackerOnboardingStepId =>
            id === "notifications" ||
            id === "accessibility" ||
            id === "fullDisk" ||
            id === "background" ||
            id === "startAtLogin",
        )
      : [];
    return {
      completed: Boolean(parsed.completed),
      confirmedSteps,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
      deferredAt: typeof parsed.deferredAt === "string" ? parsed.deferredAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveAutoTrackerOnboardingState(state: AutoTrackerOnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable
  }
}

export function resetAutoTrackerOnboardingState(): AutoTrackerOnboardingState {
  const state = { ...EMPTY };
  saveAutoTrackerOnboardingState(state);
  return state;
}

export function hasCompletedRequiredSteps(state: AutoTrackerOnboardingState): boolean {
  return REQUIRED_ONBOARDING_STEPS.every((id) => state.confirmedSteps.includes(id));
}

export function shouldShowAutoTrackerOnboardingAtLaunch(state: AutoTrackerOnboardingState): boolean {
  return !state.completed && state.deferredAt === null;
}
