// Auto-Tracker V2 native event source — shadow/buffer only.
//
// This module observes the local desktop and produces V2-compatible
// normalized events into an in-memory ring buffer. It does NOT feed
// the V2 reducer, but it does persist dev recovery snapshots for the
// native sampler. Sampling is on-demand via the
// `tf_autotracker_v2_native_capture_once` command or the background sampler.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

const PLATFORM_LABEL: &str = "macos";
const MAX_BUFFER_LEN: usize = 2_000;
const MAX_RECOVERY_EVENT_LEN: usize = 400;
const IDLE_THRESHOLD_SECS: u64 = 60;
const NATIVE_SAMPLER_INTERVAL_MS: u64 = 3_000;
const NATIVE_SAMPLER_STOP_POLL_MS: u64 = 100;
const RECOVERY_FILE_NAME: &str = "autotracker-v2-dev-recovery.json";
const DEV_RECOVERY_BUNDLE_DIR: &str = "com.paul.step2ckcommandcenter";
const COMMAND_TIMEOUT_NOTE: &str = "lsappinfo/ioreg run synchronously and return promptly on macOS";

// ---------------------------------------------------------------------------
// Event and status types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeEvent {
    pub id: String,
    /// One of: "targetFocused" | "untrackedFocused" | "idleChanged"
    /// | "appShutdown" | "permissionStatus" | "error"
    pub kind: String,
    pub timestamp_ms: i64,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bundle_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_idle: Option<bool>,
    /// Active browser tab title (set when foreground app is a known browser).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_title: Option<String>,
    /// Active browser tab URL (set when foreground app is a known browser).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_url: Option<String>,
    /// Set when browser tab read was attempted but failed (e.g. permission denied).
    /// Foreground capture itself still succeeds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_tab_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeStatus {
    pub platform: String,
    pub supported: bool,
    pub foreground_probe_available: bool,
    pub idle_probe_available: bool,
    pub buffer_len: usize,
    pub buffer_capacity: usize,
    pub last_sampled_at_ms: Option<i64>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeSnapshot {
    pub status: TfAutotrackerV2NativeStatus,
    pub events: Vec<TfAutotrackerV2NativeEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeCaptureResult {
    pub status: TfAutotrackerV2NativeStatus,
    pub appended: Vec<TfAutotrackerV2NativeEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeSamplerStatus {
    pub running: bool,
    pub interval_ms: u64,
    pub tick_count: u64,
    pub last_tick_started_at_ms: Option<i64>,
    pub last_tick_completed_at_ms: Option<i64>,
    pub last_appended_count: usize,
    pub last_error: Option<String>,
    pub last_observed_app_name: Option<String>,
    pub last_observed_bundle_id: Option<String>,
    pub buffer_count: usize,
    pub recovery_file_path: Option<String>,
    pub recovery_write_path: Option<String>,
    pub recovery_read_path: Option<String>,
    pub recovery_write_count: u64,
    pub last_recovery_write_at_ms: Option<i64>,
    pub last_recovery_write_error: Option<String>,
    pub last_recovery_events_count: usize,
    pub last_recovery_write_byte_count: Option<u64>,
    pub last_recovery_readback_events_count: Option<usize>,
    pub recovery_file_exists_after_write: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeRecoveryState {
    pub schema_version: u8,
    pub last_persisted_at_ms: i64,
    pub last_observed_event_timestamp_ms: Option<i64>,
    pub last_observed_app_name: Option<String>,
    pub last_observed_bundle_id: Option<String>,
    pub last_observed_browser_title: Option<String>,
    pub last_observed_browser_url: Option<String>,
    pub sampler_status: TfAutotrackerV2NativeSamplerStatus,
    pub events: Vec<TfAutotrackerV2NativeEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeRecoveryPathDiagnostics {
    pub source: String,
    pub recovery_file_path: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub modified_at_ms: Option<i64>,
    pub parsed_schema_version: Option<u8>,
    pub events_count: Option<usize>,
    pub last_observed_app_name: Option<String>,
    pub last_observed_bundle_id: Option<String>,
    pub last_observed_browser_title: Option<String>,
    pub last_observed_browser_url: Option<String>,
    pub read_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeRecoveryDiagnostics {
    pub source: String,
    pub recovery_file_path: String,
    pub primary_recovery_file_path: String,
    pub write_file_path: String,
    pub read_file_path: Option<String>,
    pub selected_read_source: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub modified_at_ms: Option<i64>,
    pub parsed_schema_version: Option<u8>,
    pub events_count: Option<usize>,
    pub last_observed_app_name: Option<String>,
    pub last_observed_bundle_id: Option<String>,
    pub last_observed_browser_title: Option<String>,
    pub last_observed_browser_url: Option<String>,
    pub read_error: Option<String>,
    pub fallback_candidates: Vec<TfAutotrackerV2NativeRecoveryPathDiagnostics>,
    pub last_write_byte_count: Option<u64>,
    pub file_exists_after_write: Option<bool>,
    pub readback_after_write_events_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeRecoveryClearResult {
    pub deleted: bool,
    pub deleted_primary: bool,
    pub fallback_cleanup_count: usize,
    pub deleted_paths: Vec<String>,
    pub recovery_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeRecoveryDebugWriteResult {
    pub write_path: String,
    pub read_path: String,
    pub write_ok: bool,
    pub write_error: Option<String>,
    pub bytes_written: Option<u64>,
    pub readback_events_count: Option<usize>,
    pub exists: bool,
    pub file_size: Option<u64>,
}

// ---------------------------------------------------------------------------
// In-memory ring buffer
// ---------------------------------------------------------------------------

struct NativeBuffer {
    events: Vec<TfAutotrackerV2NativeEvent>,
    last_sampled_at_ms: Option<i64>,
    last_app_bundle_id: Option<String>,
    /// Fallback dedup key used when bundle_id is absent for both old and new app.
    last_app_name: Option<String>,
    last_idle: Option<bool>,
    /// Last successfully captured browser URL — used to detect in-browser navigation
    /// without an app switch. Cleared whenever the foreground app changes.
    last_browser_url: Option<String>,
}

impl NativeBuffer {
    const fn new() -> Self {
        Self {
            events: Vec::new(),
            last_sampled_at_ms: None,
            last_app_bundle_id: None,
            last_app_name: None,
            last_idle: None,
            last_browser_url: None,
        }
    }

    fn push(&mut self, event: TfAutotrackerV2NativeEvent) {
        self.events.push(event);
        if self.events.len() > MAX_BUFFER_LEN {
            let overflow = self.events.len() - MAX_BUFFER_LEN;
            self.events.drain(0..overflow);
        }
    }

    fn clear(&mut self) {
        self.events.clear();
        self.last_app_bundle_id = None;
        self.last_app_name = None;
        self.last_idle = None;
        self.last_browser_url = None;
    }
}

static BUFFER: Mutex<NativeBuffer> = Mutex::new(NativeBuffer::new());

struct NativeCaptureOutcome {
    result: TfAutotrackerV2NativeCaptureResult,
    observed_app_name: Option<String>,
    observed_bundle_id: Option<String>,
}

struct NativeSamplerState {
    is_active: bool,
    stop_requested: bool,
    stop_flag: Option<Arc<AtomicBool>>,
    thread_handle: Option<JoinHandle<()>>,
    tick_count: u64,
    last_tick_started_at_ms: Option<i64>,
    last_tick_completed_at_ms: Option<i64>,
    last_appended_count: usize,
    last_error: Option<String>,
    last_observed_app_name: Option<String>,
    last_observed_bundle_id: Option<String>,
    recovery_file_path: Option<String>,
    recovery_write_path: Option<String>,
    recovery_read_path: Option<String>,
    recovery_write_count: u64,
    last_recovery_write_at_ms: Option<i64>,
    last_recovery_write_error: Option<String>,
    last_recovery_events_count: usize,
    last_recovery_write_byte_count: Option<u64>,
    last_recovery_readback_events_count: Option<usize>,
    recovery_file_exists_after_write: Option<bool>,
}

impl NativeSamplerState {
    const fn new() -> Self {
        Self {
            is_active: false,
            stop_requested: false,
            stop_flag: None,
            thread_handle: None,
            tick_count: 0,
            last_tick_started_at_ms: None,
            last_tick_completed_at_ms: None,
            last_appended_count: 0,
            last_error: None,
            last_observed_app_name: None,
            last_observed_bundle_id: None,
            recovery_file_path: None,
            recovery_write_path: None,
            recovery_read_path: None,
            recovery_write_count: 0,
            last_recovery_write_at_ms: None,
            last_recovery_write_error: None,
            last_recovery_events_count: 0,
            last_recovery_write_byte_count: None,
            last_recovery_readback_events_count: None,
            recovery_file_exists_after_write: None,
        }
    }

    fn status(&self, buffer_count: usize) -> TfAutotrackerV2NativeSamplerStatus {
        TfAutotrackerV2NativeSamplerStatus {
            running: self.is_active && !self.stop_requested,
            interval_ms: NATIVE_SAMPLER_INTERVAL_MS,
            tick_count: self.tick_count,
            last_tick_started_at_ms: self.last_tick_started_at_ms,
            last_tick_completed_at_ms: self.last_tick_completed_at_ms,
            last_appended_count: self.last_appended_count,
            last_error: self.last_error.clone(),
            last_observed_app_name: self.last_observed_app_name.clone(),
            last_observed_bundle_id: self.last_observed_bundle_id.clone(),
            buffer_count,
            recovery_file_path: self.recovery_file_path.clone(),
            recovery_write_path: self.recovery_write_path.clone(),
            recovery_read_path: self.recovery_read_path.clone(),
            recovery_write_count: self.recovery_write_count,
            last_recovery_write_at_ms: self.last_recovery_write_at_ms,
            last_recovery_write_error: self.last_recovery_write_error.clone(),
            last_recovery_events_count: self.last_recovery_events_count,
            last_recovery_write_byte_count: self.last_recovery_write_byte_count,
            last_recovery_readback_events_count: self.last_recovery_readback_events_count,
            recovery_file_exists_after_write: self.recovery_file_exists_after_write,
        }
    }

    fn has_runtime(&self) -> bool {
        self.is_active || self.stop_flag.is_some() || self.thread_handle.is_some()
    }

    fn begin_start(&mut self, stop_flag: Arc<AtomicBool>) -> bool {
        if self.has_runtime() {
            return false;
        }

        self.is_active = true;
        self.stop_requested = false;
        self.stop_flag = Some(stop_flag);
        self.thread_handle = None;
        self.tick_count = 0;
        self.last_tick_started_at_ms = None;
        self.last_tick_completed_at_ms = None;
        self.last_appended_count = 0;
        self.last_error = None;
        self.last_observed_app_name = None;
        self.last_observed_bundle_id = None;
        self.last_recovery_write_error = None;
        self.last_recovery_write_byte_count = None;
        self.last_recovery_readback_events_count = None;
        self.recovery_file_exists_after_write = None;
        true
    }

    fn set_recovery_file_path(&mut self, path: String) {
        self.recovery_file_path = Some(path);
    }

    fn attach_thread_handle(&mut self, handle: JoinHandle<()>) {
        self.thread_handle = Some(handle);
    }

    fn abort_start(&mut self, error: String) {
        self.is_active = false;
        self.stop_requested = false;
        self.stop_flag = None;
        self.thread_handle = None;
        self.last_error = Some(error);
    }

    fn request_stop(&mut self) -> bool {
        if let Some(stop_flag) = &self.stop_flag {
            stop_flag.store(true, Ordering::SeqCst);
            self.stop_requested = true;
            return true;
        }
        false
    }

    fn record_tick_started(&mut self, started_at_ms: i64) {
        self.last_tick_started_at_ms = Some(started_at_ms);
    }

    fn record_tick_completed(&mut self, outcome: &NativeCaptureOutcome, completed_at_ms: i64) {
        self.tick_count += 1;
        self.last_tick_completed_at_ms = Some(completed_at_ms);
        self.last_appended_count = outcome.result.appended.len();
        self.last_error = outcome
            .result
            .appended
            .iter()
            .filter_map(|event| {
                if event.kind == "error" {
                    event.error.clone()
                } else {
                    None
                }
            })
            .next_back();
        if let Some(app_name) = &outcome.observed_app_name {
            self.last_observed_app_name = Some(app_name.clone());
        }
        if let Some(bundle_id) = &outcome.observed_bundle_id {
            self.last_observed_bundle_id = Some(bundle_id.clone());
        }
    }

    fn record_recovery_write_success(
        &mut self,
        persisted_at_ms: i64,
        events_count: usize,
        result: &RecoveryWriteReadResult,
    ) {
        self.recovery_write_count += 1;
        self.last_recovery_write_at_ms = Some(persisted_at_ms);
        self.last_recovery_write_error = result.read_error.clone();
        self.last_recovery_events_count = events_count;
        self.recovery_file_path = Some(result.write_path.display().to_string());
        self.recovery_write_path = Some(result.write_path.display().to_string());
        self.recovery_read_path = Some(result.read_path.display().to_string());
        self.last_recovery_write_byte_count = Some(result.bytes_written);
        self.last_recovery_readback_events_count = result.readback_events_count;
        self.recovery_file_exists_after_write = Some(result.exists);
    }

    fn record_recovery_write_error(&mut self, error: String) {
        self.last_recovery_write_error = Some(error);
        self.recovery_file_exists_after_write =
            stable_recovery_path().ok().map(|path| path.exists());
    }

    fn mark_exited(&mut self) {
        self.is_active = false;
        self.stop_requested = false;
        self.stop_flag = None;
    }

    fn cleanup_finished_thread(&mut self) {
        let finished = self
            .thread_handle
            .as_ref()
            .map(|handle| handle.is_finished())
            .unwrap_or(false);
        if !finished {
            return;
        }

        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
        if !self.is_active {
            self.stop_flag = None;
        }
    }
}

static SAMPLER: LazyLock<Mutex<NativeSamplerState>> =
    LazyLock::new(|| Mutex::new(NativeSamplerState::new()));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

fn make_event(kind: &str, timestamp_ms: i64) -> TfAutotrackerV2NativeEvent {
    TfAutotrackerV2NativeEvent {
        id: Uuid::new_v4().to_string(),
        kind: kind.to_string(),
        timestamp_ms,
        platform: PLATFORM_LABEL.to_string(),
        app_name: None,
        bundle_id: None,
        bundle_path: None,
        executable_path: None,
        window_title: None,
        is_idle: None,
        browser_title: None,
        browser_url: None,
        browser_tab_error: None,
        error: None,
    }
}

fn lock_buffer() -> std::sync::MutexGuard<'static, NativeBuffer> {
    match BUFFER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn lock_sampler() -> std::sync::MutexGuard<'static, NativeSamplerState> {
    match SAMPLER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn current_buffer_count() -> usize {
    lock_buffer().events.len()
}

fn build_status(
    buffer: &NativeBuffer,
    foreground_ok: bool,
    idle_ok: bool,
) -> TfAutotrackerV2NativeStatus {
    TfAutotrackerV2NativeStatus {
        platform: PLATFORM_LABEL.to_string(),
        supported: cfg!(target_os = "macos"),
        foreground_probe_available: foreground_ok,
        idle_probe_available: idle_ok,
        buffer_len: buffer.events.len(),
        buffer_capacity: MAX_BUFFER_LEN,
        last_sampled_at_ms: buffer.last_sampled_at_ms,
        note: COMMAND_TIMEOUT_NOTE.to_string(),
    }
}

#[derive(Debug, Clone)]
struct RecoveryWriteReadResult {
    write_path: PathBuf,
    read_path: PathBuf,
    write_ok: bool,
    bytes_written: u64,
    readback_events_count: Option<usize>,
    exists: bool,
    file_size: Option<u64>,
    read_error: Option<String>,
}

fn deterministic_recovery_path_for_home(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join(DEV_RECOVERY_BUNDLE_DIR)
        .join(RECOVERY_FILE_NAME)
}

fn stable_recovery_path() -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to resolve HOME for native recovery file path.".to_string())?;
    let path = deterministic_recovery_path_for_home(&home);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create native recovery directory {}: {error}",
                parent.display()
            )
        })?;
    }

    Ok(path)
}

fn fallback_recovery_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();
    let primary_path = stable_recovery_path().ok();

    for dir in [
        app.path().app_local_data_dir().ok(),
        app.path().app_data_dir().ok(),
        app.path().app_config_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        let path = dir.join(RECOVERY_FILE_NAME);
        if primary_path.as_ref() == Some(&path) {
            continue;
        }
        if !paths.iter().any(|existing| existing == &path) {
            paths.push(path);
        }
    }

    paths
}

fn select_recovery_events(buffer: &NativeBuffer) -> Vec<TfAutotrackerV2NativeEvent> {
    let start = buffer.events.len().saturating_sub(MAX_RECOVERY_EVENT_LEN);
    buffer.events[start..].to_vec()
}

fn build_recovery_state(
    buffer: &NativeBuffer,
    sampler_status: TfAutotrackerV2NativeSamplerStatus,
    persisted_at_ms: i64,
) -> TfAutotrackerV2NativeRecoveryState {
    let events = select_recovery_events(buffer);
    let mut last_observed_app_name: Option<String> = None;
    let mut last_observed_bundle_id: Option<String> = None;
    let mut last_observed_browser_title: Option<String> = None;
    let mut last_observed_browser_url: Option<String> = None;

    for event in events.iter().rev() {
        if last_observed_app_name.is_none() {
            last_observed_app_name = event.app_name.clone();
        }
        if last_observed_bundle_id.is_none() {
            last_observed_bundle_id = event.bundle_id.clone();
        }
        if last_observed_browser_title.is_none() {
            last_observed_browser_title = event.browser_title.clone();
        }
        if last_observed_browser_url.is_none() {
            last_observed_browser_url = event.browser_url.clone();
        }

        if last_observed_app_name.is_some()
            && last_observed_bundle_id.is_some()
            && last_observed_browser_title.is_some()
            && last_observed_browser_url.is_some()
        {
            break;
        }
    }

    TfAutotrackerV2NativeRecoveryState {
        schema_version: 1,
        last_persisted_at_ms: persisted_at_ms,
        last_observed_event_timestamp_ms: events.last().map(|event| event.timestamp_ms),
        last_observed_app_name,
        last_observed_bundle_id,
        last_observed_browser_title,
        last_observed_browser_url,
        sampler_status,
        events,
    }
}

fn inspect_recovery_file_at_path(
    source: &str,
    path: &PathBuf,
) -> TfAutotrackerV2NativeRecoveryPathDiagnostics {
    let metadata = fs::metadata(path).ok();
    let exists = metadata.is_some();
    let size_bytes = metadata.as_ref().map(|value| value.len());
    let modified_at_ms = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as i64);

    if !exists {
        return TfAutotrackerV2NativeRecoveryPathDiagnostics {
            source: source.to_string(),
            recovery_file_path: path.display().to_string(),
            exists: false,
            size_bytes,
            modified_at_ms,
            parsed_schema_version: None,
            events_count: None,
            last_observed_app_name: None,
            last_observed_bundle_id: None,
            last_observed_browser_title: None,
            last_observed_browser_url: None,
            read_error: None,
        };
    }

    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<TfAutotrackerV2NativeRecoveryState>(&raw) {
            Ok(state) => TfAutotrackerV2NativeRecoveryPathDiagnostics {
                source: source.to_string(),
                recovery_file_path: path.display().to_string(),
                exists: true,
                size_bytes,
                modified_at_ms,
                parsed_schema_version: Some(state.schema_version),
                events_count: Some(state.events.len()),
                last_observed_app_name: state.last_observed_app_name,
                last_observed_bundle_id: state.last_observed_bundle_id,
                last_observed_browser_title: state.last_observed_browser_title,
                last_observed_browser_url: state.last_observed_browser_url,
                read_error: None,
            },
            Err(error) => TfAutotrackerV2NativeRecoveryPathDiagnostics {
                source: source.to_string(),
                recovery_file_path: path.display().to_string(),
                exists: true,
                size_bytes,
                modified_at_ms,
                parsed_schema_version: None,
                events_count: None,
                last_observed_app_name: None,
                last_observed_bundle_id: None,
                last_observed_browser_title: None,
                last_observed_browser_url: None,
                read_error: Some(format!("Unable to parse native recovery file: {error}")),
            },
        },
        Err(error) => TfAutotrackerV2NativeRecoveryPathDiagnostics {
            source: source.to_string(),
            recovery_file_path: path.display().to_string(),
            exists: true,
            size_bytes,
            modified_at_ms,
            parsed_schema_version: None,
            events_count: None,
            last_observed_app_name: None,
            last_observed_bundle_id: None,
            last_observed_browser_title: None,
            last_observed_browser_url: None,
            read_error: Some(format!("Unable to read native recovery file: {error}")),
        },
    }
}

