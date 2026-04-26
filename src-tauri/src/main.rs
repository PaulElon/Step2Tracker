#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod persistence;
mod updater;

use std::process::Command;

use persistence::{
    AppState, BackupArtifactPreview, ClientSnapshot, ErrorLogInput, ImportMode, PracticeTestInput, Preferences,
    StorageService, StudyBlockInput, TrashEntityType, WeakTopicInput,
};
use tauri::Manager;

fn with_storage<F, T>(app: &tauri::AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce(StorageService) -> Result<T, persistence::StorageError>,
{
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {}", error))?;
    let service = StorageService::new(data_dir, app.package_info().version.to_string());
    operation(service).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.load_snapshot())
}

#[tauri::command]
fn save_preferences(app: tauri::AppHandle, preferences: Preferences) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.save_preferences(preferences))
}

#[tauri::command]
fn upsert_study_block(app: tauri::AppHandle, block: StudyBlockInput) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.upsert_study_block(block))
}

#[tauri::command]
fn duplicate_study_block(
    app: tauri::AppHandle,
    id: String,
    target_date: Option<String>,
) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.duplicate_study_block(id, target_date))
}

#[tauri::command]
fn trash_study_block(app: tauri::AppHandle, id: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.trash_study_block(id))
}

#[tauri::command]
fn import_study_blocks(
    app: tauri::AppHandle,
    blocks: Vec<StudyBlockInput>,
    mode: ImportMode,
) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.import_study_blocks(blocks, mode))
}

#[tauri::command]
fn upsert_practice_test(
    app: tauri::AppHandle,
    test: PracticeTestInput,
) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.upsert_practice_test(test))
}

#[tauri::command]
fn trash_practice_test(app: tauri::AppHandle, id: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.trash_practice_test(id))
}

#[tauri::command]
fn upsert_weak_topic(app: tauri::AppHandle, entry: WeakTopicInput) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.upsert_weak_topic(entry))
}

#[tauri::command]
fn trash_weak_topic(app: tauri::AppHandle, id: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.trash_weak_topic(id))
}

#[tauri::command]
fn restore_trashed_item(
    app: tauri::AppHandle,
    entity_type: TrashEntityType,
    id: String,
) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.restore_trashed_item(entity_type, id))
}

#[tauri::command]
fn export_backup_artifact(app: tauri::AppHandle) -> Result<String, String> {
    with_storage(&app, |service| service.export_backup_artifact())
}

#[tauri::command]
fn preview_backup_artifact(app: tauri::AppHandle, raw: String) -> Result<BackupArtifactPreview, String> {
    with_storage(&app, |service| service.preview_backup_artifact(raw))
}

#[tauri::command]
fn restore_from_backup_artifact(app: tauri::AppHandle, raw: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.restore_from_backup_artifact(raw))
}

#[tauri::command]
fn restore_from_snapshot(app: tauri::AppHandle, backup_id: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.restore_from_snapshot(backup_id))
}

#[tauri::command]
fn migrate_legacy_browser_state(
    app: tauri::AppHandle,
    legacy_source_json: String,
    state: AppState,
) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.migrate_legacy_browser_state(legacy_source_json, state))
}

#[tauri::command]
fn upsert_error_log_entry(app: tauri::AppHandle, entry: ErrorLogInput) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.upsert_error_log_entry(entry))
}

#[tauri::command]
fn trash_error_log_entry(app: tauri::AppHandle, id: String) -> Result<ClientSnapshot, String> {
    with_storage(&app, |service| service.trash_error_log_entry(id))
}

#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.notifications")
            .status()
            .map_err(|error| format!("Unable to open Notification settings: {error}"))?;

        if status.success() {
            Ok(())
        } else {
            Err("Unable to open Notification settings.".into())
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Notification settings shortcut is only available on macOS.".into())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().pubkey(updater::updater_pubkey()).build())
        .setup(|app| {
            updater::spawn_update_check(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_preferences,
            upsert_study_block,
            duplicate_study_block,
            trash_study_block,
            import_study_blocks,
            upsert_practice_test,
            trash_practice_test,
            upsert_weak_topic,
            trash_weak_topic,
            restore_trashed_item,
            export_backup_artifact,
            preview_backup_artifact,
            restore_from_backup_artifact,
            restore_from_snapshot,
            migrate_legacy_browser_state,
            upsert_error_log_entry,
            trash_error_log_entry,
            open_notification_settings,
            updater::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeFolio Study Tracker");
}
