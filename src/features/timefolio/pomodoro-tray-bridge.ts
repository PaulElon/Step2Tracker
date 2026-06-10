import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const IS_TAURI_SHELL =
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

export type PomodoroTrayPhase = "focus" | "shortBreak" | "longBreak";
export type PomodoroTrayStatus = "idle" | "running" | "paused";

export interface PomodoroTraySyncPayload {
  phase: PomodoroTrayPhase;
  status: PomodoroTrayStatus;
  durationMs: number;
  phaseEndsAtMs: number | null;
  remainingMsWhenPaused: number | null;
  routineLabel: string;
  actionEnabled: boolean;
  resetEnabled: boolean;
}

export async function syncPomodoroTray(update: PomodoroTraySyncPayload) {
  if (!IS_TAURI_SHELL) {
    return;
  }

  try {
    await invoke("sync_pomodoro_tray", { update });
  } catch {
    // Tray sync is best-effort outside the desktop runtime.
  }
}

export async function listenForPomodoroTrayEvent(eventName: string, handler: () => void) {
  if (!IS_TAURI_SHELL) {
    return () => undefined;
  }

  try {
    return await listen(eventName, () => {
      handler();
    });
  } catch {
    return () => undefined;
  }
}