fn build_recovery_diagnostics(
    primary: TfAutotrackerV2NativeRecoveryPathDiagnostics,
    fallback_candidates: Vec<TfAutotrackerV2NativeRecoveryPathDiagnostics>,
) -> TfAutotrackerV2NativeRecoveryDiagnostics {
    let selected_read_source = if primary.exists {
        "primary".to_string()
    } else {
        "none".to_string()
    };
    let read_file_path = if primary.exists {
        Some(primary.recovery_file_path.clone())
    } else {
        None
    };

    let sampler = lock_sampler();
    let diagnostics = TfAutotrackerV2NativeRecoveryDiagnostics {
        source: primary.source.clone(),
        recovery_file_path: primary.recovery_file_path.clone(),
        primary_recovery_file_path: primary.recovery_file_path.clone(),
        write_file_path: primary.recovery_file_path.clone(),
        read_file_path,
        selected_read_source,
        exists: primary.exists,
        size_bytes: primary.size_bytes,
        modified_at_ms: primary.modified_at_ms,
        parsed_schema_version: primary.parsed_schema_version,
        events_count: primary.events_count,
        last_observed_app_name: primary.last_observed_app_name,
        last_observed_bundle_id: primary.last_observed_bundle_id,
        last_observed_browser_title: primary.last_observed_browser_title,
        last_observed_browser_url: primary.last_observed_browser_url,
        read_error: primary.read_error,
        fallback_candidates,
        last_write_byte_count: sampler.last_recovery_write_byte_count,
        file_exists_after_write: sampler.recovery_file_exists_after_write,
        readback_after_write_events_count: sampler.last_recovery_readback_events_count,
    };
    drop(sampler);
    diagnostics
}

