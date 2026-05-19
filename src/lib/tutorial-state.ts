import type { SectionId } from "../types/models";

// TutorialStepId is its own union — "today" and "practiceTests" have no exact
// SectionId equivalent ("dashboard" / "tests" are the closest).
export type TutorialStepId =
  | "today"
  | "planner"
  | "weakTopics"
  | "practiceTests"
  | "errorLog"
  | "timefolio"
  | "settings"
  | "notebook";

export interface TutorialStep {
  id: TutorialStepId;
  sectionId: SectionId;
  notebookOnly?: true;
}

export interface TutorialState {
  active: boolean;
  completed: boolean;
  skipped: boolean;
  currentStepId: TutorialStepId | null;
  completedStepIds: TutorialStepId[];
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: "today", sectionId: "dashboard" },
  { id: "planner", sectionId: "planner" },
  { id: "weakTopics", sectionId: "weakTopics" },
  { id: "practiceTests", sectionId: "tests" },
  { id: "errorLog", sectionId: "errorLog" },
  { id: "timefolio", sectionId: "timefolio" },
  { id: "settings", sectionId: "settings" },
  { id: "notebook", sectionId: "notebook", notebookOnly: true },
];

const STORAGE_KEY = "tf:tutorial:v1";

const EMPTY: TutorialState = {
  active: false,
  completed: false,
  skipped: false,
  currentStepId: null,
  completedStepIds: [],
};

export function loadTutorialState(): TutorialState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Partial<TutorialState>;
    return {
      active: p.active ?? false,
      completed: p.completed ?? false,
      skipped: p.skipped ?? false,
      currentStepId: p.currentStepId ?? null,
      completedStepIds: Array.isArray(p.completedStepIds) ? p.completedStepIds : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveTutorialState(state: TutorialState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable
  }
}

export function resetTutorialState(): TutorialState {
  const state = { ...EMPTY };
  saveTutorialState(state);
  return state;
}

export function startTutorial(): TutorialState {
  const first = TUTORIAL_STEPS[0];
  if (!first) return { ...EMPTY };
  const state: TutorialState = {
    active: true,
    completed: false,
    skipped: false,
    currentStepId: first.id,
    completedStepIds: [],
  };
  saveTutorialState(state);
  return state;
}

export function advanceTutorial(current: TutorialState): TutorialState {
  if (!current.active || !current.currentStepId) return current;
  const idx = TUTORIAL_STEPS.findIndex((s) => s.id === current.currentStepId);
  const next = TUTORIAL_STEPS[idx + 1];
  const completedStepIds = current.completedStepIds.includes(current.currentStepId)
    ? current.completedStepIds
    : [...current.completedStepIds, current.currentStepId];
  const state: TutorialState = next
    ? { ...current, currentStepId: next.id, completedStepIds }
    : { ...current, active: false, completed: true, completedStepIds };
  saveTutorialState(state);
  return state;
}

export function skipTutorial(current: TutorialState): TutorialState {
  const state: TutorialState = { ...current, active: false, skipped: true };
  saveTutorialState(state);
  return state;
}

export function completeTutorial(current: TutorialState): TutorialState {
  const state: TutorialState = { ...current, active: false, completed: true };
  saveTutorialState(state);
  return state;
}
