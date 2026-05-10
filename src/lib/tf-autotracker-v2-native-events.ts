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
  bundlePath?: string;
  executablePath?: string;
  windowTitle?: string;
  isIdle?: boolean;
  /** Active browser tab title — set when foreground app is a known browser. */
  browserTitle?: string;
  /** Active browser tab URL — set when foreground app is a known browser. */
  browserUrl?: string;
  /** Set when browser tab read was attempted but failed (e.g. permission denied). */
  browserTabError?: string;
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

export type AutoTrackerV2NativeSamplerStatus = {
  running: boolean;
  intervalMs: number;
  tickCount: number;
  lastTickStartedAtMs: number | null;
  lastTickCompletedAtMs: number | null;
  lastAppendedCount: number;
  lastError: string | null;
  lastObservedAppName: string | null;
  lastObservedBundleId: string | null;
  bufferCount: number;
  recoveryFilePath: string | null;
  recoveryWritePath: string | null;
  recoveryReadPath: string | null;
  recoveryWriteCount: number;
  lastRecoveryWriteAtMs: number | null;
  lastRecoveryWriteError: string | null;
  lastRecoveryEventsCount: number;
  lastRecoveryWriteByteCount: number | null;
  lastRecoveryReadbackEventsCount: number | null;
  recoveryFileExistsAfterWrite: boolean | null;
};

export type AutoTrackerV2NativeRecoveryState = {
  schemaVersion: 1;
  lastPersistedAtMs: number;
  lastObservedEventTimestampMs: number | null;
  lastObservedAppName: string | null;
  lastObservedBundleId: string | null;
  lastObservedBrowserTitle: string | null;
  lastObservedBrowserUrl: string | null;
  samplerStatus: AutoTrackerV2NativeSamplerStatus;
  events: AutoTrackerV2NativeEvent[];
};

export type AutoTrackerV2NativeRecoveryPathDiagnostics = {
  source: string;
  recoveryFilePath: string;
  exists: boolean;
  sizeBytes: number | null;
  modifiedAtMs: number | null;
  parsedSchemaVersion: number | null;
  eventsCount: number | null;
  lastObservedAppName: string | null;
  lastObservedBundleId: string | null;
  lastObservedBrowserTitle: string | null;
  lastObservedBrowserUrl: string | null;
  readError: string | null;
};

export type AutoTrackerV2NativeRecoveryDiagnostics = AutoTrackerV2NativeRecoveryPathDiagnostics & {
  primaryRecoveryFilePath: string;
  writeFilePath: string;
  readFilePath: string | null;
  selectedReadSource: string;
  fallbackCandidates: AutoTrackerV2NativeRecoveryPathDiagnostics[];
  lastWriteByteCount: number | null;
  fileExistsAfterWrite: boolean | null;
  readbackAfterWriteEventsCount: number | null;
};

export type AutoTrackerV2NativeRecoveryClearResult = {
  deleted: boolean;
  deletedPrimary: boolean;
  fallbackCleanupCount: number;
  deletedPaths: string[];
  recoveryFilePath: string;
};

export type AutoTrackerV2NativeRecoveryDebugWriteResult = {
  writePath: string;
  readPath: string;
  writeOk: boolean;
  writeError: string | null;
  bytesWritten: number | null;
  readbackEventsCount: number | null;
  exists: boolean;
  fileSize: number | null;
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

export function readAutoTrackerV2NativeRecovery(): Promise<AutoTrackerV2NativeRecoveryState | null> {
  return core.invoke<AutoTrackerV2NativeRecoveryState | null>(
    "tf_autotracker_v2_native_recovery_read",
  );
}

export function readAutoTrackerV2NativeRecoveryDiagnostics(): Promise<AutoTrackerV2NativeRecoveryDiagnostics> {
  return core.invoke<AutoTrackerV2NativeRecoveryDiagnostics>(
    "tf_autotracker_v2_native_recovery_diagnostics",
  );
}

export function clearAutoTrackerV2NativeRecovery(): Promise<AutoTrackerV2NativeRecoveryClearResult> {
  return core.invoke<AutoTrackerV2NativeRecoveryClearResult>(
    "tf_autotracker_v2_native_recovery_clear",
  );
}

export function debugWriteAutoTrackerV2NativeRecoveryNow(): Promise<AutoTrackerV2NativeRecoveryDebugWriteResult> {
  return core.invoke<AutoTrackerV2NativeRecoveryDebugWriteResult>(
    "tf_autotracker_v2_native_recovery_debug_write_now",
  );
}

export function getAutoTrackerV2NativeSamplerStatus(): Promise<AutoTrackerV2NativeSamplerStatus> {
  return core.invoke<AutoTrackerV2NativeSamplerStatus>(
    "tf_autotracker_v2_native_sampler_status",
  );
}

export function startAutoTrackerV2NativeSampler(): Promise<AutoTrackerV2NativeSamplerStatus> {
  return core.invoke<AutoTrackerV2NativeSamplerStatus>(
    "tf_autotracker_v2_native_sampler_start",
  );
}

export function stopAutoTrackerV2NativeSampler(): Promise<AutoTrackerV2NativeSamplerStatus> {
  return core.invoke<AutoTrackerV2NativeSamplerStatus>(
    "tf_autotracker_v2_native_sampler_stop",
  );
}