fn inspect_recovery_files(
    app: &tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryDiagnostics, String> {
    let primary_path = stable_recovery_path()?;
    let primary = inspect_recovery_file_at_path("primary", &primary_path);
    let fallback_candidates = fallback_recovery_paths(app)
        .iter()
        .map(|path| inspect_recovery_file_at_path("fallback", path))
        .collect::<Vec<_>>();

    Ok(build_recovery_diagnostics(primary, fallback_candidates))
}

#[cfg(test)]
fn select_recovery_diagnostics(
    diagnostics: &[TfAutotrackerV2NativeRecoveryPathDiagnostics],
) -> Option<TfAutotrackerV2NativeRecoveryPathDiagnostics> {
    diagnostics
        .iter()
        .filter(|entry| entry.exists)
        .cloned()
        .max_by_key(|entry| {
            (
                entry.read_error.is_none(),
                entry.modified_at_ms.unwrap_or(0),
                entry.size_bytes.unwrap_or(0),
            )
        })
        .or_else(|| diagnostics.first().cloned())
}

fn read_recovery_state_from_path(
    path: &Path,
) -> Result<Option<TfAutotrackerV2NativeRecoveryState>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "Unable to read native recovery file {}: {error}",
            path.display()
        )
    })?;
    let decoded =
        serde_json::from_str::<TfAutotrackerV2NativeRecoveryState>(&raw).map_err(|error| {
            format!(
                "Unable to parse native recovery file {}: {error}",
                path.display()
            )
        })?;
    Ok(Some(decoded))
}

