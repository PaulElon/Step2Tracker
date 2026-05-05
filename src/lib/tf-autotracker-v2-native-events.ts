// Auto-Tracker V2 native event source — frontend type helpers and invoke wrappers.
//
// Shadow/buffer only. These helpers are not wired into the V2 reducer or
// session-creation paths. They exist so the inspector UI can query the
// in-process native event buffer.

import { core } from "@tauri-apps/api";

export type AutoTrackerV2NativeEventKind =
  | "targetFocused"
  | "untrackedFocused"
  | "idleChanged"
  | "appShutdown"
  | "permissionStatus"
  | "error";

export type AutoTrackerV2NativePlatform = "macos";

export type AutoTrackerV2NativeEvent = {
  id: string;
  kind: AutoTrackerV2NativeEventKind;
  timestampMs: number;
  platform: AutoTrackerV2NativePlatform;
  appName?: string;
  bundleId?: string;
  windowTitle?: string;
  isIdle?: boolean;
  error?: string;
};

export type AutoTrackerV2NativeStatus = {
  platform: AutoTrackerV2NativePlatform;
  supported: boolean;
  foregroundProbeAvailable: boolean;
  idleProbeAvailable: boolean;
  bufferLen: number;
  bufferCapacity: number;
  lastSampledAtMs: number | null;
  note: string;
};

export type AutoTrackerV2NativeSnapshot = {
  status: AutoTrackerV2NativeStatus;
  events: AutoTrackerV2NativeEvent[];
};

export type AutoTrackerV2NativeCaptureResult = {
  status: AutoTrackerV2NativeStatus;
  appended: AutoTrackerV2NativeEvent[];
};

export function probeAutoTrackerV2Native(): Promise<AutoTrackerV2NativeStatus> {
  return core.invoke<AutoTrackerV2NativeStatus>("tf_autotracker_v2_native_probe");
}

export function snapshotAutoTrackerV2Native(): Promise<AutoTrackerV2NativeSnapshot> {
  return core.invoke<AutoTrackerV2NativeSnapshot>("tf_autotracker_v2_native_snapshot");
}

export function clearAutoTrackerV2NativeBuffer(): Promise<AutoTrackerV2NativeStatus> {
  return core.invoke<AutoTrackerV2NativeStatus>("tf_autotracker_v2_native_clear_buffer");
}

export function captureAutoTrackerV2NativeOnce(): Promise<AutoTrackerV2NativeCaptureResult> {
  return core.invoke<AutoTrackerV2NativeCaptureResult>(
    "tf_autotracker_v2_native_capture_once",
  );
}
