use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use chrono::{SecondsFormat, Utc};
use serde::Serialize;
use serde_json::Value;

const AUTOTRACKER_HOST: &str = "127.0.0.1";
const AUTOTRACKER_PORT: u16 = 46461;
const AUTOTRACKER_PATH: &str = "/v1/bootstrap";
const AUTOTRACKER_ORIGIN: &str = "https://app.timefol.io";
const AUTOTRACKER_TIMEOUT_MS: u64 = 800;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAutotrackerBootstrapProbe {
    pub detected: bool,
    pub installed: bool,
    pub paired: bool,
    pub platform: Option<String>,
    pub stream_port: Option<i64>,
    pub base_path: Option<String>,
    pub app_version: Option<String>,
    pub device_id: Option<String>,
    pub pending_user_code: Option<String>,
    pub pending_verification_url: Option<String>,
    pub pending_transfer_device_id: Option<String>,
    pub pending_replace_device_id: Option<String>,
    pub last_pairing_error: Option<String>,
    pub accessibility: Option<String>,
    pub browser_automation: Option<String>,
    pub closed_span_count: i64,
    pub has_open_span: bool,
    pub last_checked_iso: String,
    pub error: Option<String>,
}

impl TfAutotrackerBootstrapProbe {
    fn offline(error: String) -> Self {
        Self {
            detected: false,
            installed: false,
            paired: false,
            platform: None,
            stream_port: None,
            base_path: None,
            app_version: None,
            device_id: None,
            pending_user_code: None,
            pending_verification_url: None,
            pending_transfer_device_id: None,
            pending_replace_device_id: None,
            last_pairing_error: None,
            accessibility: None,
            browser_automation: None,
            closed_span_count: 0,
            has_open_span: false,
            last_checked_iso: now_iso(),
            error: Some(error),
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn safe_bool(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

fn safe_i64(value: Option<&Value>) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(0)
}

fn safe_optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToOwned::to_owned)
}

fn safe_status_text(value: Option<&Value>) -> Option<String> {
    let Some(value) = value else {
        return None;
    };

    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }

    if let Some(flag) = value.as_bool() {
        return Some(if flag { "enabled" } else { "disabled" }.to_string());
    }

    if let Some(object) = value.as_object() {
        if let Some(status) = object.get("status").and_then(Value::as_str) {
            return Some(status.to_owned());
        }

        if let Some(state) = object.get("state").and_then(Value::as_str) {
            return Some(state.to_owned());
        }

        if let Some(enabled) = object.get("enabled").and_then(Value::as_bool) {
            return Some(if enabled { "enabled" } else { "disabled" }.to_string());
        }

        return Some("available".to_string());
    }

    None
}

fn decode_chunked_body(body: &[u8]) -> Result<Vec<u8>, String> {
    let mut cursor = 0usize;
    let mut decoded = Vec::new();

    while cursor < body.len() {
        let Some(size_line_end_rel) = body[cursor..].windows(2).position(|entry| entry == b"\r\n") else {
            return Err("Invalid chunked response: missing chunk size line ending".to_string());
        };
        let size_line_end = cursor + size_line_end_rel;
        let size_line = std::str::from_utf8(&body[cursor..size_line_end])
            .map_err(|_| "Invalid chunked response: non-utf8 chunk size".to_string())?;
        let size_hex = size_line.split(';').next().unwrap_or_default().trim();
        let chunk_size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "Invalid chunked response: malformed chunk size".to_string())?;

        cursor = size_line_end + 2;
        if chunk_size == 0 {
            break;
        }

        let chunk_end = cursor.saturating_add(chunk_size);
        if chunk_end + 2 > body.len() {
            return Err("Invalid chunked response: truncated chunk".to_string());
        }

        decoded.extend_from_slice(&body[cursor..chunk_end]);
        cursor = chunk_end + 2;
    }

    Ok(decoded)
}