fn write_recovery_state(
    recovery_state: &TfAutotrackerV2NativeRecoveryState,
) -> Result<RecoveryWriteReadResult, String> {
    let path = stable_recovery_path()?;
    write_recovery_state_to_path(&path, recovery_state)
}

fn write_recovery_state_to_path(
    path: &Path,
    recovery_state: &TfAutotrackerV2NativeRecoveryState,
) -> Result<RecoveryWriteReadResult, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Unable to create native recovery directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let temp_path = path.with_extension("json.tmp");
    let encoded = serde_json::to_vec_pretty(recovery_state)
        .map_err(|error| format!("Unable to encode native recovery state: {error}"))?;
    let bytes_written = encoded.len() as u64;
    fs::write(&temp_path, encoded).map_err(|error| {
        format!(
            "Unable to write native recovery temp file {}: {error}",
            temp_path.display()
        )
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "Unable to move native recovery file into place {}: {error}",
            path.display()
        )
    })?;

    let metadata = fs::metadata(path).ok();
    let exists = metadata.is_some();
    let file_size = metadata.as_ref().map(|value| value.len());
    let readback = read_recovery_state_from_path(path);
    let (readback_events_count, read_error) = match readback {
        Ok(Some(state)) => (Some(state.events.len()), None),
        Ok(None) => (
            None,
            Some(format!(
                "Native recovery file was missing after write: {}",
                path.display()
            )),
        ),
        Err(error) => (None, Some(error)),
    };

    Ok(RecoveryWriteReadResult {
        write_path: path.to_path_buf(),
        read_path: path.to_path_buf(),
        write_ok: true,
        bytes_written,
        readback_events_count,
        exists,
        file_size,
        read_error,
    })
}

fn persist_sampler_recovery(
    sampler_status: TfAutotrackerV2NativeSamplerStatus,
    persisted_at_ms: i64,
) -> Result<(RecoveryWriteReadResult, usize), String> {
    let buffer = lock_buffer();
    let recovery_state = build_recovery_state(&buffer, sampler_status, persisted_at_ms);
    let events_count = recovery_state.events.len();
    drop(buffer);
    let result = write_recovery_state(&recovery_state)?;
    Ok((result, events_count))
}

fn read_recovery_state(
    app: &tauri::AppHandle,
) -> Result<Option<TfAutotrackerV2NativeRecoveryState>, String> {
    let diagnostics = inspect_recovery_files(app)?;
    if !diagnostics.exists {
        return Ok(None);
    }

    let path = PathBuf::from(&diagnostics.primary_recovery_file_path);
    read_recovery_state_from_path(&path)
}

fn read_recovery_diagnostics(
    app: &tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryDiagnostics, String> {
    inspect_recovery_files(app)
}

fn clear_recovery_state(
    app: &tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryClearResult, String> {
    let stable_path = stable_recovery_path()?;
    let candidates = fallback_recovery_paths(app);
    let mut deleted_paths: Vec<String> = Vec::new();
    let mut deleted_primary = false;

    if stable_path.exists() {
        fs::remove_file(&stable_path).map_err(|error| {
            format!(
                "Unable to remove native recovery file {}: {error}",
                stable_path.display()
            )
        })?;
        deleted_paths.push(stable_path.display().to_string());
        deleted_primary = true;
    }

    for path in candidates {
        if !path.exists() {
            continue;
        }

        fs::remove_file(&path).map_err(|error| {
            format!(
                "Unable to remove native recovery file {}: {error}",
                path.display()
            )
        })?;
        deleted_paths.push(path.display().to_string());
    }
    let fallback_cleanup_count =
        deleted_paths
            .len()
            .saturating_sub(if deleted_primary { 1 } else { 0 });

    Ok(TfAutotrackerV2NativeRecoveryClearResult {
        deleted: !deleted_paths.is_empty(),
        deleted_primary,
        fallback_cleanup_count,
        deleted_paths,
        recovery_file_path: stable_path.display().to_string(),
    })
}

fn current_sampler_status(_app: &tauri::AppHandle) -> TfAutotrackerV2NativeSamplerStatus {
    let buffer_count = current_buffer_count();
    let stable_path = stable_recovery_path()
        .ok()
        .map(|path| path.display().to_string());
    let mut sampler = lock_sampler();
    sampler.cleanup_finished_thread();
    if let Some(path) = stable_path {
        sampler.set_recovery_file_path(path);
    }
    sampler.status(buffer_count)
}

/// Returns true if the foreground app has changed relative to the last capture.
///
/// Prefers bundle_id for comparison. Falls back to app_name when both sides
/// lack a bundle_id. On the very first capture (last_sampled_at_ms is None)
/// with no identifiers on either side, always returns true so the event is
/// recorded rather than silently dropped.
fn foreground_changed(
    last_bundle: Option<&str>,
    last_name: Option<&str>,
    curr_bundle: Option<&str>,
    curr_name: Option<&str>,
    last_sampled_at_ms: Option<i64>,
) -> bool {
    match (last_bundle, curr_bundle) {
        (Some(prev), Some(curr)) => prev != curr,
        // One side has a bundle ID and the other doesn't — definitely changed.
        (Some(_), None) | (None, Some(_)) => true,
        // Neither side has a bundle ID — compare by app name instead.
        (None, None) => match (last_name, curr_name) {
            (Some(prev), Some(curr)) => prev != curr,
            // No identifiers at all: append on first-ever capture only.
            (None, None) => last_sampled_at_ms.is_none(),
            // One side has a name and the other doesn't — treat as changed.
            _ => true,
        },
    }
}

// ---------------------------------------------------------------------------
// macOS subprocess helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| format!("{program} not available: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{program} exited with {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    String::from_utf8(output.stdout)
        .map_err(|error| format!("{program} returned non-utf8 output: {error}"))
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn run_command(_program: &str, _args: &[&str]) -> Result<String, String> {
    Err("Native probes are only implemented for macOS in this slice.".to_string())
}

// ---------------------------------------------------------------------------
// Foreground app probe
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn parse_lsappinfo_info(
    raw: &str,
) -> Option<(Option<String>, Option<String>, Option<String>, Option<String>)> {
    let mut app_name: Option<String> = None;
    let mut bundle_id: Option<String> = None;
    let mut bundle_path: Option<String> = None;
    let mut executable_path: Option<String> = None;

    let trimmed = raw.trim_start();
    if let Some(first_line) = trimmed.lines().next() {
        if let Some(start) = first_line.find('"') {
            if let Some(end_rel) = first_line[start + 1..].find('"') {
                let candidate = &first_line[start + 1..start + 1 + end_rel];
                if !candidate.is_empty() {
                    app_name = Some(candidate.to_string());
                }
            }
        }
    }

    for line in raw.lines() {
        let line = line.trim();
        if let Some((raw_key, raw_value)) = line.split_once('=') {
            let key = raw_key.trim().replace(' ', "").to_lowercase();
            let cleaned = raw_value.trim().trim_matches('"');
            if cleaned.is_empty() {
                continue;
            }

            match key.as_str() {
                "bundleid" => bundle_id = Some(cleaned.to_string()),
                "bundlepath" => bundle_path = Some(cleaned.to_string()),
                "executablepath" => executable_path = Some(cleaned.to_string()),
                _ => {}
            }
        }
    }

    if app_name.is_none()
        && bundle_id.is_none()
        && bundle_path.is_none()
        && executable_path.is_none()
    {
        return None;
    }
    Some((app_name, bundle_id, bundle_path, executable_path))
}

#[cfg(target_os = "macos")]
fn read_foreground_app(
) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>), String> {
    // `lsappinfo info front` returns empty output on macOS 14+.
    // Reliable pattern: get ASN from `lsappinfo front`, then query `lsappinfo info <ASN>`.
    let asn_raw = run_command("/usr/bin/lsappinfo", &["front"])
        .map_err(|e| format!("lsappinfo front failed: {e}"))?;
    let asn = asn_raw.trim();
    if asn.is_empty() {
        return read_foreground_app_osascript();
    }
    let info_raw = run_command("/usr/bin/lsappinfo", &["info", asn])
        .map_err(|e| format!("lsappinfo info {asn} failed: {e}"))?;
    match parse_lsappinfo_info(&info_raw) {
        Some(result) => Ok(result),
        None => read_foreground_app_osascript()
            .map_err(|_| format!("lsappinfo info {asn} returned no parseable app data.")),
    }
}

/// osascript fallback: returns app name only (no bundle ID).
#[cfg(target_os = "macos")]
fn read_foreground_app_osascript(
) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>), String> {
    let raw = run_command(
        "/usr/bin/osascript",
        &[
            "-e",
            "tell application \"System Events\" to get name of first application process whose frontmost is true",
        ],
    )
    .map_err(|e| format!("osascript foreground fallback failed: {e}"))?;
    let name = raw.trim();
    if name.is_empty() {
        return Err("osascript returned an empty app name.".to_string());
    }
    Ok((Some(name.to_string()), None, None, None))
}

