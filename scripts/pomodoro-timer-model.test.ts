import assert from "node:assert/strict";
import {
  POMODORO_PRESETS,
  advancePomodoroPhase,
  formatPomodoroTime,
  validatePomodoroConfig,
} from "../src/features/timefolio/pomodoro-timer-model.ts";

assert.equal(POMODORO_PRESETS.deepWork.focusMinutes, 50);
assert.equal(POMODORO_PRESETS.deepWork.shortBreakMinutes, 10);
assert.equal(POMODORO_PRESETS.deepWork.longBreakMinutes, 20);
assert.equal(POMODORO_PRESETS.deepWork.roundsBeforeLongBreak, 3);
assert.equal(POMODORO_PRESETS.deepWork.longBreakEnabled, true);

assert.equal(validatePomodoroConfig(POMODORO_PRESETS.classic), null);
assert.equal(
  validatePomodoroConfig({ ...POMODORO_PRESETS.classic, focusMinutes: 0 }),
  "Focus duration must be 1-180 minutes.",
);
assert.equal(
  validatePomodoroConfig({ ...POMODORO_PRESETS.classic, roundsBeforeLongBreak: 13 }),
  "Rounds before long break must be 1-12.",
);

assert.deepEqual(
  advancePomodoroPhase("focus", 3, POMODORO_PRESETS.deepWork),
  { phase: "longBreak", roundIndex: 3 },
);
assert.deepEqual(
  advancePomodoroPhase("longBreak", 3, POMODORO_PRESETS.deepWork),
  { phase: "focus", roundIndex: 1 },
);
assert.deepEqual(
  advancePomodoroPhase("focus", 6, POMODORO_PRESETS.sprint),
  { phase: "shortBreak", roundIndex: 6 },
);
assert.deepEqual(
  advancePomodoroPhase("shortBreak", 6, POMODORO_PRESETS.sprint),
  { phase: "focus", roundIndex: 7 },
);

assert.equal(formatPomodoroTime(50 * 60 * 1000), "50:00");
assert.equal(formatPomodoroTime(61_000), "01:01");
