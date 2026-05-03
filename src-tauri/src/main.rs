#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod persistence;
mod tf_autotracker;
mod tf_persistence;
mod updater;

use std::process::Command;
use std::{fs, path::PathBuf};

use persistence::{
    AppState, BackupArtifactPreview, ClientSnapshot, ErrorLogInput, ImportMode, PracticeTestInput, Preferences,
    StorageService, StudyBlockInput, TrashEntityType, WeakTopicInput,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

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

fn nbimg_protocol_handler(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    fn err(status: u16, body: &[u8]) -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", "text/plain")
            .body(body.to_vec())
            .unwrap()
    }

    let path = request.uri().path();
    let file_name = path.trim_start_matches('/');

    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return err(403, b"Forbidden");
    }

    let ext = file_name.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return err(403, b"Forbidden"),
    };

    let data_dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => return err(500, b"Internal error"),
    };

    let file_path = data_dir.join("notebook-assets").join(file_name);

    match fs::read(&file_path) {
        Ok(bytes) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .body(bytes)
            .unwrap(),
        Err(_) => err(404, b"Not found"),
    }
}

#[tauri::command]
fn save_notebook_image(app: tauri::AppHandle, data_b64: String, ext: String) -> Result<String, String> {
    use base64::Engine as _;

    let ext = ext.to_lowercase();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" => {}
        _ => return Err(format!("Unsupported extension: {ext}")),
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Invalid base64 data: {e}"))?;

    const MAX_BYTES: usize = 10 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(format!("Image exceeds 10 MB limit ({} bytes)", bytes.len()));
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data directory: {e}"))?;

    let assets_dir = data_dir.join("notebook-assets");
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Unable to create notebook-assets directory: {e}"))?;

    let file_name = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    let file_path = assets_dir.join(&file_name);

    fs::write(&file_path, &bytes)
        .map_err(|e| format!("Unable to write image file: {e}"))?;

    Ok(format!("nbimg://localhost/{file_name}"))
}

#[tauri::command]
async fn export_notebook_page(
    app: tauri::AppHandle,
    suggested_file_name: String,
    contents: String,
) -> Result<String, String> {
    let fallback_name = "notebook-page.txt".to_string();
    let file_name = if suggested_file_name.trim().is_empty() {
        fallback_name
    } else {
        suggested_file_name
    };

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog().file().set_file_name(file_name).save_file(move |file| {
        let _ = tx.try_send(file);
    });

    let selected_file = rx
        .recv()
        .await
        .ok_or_else(|| "Unable to receive export destination.".to_string())?
        .ok_or_else(|| "Export canceled by user.".to_string())?;

    let path: PathBuf = selected_file
        .into_path()
        .map_err(|error| format!("Unable to resolve selected export path: {error}"))?;

    fs::write(&path, contents).map_err(|error| format!("Unable to write notebook export file: {error}"))?;

    Ok(path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("nbimg", |ctx, request| nbimg_protocol_handler(ctx.app_handle(), request))
        .plugin(tauri_plugin_dialog::init())
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
            tf_autotracker::tf_autotracker_probe_bootstrap,
            tf_persistence::tf_load_state,
            tf_persistence::tf_save_state,
            tf_persistence::tf_reset_state,
            open_notification_settings,
            export_notebook_page,
            save_notebook_image,
            updater::check_for_updates,
            updater::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeFolio Study Tracker");
}
