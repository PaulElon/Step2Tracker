use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const TF_PERSISTENCE_DIR: &str = "timefolio-persistence";
const TF_STATE_FILE: &str = "tf-state.json";
const TF_STATE_VERSION: i64 = 1;
const TF_FALLBACK_SESSION_UPDATED_AT: &str = "1970-01-01T00:00:00.000Z";

fn default_session_updated_at() -> String {
    TF_FALLBACK_SESSION_UPDATED_AT.to_owned()
}

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
    #[serde(default = "default_session_updated_at")]
    pub updated_at: String,
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
            updated_at: TF_FALLBACK_SESSION_UPDATED_AT.to_owned(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TfSessionLogTombstone {
    pub id: String,
    pub deleted_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_eligible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_source: Option<TfSessionLogTombstoneSyncSource>,
}

impl Default for TfSessionLogTombstone {
    fn default() -> Self {
        Self {
            id: String::new(),
            deleted_at: TF_FALLBACK_SESSION_UPDATED_AT.to_owned(),
            schema_version: None,
            sync_eligible: None,
            sync_source: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TfSessionLogTombstoneSyncSource {
    Manual,
    Imported,
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
    pub custom_auto_apps: Vec<TfTrackerRule>,
    pub custom_auto_websites: Vec<TfTrackerRule>,
    pub custom_distraction_apps: Vec<TfTrackerRule>,
    pub custom_distraction_websites: Vec<TfTrackerRule>,
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
    #[serde(default)]
    pub session_log_tombstones: Vec<TfSessionLogTombstone>,
    pub summaries: Vec<TfSummaryPayload>,
    pub tracker_prefs: TfTrackerPrefs,
    pub account: Option<TfAccountState>,
}

impl Default for TfAppState {
    fn default() -> Self {
        Self {
            tf_version: TF_STATE_VERSION,
            session_logs: Vec::new(),
            session_log_tombstones: Vec::new(),
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

fn safe_nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(ToOwned::to_owned)
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

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TfTrackerRuleKind {
    #[default]
    App,
    Website,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TfTrackerRule {
    pub id: String,
    pub name: String,
    pub target: String,
    pub kind: TfTrackerRuleKind,
}

fn titleize_tracker_rule_target(target: &str) -> String {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let candidate = trimmed
        .trim_end_matches(".app")
        .rsplit(['/', '.'])
        .find(|segment| !segment.trim().is_empty())
        .unwrap_or(trimmed)
        .replace(['-', '_'], " ");

    candidate
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_tracker_rule_id(kind: &TfTrackerRuleKind, index: usize, target: &str) -> String {
    let normalized_target = target
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_owned();
    let kind_label = match kind {
        TfTrackerRuleKind::App => "app",
        TfTrackerRuleKind::Website => "website",
    };

    if normalized_target.is_empty() {
        format!("tf-rule-{}-{}", kind_label, index)
    } else {
        format!("tf-rule-{}-{}-{}", kind_label, index, normalized_target)
    }
}

fn normalize_tracker_rule_kind(value: Option<&Value>, fallback: TfTrackerRuleKind) -> TfTrackerRuleKind {
    match value.and_then(Value::as_str) {
        Some("website") => TfTrackerRuleKind::Website,
        Some("app") => TfTrackerRuleKind::App,
        _ => fallback,
    }
}

fn normalize_tracker_rule(value: &Value, kind: TfTrackerRuleKind, index: usize) -> Option<TfTrackerRule> {
    if let Some(target) = value.as_str().map(str::trim).filter(|target| !target.is_empty()) {
        return Some(TfTrackerRule {
            id: build_tracker_rule_id(&kind, index, target),
            name: titleize_tracker_rule_target(target),
            target: target.to_owned(),
            kind,
        });
    }

    let object = value.as_object()?;
    let target = safe_string(object.get("target"));
    if target.trim().is_empty() {
        return None;
    }

    let normalized_kind = normalize_tracker_rule_kind(object.get("kind"), kind);
    let candidate_id = safe_string(object.get("id"));
    let candidate_name = safe_string(object.get("name"));

    Some(TfTrackerRule {
        id: if candidate_id.trim().is_empty() {
            build_tracker_rule_id(&normalized_kind, index, &target)
        } else {
            candidate_id
        },
        name: if candidate_name.trim().is_empty() {
            titleize_tracker_rule_target(&target)
        } else {
            candidate_name
        },
        target,
        kind: normalized_kind,
    })
}

fn normalize_tracker_rule_array(value: Option<&Value>, kind: TfTrackerRuleKind) -> Vec<TfTrackerRule> {
    match value.and_then(Value::as_array) {
        Some(values) => values
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| normalize_tracker_rule(entry, kind.clone(), index))
            .collect(),
        None => Vec::new(),
    }
}

fn derive_fallback_session_updated_at(date: &str, start_iso: &str, end_iso: &str) -> String {
    safe_nonempty_string(Some(&Value::String(end_iso.to_owned())))
        .or_else(|| safe_nonempty_string(Some(&Value::String(start_iso.to_owned()))))
        .or_else(|| {
            let trimmed = date.trim();
            if trimmed.len() == 10
                && trimmed.as_bytes().get(4) == Some(&b'-')
                && trimmed.as_bytes().get(7) == Some(&b'-')
            {
                Some(format!("{trimmed}T00:00:00.000Z"))
            } else {
                None
            }
        })
        .unwrap_or_else(|| TF_FALLBACK_SESSION_UPDATED_AT.to_owned())
}

fn normalize_session(value: &Value) -> Option<TfSessionLog> {
    let object = value.as_object()?;
    let id = safe_string(object.get("id"));
    if id.is_empty() {
        return None;
    }

    let date = safe_string(object.get("date"));
    let start_iso = safe_string(object.get("startISO"));
    let end_iso = safe_string(object.get("endISO"));

    Some(TfSessionLog {
        id,
        date: date.clone(),
        method: safe_string(object.get("method")),
        method_key: safe_string(object.get("methodKey")),
        hours: safe_f64(object.get("hours")),
        start_iso: start_iso.clone(),
        end_iso: end_iso.clone(),
        notes: safe_string(object.get("notes")),
        is_distraction: safe_bool(object.get("isDistraction")),
        is_live: safe_bool(object.get("isLive")),
        updated_at: safe_nonempty_string(object.get("updatedAt"))
            .unwrap_or_else(|| derive_fallback_session_updated_at(&date, &start_iso, &end_iso)),
    })
}

fn normalize_session_log_tombstone(value: &Value) -> Option<TfSessionLogTombstone> {
    let object = value.as_object()?;
    let id = safe_string(object.get("id")).trim().to_owned();
    if id.is_empty() {
        return None;
    }

    let schema_version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .filter(|value| *value == 1)
        .map(|value| value as u8);
    let sync_source = match object.get("syncSource").and_then(Value::as_str) {
        Some("manual") => Some(TfSessionLogTombstoneSyncSource::Manual),
        Some("imported") => Some(TfSessionLogTombstoneSyncSource::Imported),
        _ => None,
    };
    let raw_sync_eligible = object.get("syncEligible").and_then(Value::as_bool);
    let has_eligibility_metadata =
        schema_version.is_some() || raw_sync_eligible.is_some() || sync_source.is_some();
    let sync_eligible = has_eligibility_metadata
        .then_some(raw_sync_eligible.unwrap_or(false) && sync_source.is_some());
    let sync_source = if sync_eligible == Some(true) {
        sync_source
    } else {
        None
    };

    Some(TfSessionLogTombstone {
        id,
        deleted_at: safe_nonempty_string(object.get("deletedAt"))
            .unwrap_or_else(|| TF_FALLBACK_SESSION_UPDATED_AT.to_owned()),
        schema_version,
        sync_eligible,
        sync_source,
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
        custom_auto_apps: normalize_tracker_rule_array(
            object.and_then(|entry| entry.get("customAutoApps")),
            TfTrackerRuleKind::App,
        ),
        custom_auto_websites: normalize_tracker_rule_array(
            object.and_then(|entry| entry.get("customAutoWebsites")),
            TfTrackerRuleKind::Website,
        ),
        custom_distraction_apps: normalize_tracker_rule_array(
            object.and_then(|entry| entry.get("customDistractionApps")),
            TfTrackerRuleKind::App,
        ),
        custom_distraction_websites: normalize_tracker_rule_array(
            object.and_then(|entry| entry.get("customDistractionWebsites")),
            TfTrackerRuleKind::Website,
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

    let session_log_tombstones = object
        .get("sessionLogTombstones")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(normalize_session_log_tombstone).collect())
        .unwrap_or_default();

    let summaries = object
        .get("summaries")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(normalize_summary).collect())
        .unwrap_or_default();

    TfAppState {
        tf_version: safe_i64(object.get("tfVersion"), TF_STATE_VERSION),
        session_logs,
        session_log_tombstones,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deserializes_tracker_rule_objects_from_tauri_payload() {
        let value = json!({
            "tfVersion": 1,
            "sessionLogs": [],
            "summaries": [],
            "trackerPrefs": {
                "customAutoApps": [
                    {
                        "id": "anki-rule",
                        "name": "Anki",
                        "target": "/Applications/Anki.app",
                        "kind": "app"
                    }
                ],
                "customAutoWebsites": [],
                "customDistractionApps": [],
                "customDistractionWebsites": []
            },
            "account": null
        });

        let parsed = serde_json::from_value::<TfAppState>(value);
        assert!(parsed.is_ok(), "expected native TimeFolio payload with tracker rule objects to deserialize");
    }

    #[test]
    fn normalizes_session_log_tombstone_sync_metadata() {
        let normalized = normalize_tf_app_state(json!({
            "tfVersion": 1,
            "sessionLogs": [],
            "sessionLogTombstones": [
                {
                    "id": "manual-1",
                    "deletedAt": "2026-05-06T13:00:00.000Z",
                    "schemaVersion": 1,
                    "syncEligible": true,
                    "syncSource": "manual"
                },
                {
                    "id": "auto-1",
                    "deletedAt": "2026-05-06T12:00:00.000Z",
                    "schemaVersion": 1,
                    "syncEligible": false
                },
                {
                    "id": "legacy-1",
                    "deletedAt": "2026-05-06T11:00:00.000Z"
                }
            ],
            "summaries": [],
            "trackerPrefs": {
                "customAutoApps": [],
                "customAutoWebsites": [],
                "customDistractionApps": [],
                "customDistractionWebsites": []
            },
            "account": null
        }));

        assert_eq!(normalized.session_log_tombstones.len(), 3);
        assert_eq!(normalized.session_log_tombstones[0].schema_version, Some(1));
        assert_eq!(normalized.session_log_tombstones[0].sync_eligible, Some(true));
        assert_eq!(
            normalized.session_log_tombstones[0].sync_source,
            Some(TfSessionLogTombstoneSyncSource::Manual)
        );

        assert_eq!(normalized.session_log_tombstones[1].schema_version, Some(1));
        assert_eq!(normalized.session_log_tombstones[1].sync_eligible, Some(false));
        assert_eq!(normalized.session_log_tombstones[1].sync_source, None);

        assert_eq!(normalized.session_log_tombstones[2].schema_version, None);
        assert_eq!(normalized.session_log_tombstones[2].sync_eligible, None);
        assert_eq!(normalized.session_log_tombstones[2].sync_source, None);

        let serialized =
            serde_json::to_value(&normalized.session_log_tombstones).expect("serialize tombstones");
        assert_eq!(serialized[0]["syncSource"], "manual");
        assert_eq!(serialized[1]["syncEligible"], false);
        assert!(serialized[2].get("syncEligible").is_none());
    }
}
