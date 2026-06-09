export type PomodoroPhase = "focus" | "shortBreak" | "longBreak";
export type PomodoroPresetId = "classic" | "deepWork" | "fiftyTwoSeventeen" | "sprint" | "custom";

export interface PomodoroConfig {
  name: string;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  roundsBeforeLongBreak: number;
  longBreakEnabled: boolean;
}

export const POMODORO_PRESETS: Record<Exclude<PomodoroPresetId, "custom">, PomodoroConfig> = {
  classic: {
    name: "Classic",
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
    longBreakEnabled: true,
  },
  deepWork: {
    name: "Deep Work",
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 20,
    roundsBeforeLongBreak: 3,
    longBreakEnabled: true,
  },
  fiftyTwoSeventeen: {
    name: "52/17",
    focusMinutes: 52,
    shortBreakMinutes: 17,
    longBreakMinutes: 17,
    roundsBeforeLongBreak: 4,
    longBreakEnabled: false,
  },
  sprint: {
    name: "Sprint",
    focusMinutes: 20,
    shortBreakMinutes: 3,
    longBreakMinutes: 10,
    roundsBeforeLongBreak: 4,
    longBreakEnabled: false,
  },
};

export const DEFAULT_POMODORO_PRESET_ID: PomodoroPresetId = "deepWork";
export const DEFAULT_CUSTOM_POMODORO_CONFIG: PomodoroConfig = {
  ...POMODORO_PRESETS.deepWork,
  name: "Custom routine",
};

export function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

export function validatePomodoroConfig(config: PomodoroConfig) {
  if (!config.name.trim()) {
    return "Routine name is required.";
  }

  if (!Number.isInteger(config.focusMinutes) || config.focusMinutes < 1 || config.focusMinutes > 180) {
    return "Focus duration must be 1-180 minutes.";
  }

  if (!Number.isInteger(config.shortBreakMinutes) || config.shortBreakMinutes < 1 || config.shortBreakMinutes > 60) {
    return "Short break must be 1-60 minutes.";
  }

  if (!Number.isInteger(config.longBreakMinutes) || config.longBreakMinutes < 1 || config.longBreakMinutes > 90) {
    return "Long break must be 1-90 minutes.";
  }

  if (
    !Number.isInteger(config.roundsBeforeLongBreak) ||
    config.roundsBeforeLongBreak < 1 ||
    config.roundsBeforeLongBreak > 12
  ) {
    return "Rounds before long break must be 1-12.";
  }

  return null;
}

export function getPomodoroPhaseDurationMs(phase: PomodoroPhase, config: PomodoroConfig) {
  const minutes =
    phase === "focus"
      ? config.focusMinutes
      : phase === "longBreak"
        ? config.longBreakMinutes
        : config.shortBreakMinutes;

  return minutes * 60 * 1000;
}

export function advancePomodoroPhase(
  phase: PomodoroPhase,
  roundIndex: number,
  config: PomodoroConfig,
): { phase: PomodoroPhase; roundIndex: number } {
  if (phase === "focus") {
    const shouldTakeLongBreak = config.longBreakEnabled && roundIndex >= config.roundsBeforeLongBreak;
    return { phase: shouldTakeLongBreak ? "longBreak" : "shortBreak", roundIndex };
  }

  if (phase === "longBreak") {
    return { phase: "focus", roundIndex: 1 };
  }

  return { phase: "focus", roundIndex: roundIndex + 1 };
}

export function getNextPomodoroPhaseLabel(phase: PomodoroPhase, roundIndex: number, config: PomodoroConfig) {
  const next = advancePomodoroPhase(phase, roundIndex, config);
  return getPomodoroPhaseLabel(next.phase);
}

export function getPomodoroPhaseLabel(phase: PomodoroPhase) {
  if (phase === "focus") return "Focus";
  if (phase === "longBreak") return "Long Break";
  return "Short Break";
}

export function getPomodoroAlertCopy(completedPhase: PomodoroPhase) {
  if (completedPhase === "focus") {
    return {
      title: "Focus complete",
      body: "Start your break.",
    };
  }

  if (completedPhase === "longBreak") {
    return {
      title: "Long break complete",
      body: "Start your next focus round.",
    };
  }

  return {
    title: "Break complete",
    body: "Time to study.",
  };
}

export function formatPomodoroTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
