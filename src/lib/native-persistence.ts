import { core } from "@tauri-apps/api";
import type {
  AppState,
  BackupArtifactPreview,
  ErrorLogInput,
  ImportMode,
  PersistenceSnapshot,
  Preferences,
  PracticeTestInput,
  StudyBlockInput,
  TfAppState,
  TrashEntityType,
  WeakTopicInput,
} from "../types/models";

function command<T>(name: string, args?: Record<string, unknown>) {
  return core.invoke<T>(name, args);
}

export type NativeAutoTrackerBootstrapProbe = {
  detected: boolean;
  installed: boolean;
  paired: boolean;
  platform: string | null;
  streamPort: number | null;
  basePath: string | null;
  appVersion: string | null;
  deviceId: string | null;
  pendingUserCode: string | null;
  pendingVerificationUrl: string | null;
  pendingTransferDeviceId: string | null;
  pendingReplaceDeviceId: string | null;
  lastPairingError: string | null;
  accessibility: string | null;
  browserAutomation: string | null;
  closedSpanCount: number;
  hasOpenSpan: boolean;
  lastCheckedISO: string;
  error: string | null;
};

export function loadNativeSnapshot() {
  return command<PersistenceSnapshot>("load_state");
}

export function saveNativePreferences(preferences: Preferences) {
  return command<PersistenceSnapshot>("save_preferences", { preferences });
}

export function upsertNativeStudyBlock(block: StudyBlockInput) {
  return command<PersistenceSnapshot>("upsert_study_block", { block });
}

export function duplicateNativeStudyBlock(id: string, targetDate?: string) {
  return command<PersistenceSnapshot>("duplicate_study_block", {
    id,
    targetDate,
  });
}

export function trashNativeStudyBlock(id: string) {
  return command<PersistenceSnapshot>("trash_study_block", { id });
}

export function importNativeStudyBlocks(blocks: StudyBlockInput[], mode: ImportMode) {
  return command<PersistenceSnapshot>("import_study_blocks", { blocks, mode });
}

export function upsertNativePracticeTest(test: PracticeTestInput) {
  return command<PersistenceSnapshot>("upsert_practice_test", { test });
}

export function trashNativePracticeTest(id: string) {
  return command<PersistenceSnapshot>("trash_practice_test", { id });
}

export function upsertNativeWeakTopic(entry: WeakTopicInput) {
  return command<PersistenceSnapshot>("upsert_weak_topic", { entry });
}

export function trashNativeWeakTopic(id: string) {
  return command<PersistenceSnapshot>("trash_weak_topic", { id });
}

export function restoreNativeTrashItem(entityType: TrashEntityType, id: string) {
  return command<PersistenceSnapshot>("restore_trashed_item", {
    entityType,
    id,
  });
}

export function exportNativeBackupArtifact() {
  return command<string>("export_backup_artifact");
}

export function previewNativeBackupArtifact(raw: string) {
  return command<BackupArtifactPreview>("preview_backup_artifact", { raw });
}

export function restoreNativeBackupArtifact(raw: string) {
  return command<PersistenceSnapshot>("restore_from_backup_artifact", { raw });
}

export function restoreNativeSnapshot(backupId: string) {
  return command<PersistenceSnapshot>("restore_from_snapshot", { backupId });
}

export function migrateLegacyBrowserState(legacySourceJson: string, state: AppState) {
  return command<PersistenceSnapshot>("migrate_legacy_browser_state", {
    legacySourceJson,
    state,
  });
}

export function upsertNativeErrorLogEntry(entry: ErrorLogInput) {
  return command<PersistenceSnapshot>("upsert_error_log_entry", { entry });
}

export function trashNativeErrorLogEntry(id: string) {
  return command<PersistenceSnapshot>("trash_error_log_entry", { id });
}

export function loadNativeTfState(): Promise<TfAppState> {
  return command<TfAppState>("tf_load_state");
}

export function saveNativeTfState(state: TfAppState): Promise<TfAppState> {
  return command<TfAppState>("tf_save_state", { state });
}

export function resetNativeTfState(): Promise<TfAppState> {
  return command<TfAppState>("tf_reset_state");
}

export function probeNativeAutoTrackerBootstrap(): Promise<NativeAutoTrackerBootstrapProbe> {
  return command<NativeAutoTrackerBootstrapProbe>("tf_autotracker_probe_bootstrap");
}
