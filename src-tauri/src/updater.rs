use tauri::AppHandle;
#[cfg(not(debug_assertions))]
use std::fs;
#[cfg(not(debug_assertions))]
use std::path::PathBuf;
#[cfg(not(debug_assertions))]
use std::sync::{Mutex, OnceLock};
#[cfg(not(debug_assertions))]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(not(debug_assertions))]
use tauri::Emitter;
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use std::str::FromStr;

const DEFAULT_UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCREM0MDU1RDBDNEVGQwpSV1Q4VGd4ZEJjUzlDbHErREoxaUc5a1NBZ0hWOXNKVlhJNkw4Nnpmei82YytCZEJlY2JMbGpwQgo=";
#[cfg(not(debug_assertions))]
const DEFAULT_UPDATER_ENDPOINT: &str =
    "https://github.com/PaulElon/Step2Tracker/releases/latest/download/latest.json";

#[cfg(not(debug_assertions))]
use std::env;
#[cfg(not(debug_assertions))]
use tauri_plugin_updater::UpdaterExt;
#[cfg(not(debug_assertions))]
use url::Url;

#[cfg(not(debug_assertions))]
const UPDATER_ENDPOINTS_ENV: &str = "STEP2_UPDATER_ENDPOINTS";
#[cfg(not(debug_assertions))]
const UPDATER_ENDPOINT_ENV: &str = "STEP2_UPDATER_ENDPOINT";
#[cfg(not(debug_assertions))]
const UPDATER_PUBKEY_ENV: &str = "STEP2_UPDATER_PUBKEY";
#[cfg(not(debug_assertions))]
const UPDATE_CHECK_COOLDOWN_MS: u64 = 24 * 60 * 60 * 1000;
#[cfg(not(debug_assertions))]
const UPDATE_CHECK_STATE_FILE: &str = "update-check-state.txt";
#[cfg(not(debug_assertions))]
static UPDATE_CHECK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn updater_pubkey() -> String {
    #[cfg(debug_assertions)]
    {
        DEFAULT_UPDATER_PUBKEY.to_string()
    }

    #[cfg(not(debug_assertions))]
    {
        env::var(UPDATER_PUBKEY_ENV)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_UPDATER_PUBKEY.to_string())
    }
}

#[cfg(not(debug_assertions))]
fn configured_endpoints() -> Vec<Url> {
    let raw = env::var(UPDATER_ENDPOINTS_ENV)
        .ok()
        .or_else(|| env::var(UPDATER_ENDPOINT_ENV).ok())
        .unwrap_or_default();

    let parsed = raw
        .split(['\n', ',', ';'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter_map(|value| Url::parse(value).ok())
        .collect::<Vec<_>>();

    if parsed.is_empty() {
        Url::from_str(DEFAULT_UPDATER_ENDPOINT)
            .map(|url| vec![url])
            .unwrap_or_default()
    } else {
        parsed
    }
}

#[cfg(not(debug_assertions))]
fn update_check_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    path.push(UPDATE_CHECK_STATE_FILE);
    Ok(path)
}

#[cfg(not(debug_assertions))]
fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

#[cfg(not(debug_assertions))]
fn read_last_update_check_at(app: &AppHandle) -> Result<Option<u64>, String> {
    let path = update_check_state_path(app)?;
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(error) => {
            return Err(format!("Unable to read update check state: {error}"));
        }
    };

    Ok(contents.trim().parse::<u64>().ok())
}

#[cfg(not(debug_assertions))]
fn write_last_update_check_at(app: &AppHandle, timestamp_ms: u64) -> Result<(), String> {
    let path = update_check_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create update check state directory: {error}"))?;
    }
    fs::write(path, timestamp_ms.to_string())
        .map_err(|error| format!("Unable to write update check state: {error}"))
}

#[cfg(not(debug_assertions))]
fn should_attempt_update_check(app: &AppHandle) -> Result<bool, String> {
    let _guard = UPDATE_CHECK_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Update check lock poisoned.".to_string())?;

    let now = current_time_millis();
    if let Some(last_check_at) = read_last_update_check_at(app)? {
        if now.saturating_sub(last_check_at) < UPDATE_CHECK_COOLDOWN_MS {
            return Ok(false);
        }
    }

    write_last_update_check_at(app, now)?;
    Ok(true)
}

#[cfg(not(debug_assertions))]
async fn perform_update_check(app: AppHandle) -> Result<(), String> {
    if !should_attempt_update_check(&app)? {
        return Ok(());
    }

    let endpoints = configured_endpoints();
    if endpoints.is_empty() {
        return Ok(());
    }

    let pubkey = updater_pubkey();

    let updater = match app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(endpoints)
    {
        Ok(builder) => match builder.timeout(Duration::from_secs(30)).build() {
            Ok(updater) => updater,
            Err(error) => {
                eprintln!("Updater disabled: {error}");
                return Ok(());
            }
        },
        Err(error) => {
            eprintln!("Updater disabled: {error}");
            return Ok(());
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            app.emit("update-available", update.version.to_string()).ok();
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("Updater check failed: {error}");
        }
    }

    Ok(())
}

#[cfg(debug_assertions)]
pub fn spawn_update_check(_: AppHandle) {}

#[cfg(not(debug_assertions))]
pub fn spawn_update_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = perform_update_check(app).await {
            eprintln!("Updater check failed: {error}");
        }
    });
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<(), String> {
    perform_update_check(app).await
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn check_for_updates(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let endpoints = configured_endpoints();
    if endpoints.is_empty() {
        return Ok(());
    }
    let pubkey = updater_pubkey();
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(endpoints)
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            app.restart();
        }
        None => {}
    }
    Ok(())
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn install_update(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
