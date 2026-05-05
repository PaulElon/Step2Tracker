// Auto-Tracker V2 native event source — shadow/buffer only.
//
// This module observes the local desktop and produces V2-compatible
// normalized events into an in-memory ring buffer. It does NOT feed
// the V2 reducer, does NOT persist anything, and does NOT spawn any
// background polling thread. Sampling is on-demand via the
// `tf_autotracker_v2_native_capture_once` command.

#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;
use uuid::Uuid;

const PLATFORM_LABEL: &str = "macos";
const MAX_BUFFER_LEN: usize = 2_000;
const IDLE_THRESHOLD_SECS: u64 = 60;
const COMMAND_TIMEOUT_NOTE: &str =
    "lsappinfo/ioreg run synchronously and return promptly on macOS";

#[derive(Debug, Clone, Serialize)]
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
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_idle: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeSnapshot {
    pub status: TfAutotrackerV2NativeStatus,
    pub events: Vec<TfAutotrackerV2NativeEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerV2NativeCaptureResult {
    pub status: TfAutotrackerV2NativeStatus,
    pub appended: Vec<TfAutotrackerV2NativeEvent>,
}

struct NativeBuffer {
    events: Vec<TfAutotrackerV2NativeEvent>,
    last_sampled_at_ms: Option<i64>,
    last_app_bundle_id: Option<String>,
    /// Fallback dedup key used when bundle_id is absent for both old and new app.
    last_app_name: Option<String>,
    last_idle: Option<bool>,
}

impl NativeBuffer {
    const fn new() -> Self {
        Self {
            events: Vec::new(),
            last_sampled_at_ms: None,
            last_app_bundle_id: None,
            last_app_name: None,
            last_idle: None,
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
    }
}

static BUFFER: Mutex<NativeBuffer> = Mutex::new(NativeBuffer::new());

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
        window_title: None,
        is_idle: None,
        error: None,
    }
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
    Err("Native foreground probe is only implemented for macOS in this slice.".to_string())
}

#[cfg(target_os = "macos")]
fn parse_lsappinfo_info(raw: &str) -> Option<(Option<String>, Option<String>)> {
    let mut app_name: Option<String> = None;
    let mut bundle_id: Option<String> = None;

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
        if let Some(rest) = line.strip_prefix("bundleID=") {
            let cleaned = rest.trim().trim_matches('"');
            if !cleaned.is_empty() {
                bundle_id = Some(cleaned.to_string());
                break;
            }
        }
    }

    if app_name.is_none() && bundle_id.is_none() {
        return None;
    }
    Some((app_name, bundle_id))
}

#[cfg(target_os = "macos")]
fn read_foreground_app() -> Result<(Option<String>, Option<String>), String> {
    let raw = run_command("/usr/bin/lsappinfo", &["info", "front"])?;
    parse_lsappinfo_info(&raw)
        .ok_or_else(|| "lsappinfo returned no parseable foreground app data.".to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_foreground_app() -> Result<(Option<String>, Option<String>), String> {
    Err("Foreground app probe is only implemented for macOS in this slice.".to_string())
}

#[cfg(target_os = "macos")]
fn parse_idle_seconds(raw: &str) -> Option<u64> {
    for line in raw.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("\"HIDIdleTime\"") {
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

#[cfg(target_os = "macos")]
fn read_idle_seconds() -> Result<u64, String> {
    let raw = run_command("/usr/bin/ioreg", &["-c", "IOHIDSystem"])?;
    parse_idle_seconds(&raw)
        .ok_or_else(|| "ioreg did not include HIDIdleTime.".to_string())
}

#[cfg(not(target_os = "macos"))]
fn read_idle_seconds() -> Result<u64, String> {
    Err("Idle probe is only implemented for macOS in this slice.".to_string())
}

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

    let buffer = match BUFFER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    build_status(&buffer, foreground_ok, idle_ok)
}

#[tauri::command]
pub fn tf_autotracker_v2_native_snapshot() -> TfAutotrackerV2NativeSnapshot {
    let buffer = match BUFFER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let status =
        build_status(&buffer, cfg!(target_os = "macos"), cfg!(target_os = "macos"));
    TfAutotrackerV2NativeSnapshot {
        status,
        events: buffer.events.clone(),
    }
}

#[tauri::command]
pub fn tf_autotracker_v2_native_clear_buffer() -> TfAutotrackerV2NativeStatus {
    let mut buffer = match BUFFER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    buffer.clear();
    build_status(&buffer, cfg!(target_os = "macos"), cfg!(target_os = "macos"))
}

#[tauri::command]
pub fn tf_autotracker_v2_native_capture_once() -> TfAutotrackerV2NativeCaptureResult {
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

    match read_foreground_app() {
        Ok((app_name, bundle_id)) => {
            foreground_ok = true;
            let mut event = make_event("untrackedFocused", timestamp_ms);
            event.app_name = app_name.clone();
            event.bundle_id = bundle_id.clone();
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

    let mut buffer = match BUFFER.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

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
        if changed {
            buffer.push(event.clone());
            appended.push(event);
        }
        buffer.last_app_bundle_id = next_bundle_id;
        buffer.last_app_name = next_app_name;
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

    TfAutotrackerV2NativeCaptureResult {
        status: build_status(&buffer, foreground_ok, idle_ok),
        appended,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_lsappinfo_info_output() {
        let raw = r#""Safari" ASN:0x0-0x12345:
    bundleID="com.apple.Safari"
    bundle path="/Applications/Safari.app"
"#;
        let parsed = parse_lsappinfo_info(raw).expect("should parse");
        assert_eq!(parsed.0.as_deref(), Some("Safari"));
        assert_eq!(parsed.1.as_deref(), Some("com.apple.Safari"));
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
        // No bundle IDs — falls back to app name comparison.
        assert!(foreground_changed(None, Some("Safari"), None, Some("Anki"), Some(1000)));
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
        // Neither side has any identifier — first capture (last_sampled_at_ms = None) → true.
        assert!(foreground_changed(None, None, None, None, None));
        // Subsequent capture with no ids → false (same unknown app, no reason to re-record).
        assert!(!foreground_changed(None, None, None, None, Some(1000)));
    }

    #[test]
    fn foreground_changed_mixed_bundle_id_presence() {
        // Old had bundle ID, new doesn't — treat as changed.
        assert!(foreground_changed(
            Some("com.apple.Safari"),
            Some("Safari"),
            None,
            Some("Anki"),
            Some(1000),
        ));
        // New has bundle ID, old didn't — treat as changed.
        assert!(foreground_changed(
            None,
            Some("Anki"),
            Some("com.apple.Safari"),
            Some("Safari"),
            Some(1000),
        ));
    }
}