#[cfg(not(target_os = "macos"))]
fn read_foreground_app(
) -> Result<(Option<String>, Option<String>, Option<String>, Option<String>), String> {
    Err("Foreground app probe is only implemented for macOS in this slice.".to_string())
}

// ---------------------------------------------------------------------------
// Idle probe  (Part A fix: /usr/sbin/ioreg, not /usr/bin/ioreg)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn parse_idle_seconds(raw: &str) -> Option<u64> {
    const KEY: &str = "\"HIDIdleTime\"";
    for line in raw.lines() {
        // ioreg output prepends pipe/space characters before the key; search by substring.
        if let Some(pos) = line.find(KEY) {
            let rest = &line[pos + KEY.len()..];
            let value = rest.trim_start_matches(|c: char| !c.is_ascii_digit());
            let digits: String = value.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                if let Ok(nanos) = digits.parse::<u64>() {
                    return Some(nanos / 1_000_000_000);
                }
            }
        }
    }
    None
}

/// Returns the path of the first accessible `ioreg` binary.
/// macOS ships it in /usr/sbin; /usr/bin/ioreg does not exist on most installs.
#[cfg(target_os = "macos")]
fn find_ioreg() -> &'static str {
    const CANDIDATES: &[&str] = &["/usr/sbin/ioreg", "/usr/bin/ioreg", "ioreg"];
    for path in CANDIDATES {
        if std::path::Path::new(path).exists() || path == &"ioreg" {
            return path;
        }
    }
    "ioreg"
}

