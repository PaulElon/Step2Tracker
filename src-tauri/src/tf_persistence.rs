use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const TF_PERSISTENCE_DIR: &str = "timefolio-persistence";
const TF_STATE_FILE: &str = "tf-state.json";
const TF_STATE_VERSION: i64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfSessionLog {
    pub id: String,
    pub date: String,
    pub method: String,
    pub method_key: String,
    pub hours: f64,
    #[serde(rename = "startISO")]
    pub start_iso: String,
    #[serde(rename = "endISO")]
    pub end_iso: String,
    pub notes: String,
    pub is_distraction: bool,
    pub is_live: bool,
}

impl Default for TfSessionLog {
    fn default() -> Self {
        Self {
            id: String::new(),
            date: String::new(),
            method: String::new(),
            method_key: String::new(),
            hours: 0.0,
            start_iso: String::new(),
            end_iso: String::new(),
            notes: String::new(),
            is_distraction: false,
            is_live: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfSummaryMetrics {
    pub streak: f64,
    pub study_hours: f64,
    pub focus_rate: f64,
    pub top_method: String,
}

impl Default for TfSummaryMetrics {
    fn default() -> Self {
        Self {
            streak: 0.0,
            study_hours: 0.0,
            focus_rate: 0.0,
            top_method: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TfSummaryKind {
    #[default]
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfSummaryPayload {
    pub id: String,
    pub kind: TfSummaryKind,
    pub label: String,
    #[serde(rename = "generatedAtISO")]
    pub generated_at_iso: String,
    pub voice: String,
    pub text: String,
    pub caption: String,
    pub metrics: TfSummaryMetrics,
}

impl Default for TfSummaryPayload {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: TfSummaryKind::Daily,
            label: String::new(),
            generated_at_iso: String::new(),
            voice: String::new(),
            text: String::new(),
            caption: String::new(),
            metrics: TfSummaryMetrics::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TfTrackerPrefs {
    pub custom_auto_apps: Vec<String>,
    pub custom_auto_websites: Vec<String>,
    pub custom_distraction_apps: Vec<String>,
    pub custom_distraction_websites: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum TfPlanTier {
    #[default]
    Free,
    Pro,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAccountState {
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub username: Option<String>,
    pub email_verified: bool,
    pub sync_id: Option<String>,
    pub plan_tier: TfPlanTier,
    pub theme_unlocks: Vec<String>,
    pub billing_customer_id: Option<String>,
}

impl Default for TfAccountState {
    fn default() -> Self {
        Self {
            user_id: None,
            email: None,
            username: None,
            email_verified: false,
            sync_id: None,
            plan_tier: TfPlanTier::Free,
            theme_unlocks: Vec::new(),
            billing_customer_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfAppState {
    pub tf_version: i64,
    pub session_logs: Vec<TfSessionLog>,
    pub summaries: Vec<TfSummaryPayload>,
    pub tracker_prefs: TfTrackerPrefs,
    pub account: Option<TfAccountState>,
}

impl Default for TfAppState {
    fn default() -> Self {
        Self {
            tf_version: TF_STATE_VERSION,
            session_logs: Vec::new(),
            summaries: Vec::new(),
            tracker_prefs: TfTrackerPrefs::default(),
            account: None,
        }
    }
}

fn tf_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir
        .join(TF_PERSISTENCE_DIR)
        .join(TF_STATE_FILE))
}

fn safe_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn safe_optional_string(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(ToOwned::to_owned)
}

fn safe_bool(value: Option<&Value>) -> bool {
    value.and_then(Value::as_bool).unwrap_or(false)
}

fn safe_f64(value: Option<&Value>) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(0.0)
}

fn safe_i64(value: Option<&Value>, fallback: i64) -> i64 {
    value.and_then(Value::as_i64).unwrap_or(fallback)
}

fn safe_string_array(value: Option<&Value>) -> Vec<String> {
    match value.and_then(Value::as_array) {
        Some(values) => values
            .iter()
            .filter_map(|entry| entry.as_str().map(ToOwned::to_owned))
            .collect(),
        None => Vec::new(),
    }
}

fn normalize_session(value: &Value) -> Option<TfSessionLog> {
    let object = value.as_object()?;
    let id = safe_string(object.get("id"));
    if id.is_empty() {
        return None;
    }

    Some(TfSessionLog {
        id,
        date: safe_string(object.get("date")),
        method: safe_string(object.get("method")),
        method_key: safe_string(object.get("methodKey")),
        hours: safe_f64(object.get("hours")),
        start_iso: safe_string(object.get("startISO")),
        end_iso: safe_string(object.get("endISO")),
        notes: safe_string(object.get("notes")),
        is_distraction: safe_bool(object.get("isDistraction")),
        is_live: safe_bool(object.get("isLive")),
    })
}

fn normalize_summary_kind(value: Option<&Value>) -> TfSummaryKind {
    match value.and_then(Value::as_str) {
        Some("weekly") => TfSummaryKind::Weekly,
        Some("monthly") => TfSummaryKind::Monthly,
        _ => TfSummaryKind::Daily,
    }
}

fn normalize_summary_metrics(value: Option<&Value>) -> TfSummaryMetrics {
    let object = value.and_then(Value::as_object);
    TfSummaryMetrics {
        streak: safe_f64(object.and_then(|entry| entry.get("streak"))),
        study_hours: safe_f64(object.and_then(|entry| entry.get("studyHours"))),
        focus_rate: safe_f64(object.and_then(|entry| entry.get("focusRate"))),
        top_method: safe_string(object.and_then(|entry| entry.get("topMethod"))),
    }
}

fn normalize_summary(value: &Value) -> Option<TfSummaryPayload> {
    let object = value.as_object()?;
    let id = safe_string(object.get("id"));
    if id.is_empty() {
        return None;
    }

    Some(TfSummaryPayload {
        id,
        kind: normalize_summary_kind(object.get("kind")),
        label: safe_string(object.get("label")),
        generated_at_iso: safe_string(object.get("generatedAtISO")),
        voice: safe_string(object.get("voice")),
        text: safe_string(object.get("text")),
        caption: safe_string(object.get("caption")),
        metrics: normalize_summary_metrics(object.get("metrics")),
    })
}

fn normalize_tracker_prefs(value: Option<&Value>) -> TfTrackerPrefs {
    let object = value.and_then(Value::as_object);
    TfTrackerPrefs {
        custom_auto_apps: safe_string_array(object.and_then(|entry| entry.get("customAutoApps"))),
        custom_auto_websites: safe_string_array(object.and_then(|entry| entry.get("customAutoWebsites"))),
        custom_distraction_apps: safe_string_array(
            object.and_then(|entry| entry.get("customDistractionApps")),
        ),
        custom_distraction_websites: safe_string_array(
            object.and_then(|entry| entry.get("customDistractionWebsites")),
        ),
    }
}

fn normalize_plan_tier(value: Option<&Value>) -> TfPlanTier {
    match value.and_then(Value::as_str) {
        Some("pro") => TfPlanTier::Pro,
        _ => TfPlanTier::Free,
    }
}

fn normalize_account(value: Option<&Value>) -> Option<TfAccountState> {
    let object = value.and_then(Value::as_object)?;
    Some(TfAccountState {
        user_id: safe_optional_string(object.get("userId")),
        email: safe_optional_string(object.get("email")),
        username: safe_optional_string(object.get("username")),
        email_verified: safe_bool(object.get("emailVerified")),
        sync_id: safe_optional_string(object.get("syncId")),
        plan_tier: normalize_plan_tier(object.get("planTier")),
        theme_unlocks: safe_string_array(object.get("themeUnlocks")),
        billing_customer_id: safe_optional_string(object.get("billingCustomerId")),
    })
}

fn normalize_tf_app_state(value: Value) -> TfAppState {
    let object = match value.as_object() {
        Some(entry) => entry,
        None => return TfAppState::default(),
    };

    let session_logs = object
        .get("sessionLogs")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(normalize_session).collect())
        .unwrap_or_default();

    let summaries = object
        .get("summaries")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(normalize_summary).collect())
        .unwrap_or_default();

    TfAppState {
        tf_version: safe_i64(object.get("tfVersion"), TF_STATE_VERSION),
        session_logs,
        summaries,
        tracker_prefs: normalize_tracker_prefs(object.get("trackerPrefs")),
        account: normalize_account(object.get("account")),
    }
}

fn write_tf_state(path: &PathBuf, state: &TfAppState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create TimeFolio persistence directory: {error}"))?;
    }

    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Unable to serialize TimeFolio state: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Unable to write TimeFolio state: {error}"))
}

#[tauri::command]
pub fn tf_load_state(app: tauri::AppHandle) -> Result<TfAppState, String> {
    let path = tf_state_path(&app)?;

    let raw = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(TfAppState::default());
        }
        Err(error) => {
            return Err(format!("Unable to read TimeFolio state: {error}"));
        }
    };

    let value = serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null);
    Ok(normalize_tf_app_state(value))
}

#[tauri::command]
pub fn tf_save_state(app: tauri::AppHandle, state: TfAppState) -> Result<TfAppState, String> {
    let path = tf_state_path(&app)?;
    let normalized = normalize_tf_app_state(
        serde_json::to_value(state).map_err(|error| format!("Unable to encode TimeFolio state: {error}"))?,
    );
    write_tf_state(&path, &normalized)?;
    Ok(normalized)
}

#[tauri::command]
pub fn tf_reset_state(app: tauri::AppHandle) -> Result<TfAppState, String> {
    let path = tf_state_path(&app)?;
    let empty = TfAppState::default();
    write_tf_state(&path, &empty)?;
    Ok(empty)
}