fn probe_bootstrap_payload() -> Result<Value, String> {
    let timeout = Duration::from_millis(AUTOTRACKER_TIMEOUT_MS);
    let socket = SocketAddr::from(([127, 0, 0, 1], AUTOTRACKER_PORT));
    let mut stream = TcpStream::connect_timeout(&socket, timeout)
        .map_err(|error| format!("Auto-Tracker is offline: {error}"))?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| format!("Unable to set Auto-Tracker read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| format!("Unable to set Auto-Tracker write timeout: {error}"))?;

    let request = format!(
        "GET {AUTOTRACKER_PATH} HTTP/1.1\r\nHost: {AUTOTRACKER_HOST}:{AUTOTRACKER_PORT}\r\nOrigin: {AUTOTRACKER_ORIGIN}\r\nConnection: close\r\nAccept: application/json\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("Unable to probe Auto-Tracker bootstrap endpoint: {error}"))?;

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| format!("Unable to read Auto-Tracker bootstrap response: {error}"))?;

    let Some(header_end) = response.windows(4).position(|entry| entry == b"\r\n\r\n") else {
        return Err("Auto-Tracker bootstrap response was missing HTTP headers".to_string());
    };

    let header_bytes = &response[..header_end];
    let mut body = response[(header_end + 4)..].to_vec();

    let header_text = String::from_utf8_lossy(header_bytes);
    let mut lines = header_text.lines();
    let status_line = lines
        .next()
        .ok_or_else(|| "Auto-Tracker bootstrap response was missing status line".to_string())?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|part| part.parse::<u16>().ok())
        .ok_or_else(|| "Auto-Tracker bootstrap response had an invalid HTTP status".to_string())?;

    let is_chunked = lines.any(|line| {
        let line = line.trim().to_ascii_lowercase();
        line.starts_with("transfer-encoding:") && line.contains("chunked")
    });

    if is_chunked {
        body = decode_chunked_body(&body)?;
    }

    if !(200..300).contains(&status_code) {
        let snippet = String::from_utf8_lossy(&body);
        let snippet = snippet.trim();
        let suffix = if snippet.is_empty() {
            String::new()
        } else {
            format!(": {snippet}")
        };
        return Err(format!(
            "Auto-Tracker bootstrap returned HTTP {status_code}{suffix}"
        ));
    }

    serde_json::from_slice::<Value>(&body)
        .map_err(|error| format!("Auto-Tracker bootstrap returned invalid JSON: {error}"))
}

fn normalize_probe(payload: Value) -> TfAutotrackerBootstrapProbe {
    let object = payload.as_object();

    TfAutotrackerBootstrapProbe {
        detected: object
            .and_then(|entry| entry.get("detected"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        installed: safe_bool(object.and_then(|entry| entry.get("installed"))),
        paired: safe_bool(object.and_then(|entry| entry.get("paired"))),
        platform: safe_optional_string(object.and_then(|entry| entry.get("platform"))),
        stream_port: object
            .and_then(|entry| entry.get("streamPort"))
            .and_then(Value::as_i64),
        base_path: safe_optional_string(object.and_then(|entry| entry.get("basePath"))),
        app_version: safe_optional_string(object.and_then(|entry| entry.get("appVersion"))),
        device_id: safe_optional_string(object.and_then(|entry| entry.get("deviceId"))),
        pending_user_code: safe_optional_string(object.and_then(|entry| entry.get("pendingUserCode"))),
        pending_verification_url: safe_optional_string(
            object.and_then(|entry| entry.get("pendingVerificationUrl")),
        ),
        pending_transfer_device_id: safe_optional_string(
            object.and_then(|entry| entry.get("pendingTransferDeviceId")),
        ),
        pending_replace_device_id: safe_optional_string(
            object.and_then(|entry| entry.get("pendingReplaceDeviceId")),
        ),
        last_pairing_error: safe_optional_string(object.and_then(|entry| entry.get("lastPairingError"))),
        accessibility: safe_status_text(object.and_then(|entry| entry.get("accessibility"))),
        browser_automation: safe_status_text(object.and_then(|entry| entry.get("browserAutomation"))),
        closed_span_count: safe_i64(object.and_then(|entry| entry.get("closedSpanCount"))),
        has_open_span: safe_bool(object.and_then(|entry| entry.get("hasOpenSpan"))),
        last_checked_iso: now_iso(),
        error: None,
    }
}

#[tauri::command]
pub fn tf_autotracker_probe_bootstrap() -> TfAutotrackerBootstrapProbe {
    match probe_bootstrap_payload() {
        Ok(payload) => normalize_probe(payload),
        Err(error) => TfAutotrackerBootstrapProbe::offline(error),
    }
}
