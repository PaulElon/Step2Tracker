// Auto-Tracker V2 native event source — shadow/buffer only.
//
// This module observes the local desktop and produces V2-compatible
// normalized events into an in-memory ring buffer. It does NOT feed
// the V2 reducer, does NOT persist anything, and does NOT spawn any
// background polling thread. Sampling is on-demand via the
// `tf_autotracker_v2_native_capture_once` command.

#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "macos")]
use std::process::Stdio;
use std::sync::Mutex;
use std::time::SystemTime;
#[cfg(target_os = "macos")]
use std::time::Duration;

use serde::Serialize;
use uuid::Uuid;
#[cfg(target_os = "macos")]
use wait_timeout::ChildExt;

const PLATFORM_LABEL: &str = "macos";
const MAX_BUFFER_LEN: usize = 2_000;
const IDLE_THRESHOLD_SECS: u64 = 60;
const COMMAND_TIMEOUT_MS: u64 = 1_000;
const COMMAND_TIMEOUT_NOTE: &str =
    "lsappinfo/ioreg run with a short timeout and return promptly on macOS";

// ---------------------------------------------------------------------------
// Event and status types
// ---------------------------------------------------------------------------

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
        window_title: None,
        is_idle: None,
        browser_title: None,
        browser_url: None,
        browser_tab_error: None,
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

// ---------------------------------------------------------------------------
// macOS subprocess helpers
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("{program} not available: {error}"))?;

    match child.wait_timeout(Duration::from_millis(COMMAND_TIMEOUT_MS)) {
        Ok(Some(_status)) => {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("{program} output failed: {error}"))?;
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
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("{program} timed out after {COMMAND_TIMEOUT_MS}ms"))
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!("{program} wait failed: {error}"))
        }
    }
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
fn read_foreground_app_osascript() -> Result<(Option<String>, Option<String>), String> {
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
    Ok((Some(name.to_string()), None))
}

#[cfg(not(target_os = "macos"))]
fn read_foreground_app() -> Result<(Option<String>, Option<String>), String> {
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
    parse_idle_seconds(&raw)
        .ok_or_else(|| "ioreg did not include HIDIdleTime.".to_string())
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

/// Returns Some(BrowserTabInfo) when bundle_id is a known browser, None otherwise.
#[cfg(target_os = "macos")]
fn try_read_browser_tab(bundle_id: &str) -> Option<BrowserTabInfo> {
    // (bundle_id, applescript_app_name, is_safari)
    let (app_name, is_safari): (&str, bool) = match bundle_id {
        "com.google.Chrome" => ("Google Chrome", false),
        "com.apple.Safari" => ("Safari", true),
        "com.microsoft.edgemac" => ("Microsoft Edge", false),
        "com.brave.Browser" => ("Brave Browser", false),
        "com.operasoftware.Opera" => ("Opera", false),
        "com.vivaldi.Vivaldi" => ("Vivaldi", false),
        _ => return None,
    };

    let (title_key, tab_ref) = if is_safari {
        ("name", "current tab")
    } else {
        ("title", "active tab")
    };

    let title_script = format!(
        "tell application \"{app_name}\" to get {title_key} of {tab_ref} of front window"
    );
    let url_script = format!(
        "tell application \"{app_name}\" to get URL of {tab_ref} of front window"
    );

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
fn try_read_browser_tab(_bundle_id: &str) -> Option<BrowserTabInfo> {
    None
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
    // New browser URL captured this probe — used for URL-change dedup.
    let mut next_browser_url: Option<String> = None;

    match read_foreground_app() {
        Ok((app_name, bundle_id)) => {
            foreground_ok = true;
            let mut event = make_event("untrackedFocused", timestamp_ms);
            event.app_name = app_name.clone();
            event.bundle_id = bundle_id.clone();

            // Enrich foreground event with active browser tab context.
            if let Some(bid) = &bundle_id {
                if let Some(tab) = try_read_browser_tab(bid) {
                    event.browser_title = tab.title;
                    event.browser_url = tab.url.clone();
                    event.browser_tab_error = tab.error;
                    next_browser_url = tab.url;
                }
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
        // Also record when the browser URL changes within the same foreground app
        // so Chrome navigation (e.g. to UWorld) is captured without an app switch.
        let browser_url_changed = !changed && match (&next_browser_url, &buffer.last_browser_url) {
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

    TfAutotrackerV2NativeCaptureResult {
        status: build_status(&buffer, foreground_ok, idle_ok),
        appended,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
}