#[cfg(target_os = "macos")]
fn read_idle_seconds() -> Result<u64, String> {
    let ioreg = find_ioreg();
    let raw = run_command(ioreg, &["-c", "IOHIDSystem"])
        .map_err(|e| format!("ioreg ({ioreg}) failed: {e}"))?;
    parse_idle_seconds(&raw).ok_or_else(|| "ioreg did not include HIDIdleTime.".to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_idle_seconds() -> Result<u64, String> {
    Err("Idle probe is only implemented for macOS in this slice.".to_string())
}

// ---------------------------------------------------------------------------
// Browser tab probe  (Part B)
// ---------------------------------------------------------------------------

struct BrowserTabInfo {
    title: Option<String>,
    url: Option<String>,
    /// Set only when the AppleScript call failed entirely.
    error: Option<String>,
}

fn resolve_browser_tab_target(
    bundle_id: Option<&str>,
    app_name: Option<&str>,
) -> Option<(&'static str, bool)> {
    let normalized_app_name = app_name.map(|value| value.trim().to_lowercase());

    let resolve_from_bundle_id = |bundle_id: &str| match bundle_id {
        "com.google.Chrome" => Some(("Google Chrome", false)),
        "com.apple.Safari" => Some(("Safari", true)),
        "com.microsoft.edgemac" => Some(("Microsoft Edge", false)),
        "com.brave.Browser" => Some(("Brave Browser", false)),
        "com.operasoftware.Opera" => Some(("Opera", false)),
        "com.vivaldi.Vivaldi" => Some(("Vivaldi", false)),
        _ => None,
    };

    if let Some(bundle_id) = bundle_id {
        if let Some(target) = resolve_from_bundle_id(bundle_id) {
            return Some(target);
        }
    }

    let normalized_app_name = normalized_app_name.as_deref().unwrap_or_default();
    match normalized_app_name {
        "google chrome" => Some(("Google Chrome", false)),
        "safari" => Some(("Safari", true)),
        "microsoft edge" => Some(("Microsoft Edge", false)),
        "brave browser" | "brave" => Some(("Brave Browser", false)),
        "opera" => Some(("Opera", false)),
        "vivaldi" => Some(("Vivaldi", false)),
        _ => None,
    }
}

/// Returns Some(BrowserTabInfo) when bundle_id is a known browser, None otherwise.
#[cfg(target_os = "macos")]
fn try_read_browser_tab(bundle_id: Option<&str>, app_name: Option<&str>) -> Option<BrowserTabInfo> {
    let (app_name, is_safari) = resolve_browser_tab_target(bundle_id, app_name)?;

    let (title_key, tab_ref) = if is_safari {
        ("name", "current tab")
    } else {
        ("title", "active tab")
    };

    let title_script =
        format!("tell application \"{app_name}\" to get {title_key} of {tab_ref} of front window");
    let url_script =
        format!("tell application \"{app_name}\" to get URL of {tab_ref} of front window");

    let title_res = run_command("/usr/bin/osascript", &["-e", &title_script]);
    let url_res = run_command("/usr/bin/osascript", &["-e", &url_script]);

    let title = match &title_res {
        Ok(s) => {
            let t = s.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        }
        Err(_) => None,
    };
    let url = match &url_res {
        Ok(s) => {
            let u = s.trim().to_string();
            if u.is_empty() {
                None
            } else {
                Some(u)
            }
        }
        Err(_) => None,
    };

    // Only surface an error when BOTH calls failed (permission denied, app not running, etc.)
    let error = if title.is_none() && url.is_none() {
        url_res.err().or_else(|| title_res.err())
    } else {
        None
    };

    Some(BrowserTabInfo { title, url, error })
}

#[cfg(not(target_os = "macos"))]
fn try_read_browser_tab(
    _bundle_id: Option<&str>,
    _app_name: Option<&str>,
) -> Option<BrowserTabInfo> {
    None
}

fn capture_once_internal() -> NativeCaptureOutcome {
    let timestamp_ms = now_ms();
    let mut appended: Vec<TfAutotrackerV2NativeEvent> = Vec::new();
    let mut foreground_ok = false;
    let mut idle_ok = false;

    // Collect results before acquiring the lock so we hold it as briefly as possible.
    let mut foreground_event: Option<TfAutotrackerV2NativeEvent> = None;
    let mut foreground_error_event: Option<TfAutotrackerV2NativeEvent> = None;
    let mut idle_event: Option<TfAutotrackerV2NativeEvent> = None;
    let mut idle_error_event: Option<TfAutotrackerV2NativeEvent> = None;
    let mut next_bundle_id: Option<String> = None;
    let mut next_app_name: Option<String> = None;
    let mut next_idle: Option<bool> = None;
    // New browser URL captured this probe — used for URL-change dedup.
    let mut next_browser_url: Option<String> = None;

    match read_foreground_app() {
        Ok((app_name, bundle_id, bundle_path, executable_path)) => {
            foreground_ok = true;
            let mut event = make_event("untrackedFocused", timestamp_ms);
            event.app_name = app_name.clone();
            event.bundle_id = bundle_id.clone();
            event.bundle_path = bundle_path.clone();
            event.executable_path = executable_path.clone();

            // Enrich foreground event with active browser tab context.
            if let Some(tab) = try_read_browser_tab(bundle_id.as_deref(), app_name.as_deref()) {
                event.browser_title = tab.title;
                event.browser_url = tab.url.clone();
                event.browser_tab_error = tab.error;
                next_browser_url = tab.url;
            }

            next_bundle_id = bundle_id;
            next_app_name = app_name;
            foreground_event = Some(event);
        }
        Err(error) => {
            let mut event = make_event("error", timestamp_ms);
            event.error = Some(format!("foreground probe failed: {error}"));
            foreground_error_event = Some(event);
        }
    }

    match read_idle_seconds() {
        Ok(idle_secs) => {
            idle_ok = true;
            let is_idle = idle_secs >= IDLE_THRESHOLD_SECS;
            next_idle = Some(is_idle);
            let mut event = make_event("idleChanged", timestamp_ms);
            event.is_idle = Some(is_idle);
            idle_event = Some(event);
        }
        Err(error) => {
            let mut event = make_event("error", timestamp_ms);
            event.error = Some(format!("idle probe failed: {error}"));
            idle_error_event = Some(event);
        }
    }

    let observed_app_name = next_app_name.clone();
    let observed_bundle_id = next_bundle_id.clone();

    let mut buffer = lock_buffer();

    // Push probe error events into the buffer so snapshot/UI shows why capture failed.
    if let Some(event) = foreground_error_event {
        buffer.push(event.clone());
        appended.push(event);
    }
    if let Some(event) = idle_error_event {
        buffer.push(event.clone());
        appended.push(event);
    }

    if let Some(event) = foreground_event {
        let changed = foreground_changed(
            buffer.last_app_bundle_id.as_deref(),
            buffer.last_app_name.as_deref(),
            event.bundle_id.as_deref(),
            event.app_name.as_deref(),
            buffer.last_sampled_at_ms,
        );
        // Also record when the browser URL changes within the same foreground app
        // so Chrome navigation (e.g. to UWorld) is captured without an app switch.
        let browser_url_changed = !changed
            && match (&next_browser_url, &buffer.last_browser_url) {
                (Some(new_url), Some(prev_url)) => new_url != prev_url,
                (Some(_), None) => true,
                _ => false,
            };
        if changed || browser_url_changed {
            buffer.push(event.clone());
            appended.push(event);
        }
        buffer.last_app_bundle_id = next_bundle_id;
        buffer.last_app_name = next_app_name;
        // Reset last_browser_url unconditionally so it always reflects the latest probe.
        buffer.last_browser_url = next_browser_url;
    }

    if let Some(event) = idle_event {
        let idle_changed = match (buffer.last_idle, event.is_idle) {
            (None, _) => true,
            (Some(prev), Some(curr)) => prev != curr,
            _ => false,
        };
        if idle_changed {
            buffer.push(event.clone());
            appended.push(event);
        }
        buffer.last_idle = next_idle;
    }

    buffer.last_sampled_at_ms = Some(timestamp_ms);

    NativeCaptureOutcome {
        result: TfAutotrackerV2NativeCaptureResult {
            status: build_status(&buffer, foreground_ok, idle_ok),
            appended,
        },
        observed_app_name,
        observed_bundle_id,
    }
}

fn sleep_native_sampler_interval(stop_flag: &Arc<AtomicBool>) {
    let mut remaining_ms = NATIVE_SAMPLER_INTERVAL_MS;
    while remaining_ms > 0 && !stop_flag.load(Ordering::SeqCst) {
        let slice_ms = remaining_ms.min(NATIVE_SAMPLER_STOP_POLL_MS);
        thread::sleep(Duration::from_millis(slice_ms));
        remaining_ms -= slice_ms;
    }
}

fn run_native_sampler_loop(stop_flag: Arc<AtomicBool>, _app: tauri::AppHandle) {
    loop {
        if stop_flag.load(Ordering::SeqCst) {
            break;
        }

        let started_at_ms = now_ms();
        {
            let mut sampler = lock_sampler();
            sampler.record_tick_started(started_at_ms);
        }

        let outcome = capture_once_internal();
        let completed_at_ms = now_ms();

        {
            let sampler_status = {
                let mut sampler = lock_sampler();
                if let Ok(path) = stable_recovery_path() {
                    sampler.set_recovery_file_path(path.display().to_string());
                }
                sampler.record_tick_completed(&outcome, completed_at_ms);
                sampler.status(current_buffer_count())
            };

            match persist_sampler_recovery(sampler_status, completed_at_ms) {
                Ok((result, events_count)) => {
                    let mut sampler = lock_sampler();
                    sampler.record_recovery_write_success(completed_at_ms, events_count, &result);
                }
                Err(error) => {
                    let mut sampler = lock_sampler();
                    sampler.last_error = Some(error.clone());
                    sampler.record_recovery_write_error(error);
                }
            }
        }

        if stop_flag.load(Ordering::SeqCst) {
            break;
        }

        sleep_native_sampler_interval(&stop_flag);
    }

    let mut sampler = lock_sampler();
    sampler.mark_exited();
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn tf_autotracker_v2_native_probe() -> TfAutotrackerV2NativeStatus {
    let foreground_ok = if cfg!(target_os = "macos") {
        read_foreground_app().is_ok()
    } else {
        false
    };
    let idle_ok = if cfg!(target_os = "macos") {
        read_idle_seconds().is_ok()
    } else {
        false
    };

    let buffer = lock_buffer();
    build_status(&buffer, foreground_ok, idle_ok)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_snapshot() -> TfAutotrackerV2NativeSnapshot {
    let buffer = lock_buffer();
    let status = build_status(
        &buffer,
        cfg!(target_os = "macos"),
        cfg!(target_os = "macos"),
    );
    TfAutotrackerV2NativeSnapshot {
        status,
        events: buffer.events.clone(),
    }
}

#[tauri::command]
pub fn tf_autotracker_v2_native_clear_buffer() -> TfAutotrackerV2NativeStatus {
    let mut buffer = lock_buffer();
    buffer.clear();
    build_status(
        &buffer,
        cfg!(target_os = "macos"),
        cfg!(target_os = "macos"),
    )
}

#[tauri::command]
pub fn tf_autotracker_v2_native_capture_once() -> TfAutotrackerV2NativeCaptureResult {
    capture_once_internal().result
}

#[tauri::command]
pub fn tf_autotracker_v2_native_recovery_read(
    app: tauri::AppHandle,
) -> Result<Option<TfAutotrackerV2NativeRecoveryState>, String> {
    read_recovery_state(&app)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_recovery_diagnostics(
    app: tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryDiagnostics, String> {
    read_recovery_diagnostics(&app)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_recovery_clear(
    app: tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryClearResult, String> {
    clear_recovery_state(&app)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_recovery_debug_write_now(
    _app: tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeRecoveryDebugWriteResult, String> {
    let path = stable_recovery_path()?;
    let persisted_at_ms = now_ms();
    let sampler_status = {
        let mut sampler = lock_sampler();
        sampler.set_recovery_file_path(path.display().to_string());
        sampler.status(current_buffer_count())
    };
    let buffer = lock_buffer();
    let recovery_state = build_recovery_state(&buffer, sampler_status, persisted_at_ms);
    let events_count = recovery_state.events.len();
    drop(buffer);

    match write_recovery_state_to_path(&path, &recovery_state) {
        Ok(result) => {
            let mut sampler = lock_sampler();
            sampler.record_recovery_write_success(persisted_at_ms, events_count, &result);
            Ok(TfAutotrackerV2NativeRecoveryDebugWriteResult {
                write_path: result.write_path.display().to_string(),
                read_path: result.read_path.display().to_string(),
                write_ok: result.write_ok,
                write_error: None,
                bytes_written: Some(result.bytes_written),
                readback_events_count: result.readback_events_count,
                exists: result.exists,
                file_size: result.file_size,
            })
        }
        Err(error) => {
            let exists = path.exists();
            let file_size = fs::metadata(&path).ok().map(|metadata| metadata.len());
            let mut sampler = lock_sampler();
            sampler.record_recovery_write_error(error.clone());
            Ok(TfAutotrackerV2NativeRecoveryDebugWriteResult {
                write_path: path.display().to_string(),
                read_path: path.display().to_string(),
                write_ok: false,
                write_error: Some(error),
                bytes_written: None,
                readback_events_count: None,
                exists,
                file_size,
            })
        }
    }
}

#[tauri::command]
pub fn tf_autotracker_v2_native_sampler_status(
    app: tauri::AppHandle,
) -> TfAutotrackerV2NativeSamplerStatus {
    current_sampler_status(&app)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_sampler_start(
    app: tauri::AppHandle,
) -> Result<TfAutotrackerV2NativeSamplerStatus, String> {
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut sampler = lock_sampler();
        sampler.cleanup_finished_thread();
        if let Ok(path) = stable_recovery_path() {
            sampler.set_recovery_file_path(path.display().to_string());
        }
        if !sampler.begin_start(stop_flag.clone()) {
            drop(sampler);
            return Ok(current_sampler_status(&app));
        }
    }

    match thread::Builder::new()
        .name("tf-autotracker-v2-native-sampler".to_string())
        .spawn({
            let stop_flag = stop_flag.clone();
            let app = app.clone();
            move || run_native_sampler_loop(stop_flag, app)
        }) {
        Ok(handle) => {
            let mut sampler = lock_sampler();
            sampler.attach_thread_handle(handle);
            if let Ok(path) = stable_recovery_path() {
                sampler.set_recovery_file_path(path.display().to_string());
            }
            drop(sampler);
            Ok(current_sampler_status(&app))
        }
        Err(error) => {
            let mut sampler = lock_sampler();
            sampler.abort_start(format!("Failed to start native sampler: {error}"));
            Err(sampler
                .last_error
                .clone()
                .unwrap_or_else(|| "Failed to start native sampler.".to_string()))
        }
    }
}

#[tauri::command]
pub fn tf_autotracker_v2_native_sampler_stop(
    app: tauri::AppHandle,
) -> TfAutotrackerV2NativeSamplerStatus {
    let mut sampler = lock_sampler();
    sampler.cleanup_finished_thread();
    let _ = sampler.request_stop();
    drop(sampler);
    current_sampler_status(&app)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    fn sample_sampler_status() -> TfAutotrackerV2NativeSamplerStatus {
        TfAutotrackerV2NativeSamplerStatus {
            running: true,
            interval_ms: NATIVE_SAMPLER_INTERVAL_MS,
            tick_count: 7,
            last_tick_started_at_ms: Some(117_000),
            last_tick_completed_at_ms: Some(120_000),
            last_appended_count: 1,
            last_error: None,
            last_observed_app_name: Some("Safari".to_string()),
            last_observed_bundle_id: Some("com.apple.Safari".to_string()),
            buffer_count: 2,
            recovery_file_path: Some("/tmp/autotracker-v2-dev-recovery.json".to_string()),
            recovery_write_path: Some("/tmp/autotracker-v2-dev-recovery.json".to_string()),
            recovery_read_path: Some("/tmp/autotracker-v2-dev-recovery.json".to_string()),
            recovery_write_count: 3,
            last_recovery_write_at_ms: Some(120_000),
            last_recovery_write_error: None,
            last_recovery_events_count: 2,
            last_recovery_write_byte_count: Some(2048),
            last_recovery_readback_events_count: Some(2),
            recovery_file_exists_after_write: Some(true),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_lsappinfo_info_output() {
        let raw = r#""Safari" ASN:0x0-0x12345:
    bundleID="com.apple.Safari"
    bundlepath="/Applications/Safari.app"
    executablepath="/Applications/Safari.app/Contents/MacOS/Safari"
"#;
        let parsed = parse_lsappinfo_info(raw).expect("should parse");
        assert_eq!(parsed.0.as_deref(), Some("Safari"));
        assert_eq!(parsed.1.as_deref(), Some("com.apple.Safari"));
        assert_eq!(parsed.2.as_deref(), Some("/Applications/Safari.app"));
        assert_eq!(
            parsed.3.as_deref(),
            Some("/Applications/Safari.app/Contents/MacOS/Safari")
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_idle_seconds_from_ioreg() {
        let raw = "    | | |   \"HIDIdleTime\" = 4482837958\n";
        let parsed = parse_idle_seconds(raw).expect("should parse");
        assert_eq!(parsed, 4);
    }

    #[test]
    fn buffer_caps_at_max_len() {
        let mut buf = NativeBuffer::new();
        for i in 0..(MAX_BUFFER_LEN + 50) {
            let mut event = make_event("untrackedFocused", i as i64);
            event.app_name = Some(format!("app-{i}"));
            buf.push(event);
        }
        assert_eq!(buf.events.len(), MAX_BUFFER_LEN);
        let first = &buf.events[0];
        assert_eq!(first.app_name.as_deref(), Some("app-50"));
    }

    #[test]
    fn foreground_changed_by_bundle_id() {
        assert!(foreground_changed(
            Some("com.apple.Safari"),
            Some("Safari"),
            Some("net.ankiweb.dtop"),
            Some("Anki"),
            Some(1000),
        ));
        assert!(!foreground_changed(
            Some("com.apple.Safari"),
            Some("Safari"),
            Some("com.apple.Safari"),
            Some("Safari"),
            Some(1000),
        ));
    }

    #[test]
    fn foreground_changed_by_app_name_fallback() {
        assert!(foreground_changed(
            None,
            Some("Safari"),
            None,
            Some("Anki"),
            Some(1000)
        ));
        assert!(!foreground_changed(
            None,
            Some("Anki"),
            None,
            Some("Anki"),
            Some(1000),
        ));
    }

    #[test]
    fn foreground_changed_first_capture_no_ids() {
        assert!(foreground_changed(None, None, None, None, None));
        assert!(!foreground_changed(None, None, None, None, Some(1000)));
    }

    #[test]
    fn foreground_changed_mixed_bundle_id_presence() {
        assert!(foreground_changed(
            Some("com.apple.Safari"),
            Some("Safari"),
            None,
            Some("Anki"),
            Some(1000),
        ));
        assert!(foreground_changed(
            None,
            Some("Anki"),
            Some("com.apple.Safari"),
            Some("Safari"),
            Some(1000),
        ));
    }

    #[test]
    fn resolve_browser_tab_target_falls_back_to_known_app_name() {
        assert_eq!(
            resolve_browser_tab_target(None, Some("Google Chrome")),
            Some(("Google Chrome", false))
        );
        assert_eq!(
            resolve_browser_tab_target(None, Some("Safari")),
            Some(("Safari", true))
        );
        assert_eq!(
            resolve_browser_tab_target(Some("com.google.Chrome"), None),
            Some(("Google Chrome", false))
        );
    }

    #[test]
    fn sampler_status_defaults_to_stopped() {
        let state = NativeSamplerState::new();
        let status = state.status(0);

        assert!(!status.running);
        assert_eq!(status.interval_ms, NATIVE_SAMPLER_INTERVAL_MS);
        assert_eq!(status.tick_count, 0);
        assert_eq!(status.buffer_count, 0);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn sampler_duplicate_start_is_guarded() {
        let mut state = NativeSamplerState::new();
        let stop_flag = Arc::new(AtomicBool::new(false));

        assert!(state.begin_start(stop_flag.clone()));
        assert!(!state.begin_start(stop_flag));
        assert!(state.status(3).running);
        assert_eq!(state.status(3).buffer_count, 3);
    }

    #[test]
    fn sampler_stop_signal_flips_state() {
        let mut state = NativeSamplerState::new();
        let stop_flag = Arc::new(AtomicBool::new(false));
        assert!(state.begin_start(stop_flag.clone()));

        let signaled = state.request_stop();
        assert!(signaled);
        assert!(stop_flag.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!state.status(0).running);
    }

    #[test]
    fn deterministic_recovery_path_uses_macos_application_support_bundle_dir() {
        let path = deterministic_recovery_path_for_home(Path::new("/Users/paul"));

        assert_eq!(
            path,
            PathBuf::from(
                "/Users/paul/Library/Application Support/com.paul.step2ckcommandcenter/autotracker-v2-dev-recovery.json",
            ),
        );
    }

    #[test]
    fn recovery_payload_write_readback_round_trip_reports_file_metadata() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join(RECOVERY_FILE_NAME);
        let recovery = TfAutotrackerV2NativeRecoveryState {
            schema_version: 1,
            last_persisted_at_ms: 123_456,
            last_observed_event_timestamp_ms: Some(120_000),
            last_observed_app_name: Some("Safari".to_string()),
            last_observed_bundle_id: Some("com.apple.Safari".to_string()),
            last_observed_browser_title: Some("UWorld".to_string()),
            last_observed_browser_url: Some("https://apps.uworld.com/courseapp/step2".to_string()),
            sampler_status: sample_sampler_status(),
            events: vec![make_event("targetFocused", 100_000)],
        };

        let result = write_recovery_state_to_path(&path, &recovery).expect("write/readback");
        let restored = read_recovery_state_from_path(&path)
            .expect("read recovery")
            .expect("recovery exists");

        assert_eq!(result.write_path, path);
        assert_eq!(result.read_path, result.write_path);
        assert!(result.write_ok);
        assert!(result.bytes_written > 0);
        assert!(result.exists);
        assert_eq!(result.file_size, Some(result.bytes_written));
        assert_eq!(result.readback_events_count, Some(1));
        assert_eq!(result.read_error, None);
        assert_eq!(restored.events.len(), 1);
        assert_eq!(
            restored.last_observed_browser_title.as_deref(),
            Some("UWorld")
        );
    }

    #[test]
    fn recovery_state_json_round_trip_preserves_schema_and_recent_events() {
        let recovery = TfAutotrackerV2NativeRecoveryState {
            schema_version: 1,
            last_persisted_at_ms: 123_456,
            last_observed_event_timestamp_ms: Some(120_000),
            last_observed_app_name: Some("Safari".to_string()),
            last_observed_bundle_id: Some("com.apple.Safari".to_string()),
            last_observed_browser_title: Some("UWorld".to_string()),
            last_observed_browser_url: Some("https://apps.uworld.com/courseapp/step2".to_string()),
            sampler_status: sample_sampler_status(),
            events: vec![
                TfAutotrackerV2NativeEvent {
                    id: "event-1".to_string(),
                    kind: "targetFocused".to_string(),
                    timestamp_ms: 100_000,
                    platform: PLATFORM_LABEL.to_string(),
                    app_name: Some("Safari".to_string()),
                    bundle_id: Some("com.apple.Safari".to_string()),
                    bundle_path: Some("/Applications/Safari.app".to_string()),
                    executable_path: Some("/Applications/Safari.app/Contents/MacOS/Safari".to_string()),
                    window_title: None,
                    is_idle: None,
                    browser_title: Some("UWorld".to_string()),
                    browser_url: Some("https://apps.uworld.com/courseapp/step2".to_string()),
                    browser_tab_error: None,
                    error: None,
                },
                TfAutotrackerV2NativeEvent {
                    id: "event-2".to_string(),
                    kind: "untrackedFocused".to_string(),
                    timestamp_ms: 120_000,
                    platform: PLATFORM_LABEL.to_string(),
                    app_name: Some("Safari".to_string()),
                    bundle_id: Some("com.apple.Safari".to_string()),
                    bundle_path: Some("/Applications/Safari.app".to_string()),
                    executable_path: Some("/Applications/Safari.app/Contents/MacOS/Safari".to_string()),
                    window_title: None,
                    is_idle: None,
                    browser_title: Some("Reddit".to_string()),
                    browser_url: Some("https://www.reddit.com/r/medicine".to_string()),
                    browser_tab_error: None,
                    error: None,
                },
            ],
        };

        let json = serde_json::to_string(&recovery).expect("serialize recovery");
        let restored: TfAutotrackerV2NativeRecoveryState =
            serde_json::from_str(&json).expect("deserialize recovery");

        assert_eq!(restored.schema_version, 1);
        assert_eq!(restored.last_persisted_at_ms, 123_456);
        assert_eq!(
            restored.last_observed_browser_title.as_deref(),
            Some("UWorld")
        );
        assert_eq!(restored.sampler_status.tick_count, 7);
        assert_eq!(restored.events.len(), 2);
        assert_eq!(
            restored.events[1].browser_url.as_deref(),
            Some("https://www.reddit.com/r/medicine")
        );
    }

    #[test]
    fn inspect_recovery_file_reports_metadata_and_parsed_counts() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join(RECOVERY_FILE_NAME);
        let recovery = TfAutotrackerV2NativeRecoveryState {
            schema_version: 1,
            last_persisted_at_ms: 123_456,
            last_observed_event_timestamp_ms: Some(120_000),
            last_observed_app_name: Some("Safari".to_string()),
            last_observed_bundle_id: Some("com.apple.Safari".to_string()),
            last_observed_browser_title: Some("UWorld".to_string()),
            last_observed_browser_url: Some("https://apps.uworld.com/courseapp/step2".to_string()),
            sampler_status: sample_sampler_status(),
            events: vec![make_event("targetFocused", 100_000)],
        };
        fs::write(&path, serde_json::to_vec(&recovery).expect("serialize")).expect("write");

        let diagnostics = inspect_recovery_file_at_path("primary", &path);
        assert!(diagnostics.exists);
        assert_eq!(diagnostics.parsed_schema_version, Some(1));
        assert_eq!(diagnostics.events_count, Some(1));
        assert_eq!(
            diagnostics.last_observed_browser_title.as_deref(),
            Some("UWorld")
        );
        assert_eq!(diagnostics.read_error, None);
    }

    #[test]
    fn select_recovery_diagnostics_prefers_newest_parseable_file() {
        let temp = tempdir().expect("tempdir");
        let first_path = temp.path().join("first.json");
        let second_path = temp.path().join("second.json");
        fs::write(&first_path, b"{ not-json").expect("write first");
        std::thread::sleep(Duration::from_millis(5));

        let recovery = TfAutotrackerV2NativeRecoveryState {
            schema_version: 1,
            last_persisted_at_ms: 456_789,
            last_observed_event_timestamp_ms: Some(150_000),
            last_observed_app_name: Some("Google Chrome".to_string()),
            last_observed_bundle_id: Some("com.google.Chrome".to_string()),
            last_observed_browser_title: Some("Reddit".to_string()),
            last_observed_browser_url: Some("https://www.reddit.com/r/medicine".to_string()),
            sampler_status: sample_sampler_status(),
            events: vec![make_event("untrackedFocused", 150_000)],
        };
        fs::write(
            &second_path,
            serde_json::to_vec(&recovery).expect("serialize"),
        )
        .expect("write second");

        let selected = select_recovery_diagnostics(&[
            inspect_recovery_file_at_path("fallback", &first_path),
            inspect_recovery_file_at_path("fallback", &second_path),
        ])
        .expect("selected");

        assert_eq!(
            selected.recovery_file_path,
            second_path.display().to_string()
        );
        assert_eq!(selected.read_error, None);
        assert_eq!(selected.events_count, Some(1));
    }
}
