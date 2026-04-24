use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{NaiveDate, NaiveTime, SecondsFormat, Timelike, Utc};
use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const APP_ID: &str = "step2-command-center";
const APP_STATE_VERSION: u32 = 6;
const DB_SCHEMA_VERSION: i32 = 3;
const LIVE_DB_FILE: &str = "command-center.sqlite3";
const MAX_BACKUPS: usize = 20;
const SAFE_CHECKPOINT_INTERVAL_HOURS: i64 = 6;
const BOOTSTRAP_SCHEDULE_JSON: &str = include_str!("../../src/data/bootstrap-schedule.json");

#[derive(Debug)]
pub struct StorageService {
    paths: StoragePaths,
    app_version: String,
}

#[derive(Debug, Clone)]
struct StoragePaths {
    root: PathBuf,
    live_db: PathBuf,
    backups_dir: PathBuf,
    quarantine_dir: PathBuf,
    legacy_dir: PathBuf,
}

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Sql(rusqlite::Error),
    Serde(serde_json::Error),
    Validation(String),
    Recovery(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{}", error),
            Self::Sql(error) => write!(f, "{}", error),
            Self::Serde(error) => write!(f, "{}", error),
            Self::Validation(message) | Self::Recovery(message) => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sql(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serde(error)
    }
}

pub type StorageResult<T> = Result<T, StorageError>;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClientSnapshot {
    pub state: AppState,
    pub persistence: PersistenceSummary,
    pub backups: Vec<BackupMetadata>,
    pub trash: Vec<TrashItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceSummary {
    pub storage_path: String,
    pub backup_directory: String,
    pub schema_version: i32,
    pub app_version: String,
    pub last_saved_at: Option<String>,
    pub recovery_message: Option<String>,
    pub legacy_migration_completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub schema_version: i32,
    pub app_version: String,
    pub counts: RecordCounts,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecordCounts {
    pub study_blocks: usize,
    pub practice_tests: usize,
    pub weak_topic_entries: usize,
    pub trashed_study_blocks: usize,
    pub trashed_practice_tests: usize,
    pub trashed_weak_topic_entries: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub entity_type: TrashEntityType,
    pub id: String,
    pub title: String,
    pub secondary_label: String,
    pub deleted_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrashEntityType {
    StudyBlock,
    PracticeTest,
    WeakTopic,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupArtifact {
    pub app: String,
    pub format_version: u32,
    pub schema_version: i32,
    pub app_version: String,
    pub exported_at: String,
    pub counts: RecordCounts,
    pub state: AppState,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupArtifactPreview {
    pub exported_at: String,
    pub schema_version: i32,
    pub app_version: String,
    pub counts: RecordCounts,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub version: u32,
    pub study_blocks: Vec<StudyBlock>,
    pub practice_tests: Vec<PracticeTest>,
    pub weak_topic_entries: Vec<WeakTopicEntry>,
    pub preferences: Preferences,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudyBlock {
    pub id: String,
    pub date: String,
    pub day: String,
    #[serde(default)]
    pub duration_hours: i64,
    #[serde(default)]
    pub duration_minutes: i64,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub order: i64,
    pub start_time: String,
    pub end_time: String,
    pub is_overnight: bool,
    pub category: String,
    pub task: String,
    pub status: StudyStatus,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminder_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reminder_sent_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StudyBlockInput {
    pub id: Option<String>,
    pub date: String,
    pub day: Option<String>,
    pub duration_hours: Option<i64>,
    pub duration_minutes: Option<i64>,
    pub completed: Option<bool>,
    pub order: Option<i64>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_overnight: Option<bool>,
    pub category: String,
    pub task: String,
    pub status: Option<StudyStatus>,
    pub notes: Option<String>,
    #[serde(default, alias = "reminderAt", skip_serializing_if = "Option::is_none")]
    pub reminder_at: Option<String>,
    #[serde(default, alias = "reminderSentAt", skip_serializing_if = "Option::is_none")]
    pub reminder_sent_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PracticeTest {
    pub id: String,
    pub date: String,
    pub source: String,
    pub form: String,
    pub question_count: i64,
    pub score_percent: f64,
    pub weak_topics: Vec<String>,
    pub strong_topics: Vec<String>,
    pub reflections: String,
    pub action_plan: String,
    pub minutes_spent: i64,
    #[serde(default, alias = "testType", skip_serializing)]
    pub legacy_test_type: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PracticeTestInput {
    pub id: Option<String>,
    pub date: String,
    pub source: String,
    pub form: String,
    pub question_count: i64,
    pub score_percent: f64,
    pub weak_topics: Vec<String>,
    pub strong_topics: Vec<String>,
    pub reflections: String,
    pub action_plan: String,
    pub minutes_spent: i64,
    #[serde(default, alias = "testType", skip_serializing)]
    pub legacy_test_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeakTopicEntry {
    pub id: String,
    pub topic: String,
    pub entry_type: WeakTopicEntryType,
    pub priority: WeakTopicPriority,
    pub status: WeakTopicStatus,
    pub notes: String,
    pub last_seen_at: String,
    pub source_label: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeakTopicInput {
    pub id: Option<String>,
    pub topic: String,
    pub entry_type: Option<WeakTopicEntryType>,
    pub priority: WeakTopicPriority,
    pub status: WeakTopicStatus,
    pub notes: String,
    pub last_seen_at: String,
    pub source_label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub active_section: SectionId,
    pub last_active_date: String,
    pub theme_id: ThemeId,
    pub daily_goal_minutes: i64,
    pub planner_filters: PlannerFilters,
    pub planner_sort: PlannerSort,
    pub planner_mode: PlannerMode,
    pub planner_focus_date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlannerFilters {
    pub search: String,
    pub category: String,
    pub status: StudyStatusFilter,
    pub from_date: String,
    pub to_date: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlannerSort {
    pub field: PlannerSortField,
    pub direction: SortDirection,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    #[serde(rename = "merge")]
    Merge,
    #[serde(rename = "replace")]
    Replace,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum StudyStatus {
    #[serde(rename = "Not Started")]
    NotStarted,
    #[serde(rename = "In Progress")]
    InProgress,
    #[serde(rename = "Completed")]
    Completed,
    #[serde(rename = "Skipped")]
    Skipped,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum StudyStatusFilter {
    #[serde(rename = "Not Started")]
    NotStarted,
    #[serde(rename = "In Progress")]
    InProgress,
    #[serde(rename = "Completed")]
    Completed,
    #[serde(rename = "Skipped")]
    Skipped,
    #[serde(rename = "All")]
    All,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum SectionId {
    #[serde(rename = "dashboard")]
    Dashboard,
    #[serde(rename = "planner")]
    Planner,
    #[serde(rename = "weakTopics")]
    WeakTopics,
    #[serde(rename = "tests")]
    Tests,
    #[serde(rename = "analytics")]
    Analytics,
    #[serde(rename = "settings")]
    Settings,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum PlannerSortField {
    #[serde(rename = "date")]
    Date,
    #[serde(rename = "startTime")]
    StartTime,
    #[serde(rename = "category")]
    Category,
    #[serde(rename = "status")]
    Status,
    #[serde(rename = "task")]
    Task,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum SortDirection {
    #[serde(rename = "asc")]
    Asc,
    #[serde(rename = "desc")]
    Desc,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum PlannerMode {
    #[serde(rename = "week")]
    Week,
    #[serde(rename = "database")]
    Database,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum ThemeId {
    #[serde(rename = "aurora")]
    Aurora,
    #[serde(rename = "ember")]
    Ember,
    #[serde(rename = "tide")]
    Tide,
    #[serde(rename = "bubblegum")]
    Bubblegum,
    #[serde(rename = "signal")]
    Signal,
    #[serde(rename = "prism")]
    Prism,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum WeakTopicPriority {
    #[serde(rename = "High")]
    High,
    #[serde(rename = "Medium")]
    Medium,
    #[serde(rename = "Low")]
    Low,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum WeakTopicStatus {
    #[serde(rename = "Active")]
    Active,
    #[serde(rename = "Watching")]
    Watching,
    #[serde(rename = "Improving")]
    Improving,
    #[serde(rename = "Resolved")]
    Resolved,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
pub enum WeakTopicEntryType {
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "practice-test")]
    PracticeTest,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupSidecar {
    created_at: String,
    reason: String,
    schema_version: i32,
    app_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapStudyBlock {
    date: String,
    day: String,
    start_time: String,
    end_time: String,
    category: String,
    task: String,
    status: StudyStatus,
    notes: String,
}

impl StoragePaths {
    fn new(root: PathBuf) -> Self {
        let canonical_root = root.join("persistence");
        Self {
            live_db: canonical_root.join(LIVE_DB_FILE),
            backups_dir: canonical_root.join("backups"),
            quarantine_dir: canonical_root.join("quarantine"),
            legacy_dir: canonical_root.join("legacy-browser-migration"),
            root: canonical_root,
        }
    }

    fn ensure_dirs(&self) -> StorageResult<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(&self.backups_dir)?;
        fs::create_dir_all(&self.quarantine_dir)?;
        fs::create_dir_all(&self.legacy_dir)?;
        Ok(())
    }
}

impl StorageService {
    pub fn new(root: PathBuf, app_version: impl Into<String>) -> Self {
        Self {
            paths: StoragePaths::new(root),
            app_version: app_version.into(),
        }
    }

    pub fn load_snapshot(&self) -> StorageResult<ClientSnapshot> {
        self.paths.ensure_dirs()?;
        let recovery_message = self.prepare_live_database()?;
        let connection = self.open_live_connection()?;
        let state = self.read_state(&connection)?;
        self.validate_app_state(&state)?;
        self.set_metadata(&connection, "app_version", &self.app_version)?;
        let snapshot = ClientSnapshot {
            state: state.clone(),
            persistence: PersistenceSummary {
                storage_path: self.paths.live_db.display().to_string(),
                backup_directory: self.paths.backups_dir.display().to_string(),
                schema_version: DB_SCHEMA_VERSION,
                app_version: self.app_version.clone(),
                last_saved_at: self.metadata_value(&connection, "last_saved_at")?,
                recovery_message,
                legacy_migration_completed_at: self.metadata_value(
                    &connection,
                    "legacy_browser_migration_completed_at",
                )?,
            },
            backups: self.list_backups()?,
            trash: self.list_trash_items(&connection)?,
        };
        Ok(snapshot)
    }

    pub fn save_preferences(&self, preferences: Preferences) -> StorageResult<ClientSnapshot> {
        self.validate_preferences(&preferences)?;
        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        self.persist_preferences(&transaction, &preferences)?;
        self.touch_saved(&transaction)?;
        self.log_event(&transaction, "preferences_saved", "preferences", Some("preferences"), None)?;
        transaction.commit()?;
        self.load_snapshot()
    }

    pub fn upsert_study_block(&self, input: StudyBlockInput) -> StorageResult<ClientSnapshot> {
        let mut connection = self.open_live_connection()?;
        let target_date = input.date.clone();
        let existing = self
            .study_block_by_id(&connection, input.id.as_deref())?
            .filter(|stored| stored.deleted_at.is_none());
        let fallback_order = if let Some(stored) = existing.as_ref() {
            if stored.block.date == target_date {
                stored.block.order
            } else {
                self.next_study_block_order(&connection, &target_date)?
            }
        } else {
            self.next_study_block_order(&connection, &target_date)?
        };
        let block = self.normalize_study_block(input, existing.as_ref().map(|row| &row.block), fallback_order)?;
        let transaction = connection.transaction()?;
        self.persist_study_block(&transaction, &block, None)?;
        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            if existing.is_some() { "study_block_updated" } else { "study_block_created" },
            "study_block",
            Some(&block.id),
            None,
        )?;
        transaction.commit()?;
        self.maybe_create_safe_checkpoint()?;
        self.load_snapshot()
    }

    pub fn duplicate_study_block(
        &self,
        id: String,
        target_date: Option<String>,
    ) -> StorageResult<ClientSnapshot> {
        let source = self
            .study_block_by_id(&self.open_live_connection()?, Some(&id))?
            .filter(|stored| stored.deleted_at.is_none())
            .ok_or_else(|| StorageError::Validation("Study block not found.".into()))?;

        let duplicate = StudyBlockInput {
            id: None,
            date: target_date.unwrap_or_else(|| source.block.date.clone()),
            day: None,
            duration_hours: Some(source.block.duration_hours),
            duration_minutes: Some(source.block.duration_minutes),
            completed: Some(false),
            order: None,
            start_time: Some(source.block.start_time.clone()),
            end_time: Some(source.block.end_time.clone()),
            is_overnight: Some(source.block.is_overnight),
            category: source.block.category.clone(),
            task: source.block.task.clone(),
            status: Some(StudyStatus::NotStarted),
            notes: Some(source.block.notes.clone()),
            reminder_at: None,
            reminder_sent_at: None,
        };

        self.upsert_study_block(duplicate)
    }

    pub fn trash_study_block(&self, id: String) -> StorageResult<ClientSnapshot> {
        self.soft_delete(TrashEntityType::StudyBlock, &id, "user-trash")?;
        self.load_snapshot()
    }

    pub fn import_study_blocks(
        &self,
        blocks: Vec<StudyBlockInput>,
        mode: ImportMode,
    ) -> StorageResult<ClientSnapshot> {
        if blocks.is_empty() {
            return Err(StorageError::Validation(
                "Import payload does not contain any study blocks.".into(),
            ));
        }

        let mut normalized = blocks;
        normalized.sort_by(|left, right| {
            left.date
                .cmp(&right.date)
                .then_with(|| left.start_time.clone().unwrap_or_default().cmp(&right.start_time.clone().unwrap_or_default()))
                .then_with(|| left.task.cmp(&right.task))
        });

        if matches!(mode, ImportMode::Replace) {
            self.create_snapshot("pre-study-block-import-replace")?;
        }

        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        if matches!(mode, ImportMode::Replace) {
            let deleted_at = now_iso();
            transaction.execute(
                "UPDATE study_blocks
                 SET deleted_at = ?1, delete_reason = 'replaced-by-import'
                 WHERE deleted_at IS NULL",
                params![deleted_at],
            )?;
        }

        let mut next_order_by_date = std::collections::HashMap::<String, i64>::new();

        for raw_block in normalized {
            let date = raw_block.date.clone();
            let existing = transaction
                .query_row(
                    "SELECT id, created_at, sort_order
                     FROM study_blocks
                     WHERE deleted_at IS NULL
                       AND lower(trim(date)) = lower(trim(?1))
                       AND lower(trim(start_time)) = lower(trim(?2))
                       AND lower(trim(category)) = lower(trim(?3))
                       AND lower(trim(task)) = lower(trim(?4))
                     LIMIT 1",
                    params![
                        raw_block.date,
                        raw_block.start_time.clone().unwrap_or_default(),
                        raw_block.category,
                        raw_block.task
                    ],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
                )
                .optional()?;

            let next_order = if let Some((_, _, order)) = existing.as_ref() {
                *order
            } else {
                if !next_order_by_date.contains_key(&date) {
                    let starting_order = self.next_study_block_order_tx(&transaction, &date)?;
                    next_order_by_date.insert(date.clone(), starting_order);
                }
                let entry = next_order_by_date
                    .get_mut(&date)
                    .ok_or_else(|| StorageError::Validation("Unable to compute import order.".into()))?;
                let order = *entry;
                *entry += 1;
                order
            };

            let block = self.normalize_study_block(raw_block, None, next_order)?;
            let identity = Self::study_block_identity(&block);
            let imported = if let Some((id, created_at, order)) = existing {
                StudyBlock {
                    id,
                    created_at,
                    order,
                    ..block
                }
            } else {
                block
            };
            self.persist_study_block(&transaction, &imported, Some(identity))?;
        }

        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            "study_block_imported",
            "study_block",
            None,
            Some(serde_json::json!({
                "mode": if matches!(mode, ImportMode::Replace) { "replace" } else { "merge" }
            })),
        )?;
        transaction.commit()?;
        self.create_snapshot("post-study-block-import")?;
        self.load_snapshot()
    }

    pub fn upsert_practice_test(&self, input: PracticeTestInput) -> StorageResult<ClientSnapshot> {
        let mut connection = self.open_live_connection()?;
        let existing = self
            .practice_test_by_id(&connection, input.id.as_deref())?
            .filter(|stored| stored.deleted_at.is_none());
        let test = self.normalize_practice_test(input, existing.as_ref().map(|row| &row.test))?;
        let transaction = connection.transaction()?;
        self.persist_practice_test(&transaction, &test)?;
        self.reconcile_weak_topics(&transaction)?;
        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            if existing.is_some() { "practice_test_updated" } else { "practice_test_created" },
            "practice_test",
            Some(&test.id),
            None,
        )?;
        transaction.commit()?;
        self.maybe_create_safe_checkpoint()?;
        self.load_snapshot()
    }

    pub fn trash_practice_test(&self, id: String) -> StorageResult<ClientSnapshot> {
        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        let deleted_at = now_iso();
        let updated = transaction.execute(
            "UPDATE practice_tests
             SET deleted_at = ?1, delete_reason = 'user-trash'
             WHERE id = ?2 AND deleted_at IS NULL",
            params![deleted_at, id],
        )?;
        if updated == 0 {
            return Err(StorageError::Validation("Practice test not found.".into()));
        }
        self.reconcile_weak_topics(&transaction)?;
        self.touch_saved(&transaction)?;
        self.log_event(&transaction, "practice_test_trashed", "practice_test", Some(&id), None)?;
        transaction.commit()?;
        self.load_snapshot()
    }

    pub fn upsert_weak_topic(&self, input: WeakTopicInput) -> StorageResult<ClientSnapshot> {
        let mut connection = self.open_live_connection()?;
        let existing = self
            .weak_topic_by_id(&connection, input.id.as_deref())?
            .filter(|stored| stored.deleted_at.is_none());
        let entry = self.normalize_weak_topic(input, existing.as_ref().map(|row| &row.entry))?;
        let transaction = connection.transaction()?;
        self.persist_weak_topic(&transaction, &entry)?;
        self.reconcile_weak_topics(&transaction)?;
        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            if existing.is_some() { "weak_topic_updated" } else { "weak_topic_created" },
            "weak_topic",
            Some(&entry.id),
            None,
        )?;
        transaction.commit()?;
        self.maybe_create_safe_checkpoint()?;
        self.load_snapshot()
    }

    pub fn trash_weak_topic(&self, id: String) -> StorageResult<ClientSnapshot> {
        self.soft_delete(TrashEntityType::WeakTopic, &id, "user-trash")?;
        self.load_snapshot()
    }

    pub fn restore_trashed_item(
        &self,
        entity_type: TrashEntityType,
        id: String,
    ) -> StorageResult<ClientSnapshot> {
        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        let updated = match entity_type {
            TrashEntityType::StudyBlock => transaction.execute(
                "UPDATE study_blocks
                 SET deleted_at = NULL, delete_reason = NULL
                 WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![id],
            )?,
            TrashEntityType::PracticeTest => {
                let updated = transaction.execute(
                    "UPDATE practice_tests
                     SET deleted_at = NULL, delete_reason = NULL
                     WHERE id = ?1 AND deleted_at IS NOT NULL",
                    params![id],
                )?;
                self.reconcile_weak_topics(&transaction)?;
                updated
            }
            TrashEntityType::WeakTopic => {
                let updated = transaction.execute(
                    "UPDATE weak_topic_entries
                     SET deleted_at = NULL, delete_reason = NULL
                     WHERE id = ?1 AND deleted_at IS NOT NULL",
                    params![id],
                )?;
                self.reconcile_weak_topics(&transaction)?;
                updated
            }
        };

        if updated == 0 {
            return Err(StorageError::Validation("Trash item not found.".into()));
        }

        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            "trash_item_restored",
            match entity_type {
                TrashEntityType::StudyBlock => "study_block",
                TrashEntityType::PracticeTest => "practice_test",
                TrashEntityType::WeakTopic => "weak_topic",
            },
            Some(&id),
            None,
        )?;
        transaction.commit()?;
        self.load_snapshot()
    }

    pub fn export_backup_artifact(&self) -> StorageResult<String> {
        let snapshot = self.load_snapshot()?;
        let artifact = BackupArtifact {
            app: APP_ID.to_string(),
            format_version: 1,
            schema_version: DB_SCHEMA_VERSION,
            app_version: self.app_version.clone(),
            exported_at: now_iso(),
            counts: calculate_counts(&snapshot.state, snapshot.trash.iter()),
            state: snapshot.state,
        };

        Ok(serde_json::to_string_pretty(&artifact)?)
    }

    pub fn preview_backup_artifact(&self, raw: String) -> StorageResult<BackupArtifactPreview> {
        let artifact = self.parse_backup_artifact(&raw)?;
        Ok(BackupArtifactPreview {
            exported_at: artifact.exported_at,
            schema_version: artifact.schema_version,
            app_version: artifact.app_version,
            counts: artifact.counts,
        })
    }

    pub fn restore_from_backup_artifact(&self, raw: String) -> StorageResult<ClientSnapshot> {
        let artifact = self.parse_backup_artifact(&raw)?;
        self.create_snapshot("pre-artifact-restore")?;
        self.replace_live_state(artifact.state, "artifact_restore")?;
        self.create_snapshot("post-artifact-restore")?;
        self.load_snapshot()
    }

    pub fn restore_from_snapshot(&self, backup_id: String) -> StorageResult<ClientSnapshot> {
        let backup_path = self.paths.backups_dir.join(format!("{}.sqlite3", backup_id));
        if !backup_path.exists() {
            return Err(StorageError::Validation("Backup snapshot not found.".into()));
        }
        let connection = Self::open_read_only_connection(&backup_path)?;
        Self::run_integrity_check(&connection)?;
        let state = self.read_state(&connection)?;
        self.validate_app_state(&state)?;
        drop(connection);

        self.create_snapshot("pre-snapshot-restore")?;
        self.replace_live_file(&backup_path)?;
        let live = self.open_live_connection()?;
        self.set_metadata(&live, "recovery_message", &format!("Restored snapshot {}.", backup_id))?;
        self.touch_saved_direct(&live)?;
        self.create_snapshot("post-snapshot-restore")?;
        self.load_snapshot()
    }

    pub fn migrate_legacy_browser_state(
        &self,
        legacy_source_json: String,
        state: AppState,
    ) -> StorageResult<ClientSnapshot> {
        self.validate_app_state(&state)?;
        let snapshot = self.load_snapshot()?;
        if snapshot.persistence.legacy_migration_completed_at.is_some() {
            return Ok(snapshot);
        }

        if snapshot.state.study_blocks.len()
            + snapshot.state.practice_tests.len()
            + snapshot.state.weak_topic_entries.len()
            > 0
        {
            return Err(StorageError::Validation(
                "Native storage already contains data. Legacy browser migration was skipped.".into(),
            ));
        }

        let artifact_name = format!("legacy-browser-{}.json", timestamp_slug());
        fs::write(self.paths.legacy_dir.join(artifact_name), legacy_source_json)?;
        self.replace_live_state(state, "legacy_browser_migration")?;
        let connection = self.open_live_connection()?;
        self.set_metadata(
            &connection,
            "legacy_browser_migration_completed_at",
            &now_iso(),
        )?;
        self.set_metadata(&connection, "recovery_message", "Legacy browser data migrated into native storage.")?;
        self.touch_saved_direct(&connection)?;
        self.create_snapshot("post-legacy-browser-migration")?;
        self.load_snapshot()
    }

    fn replace_live_state(&self, state: AppState, audit_event: &str) -> StorageResult<()> {
        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        self.clear_active_state(&transaction)?;
        self.persist_state(&transaction, &state)?;
        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            audit_event,
            "app_state",
            Some("canonical"),
            Some(serde_json::json!({
                "studyBlocks": state.study_blocks.len(),
                "practiceTests": state.practice_tests.len(),
                "weakTopicEntries": state.weak_topic_entries.len(),
            })),
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn clear_active_state(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        transaction.execute("DELETE FROM study_blocks", [])?;
        transaction.execute("DELETE FROM practice_tests", [])?;
        transaction.execute("DELETE FROM weak_topic_entries", [])?;
        Ok(())
    }

    fn persist_state(&self, transaction: &Transaction<'_>, state: &AppState) -> StorageResult<()> {
        self.persist_preferences(transaction, &state.preferences)?;
        for block in &state.study_blocks {
            self.persist_study_block(transaction, block, None)?;
        }
        for test in &state.practice_tests {
            self.persist_practice_test(transaction, test)?;
        }
        for entry in &state.weak_topic_entries {
            self.persist_weak_topic(transaction, entry)?;
        }
        self.reconcile_weak_topics(transaction)?;
        Ok(())
    }

    fn prepare_live_database(&self) -> StorageResult<Option<String>> {
        if !self.paths.live_db.exists() {
            let mut connection = self.open_live_connection()?;
            self.run_migrations(&mut connection)?;
            let bootstrap = self.bootstrap_state()?;
            let transaction = connection.transaction()?;
            self.persist_state(&transaction, &bootstrap)?;
            self.touch_saved(&transaction)?;
            self.set_metadata_tx(&transaction, "app_version", &self.app_version)?;
            self.log_event(
                &transaction,
                "bootstrap_initialized",
                "app_state",
                Some("bootstrap"),
                None,
            )?;
            transaction.commit()?;
            self.create_snapshot("post-bootstrap")?;
            return Ok(None);
        }

        match self.try_validate_live_database() {
            Ok(()) => Ok(self.take_recovery_message()?),
            Err(_error) => {
                let quarantined = self.quarantine_live_files("corrupt-or-invalid-live-db")?;
                let latest_backup = self
                    .list_backups()?
                    .into_iter()
                    .next()
                    .ok_or_else(|| StorageError::Recovery(format!(
                        "Canonical data was quarantined at {}, and no usable backup snapshot was found.",
                        quarantined.display()
                    )))?;
                let backup_path = self.paths.backups_dir.join(format!("{}.sqlite3", latest_backup.id));
                self.replace_live_file(&backup_path)?;
                let connection = self.open_live_connection()?;
                self.set_metadata(
                    &connection,
                    "recovery_message",
                    &format!(
                        "Recovered from snapshot {} after quarantining invalid live data at {}.",
                        latest_backup.id,
                        quarantined.display()
                    ),
                )?;
                self.touch_saved_direct(&connection)?;
                Ok(self.take_recovery_message()?)
            }
        }
    }

    fn try_validate_live_database(&self) -> StorageResult<()> {
        let mut connection = self.open_live_connection()?;
        self.run_migrations(&mut connection)?;
        Self::run_integrity_check(&connection)?;
        let state = self.read_state(&connection)?;
        self.validate_app_state(&state)?;
        Ok(())
    }

    fn run_migrations(&self, connection: &mut Connection) -> StorageResult<()> {
        let current_version = connection.pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0))?;
        if current_version > DB_SCHEMA_VERSION {
            return Err(StorageError::Validation(
                "The local database uses a newer schema version than this app understands.".into(),
            ));
        }
        if current_version == DB_SCHEMA_VERSION {
            return Ok(());
        }

        if current_version > 0 || self.has_existing_schema_objects(connection)? {
            self.create_snapshot("pre-migration")?;
        }

        let transaction = connection.transaction()?;
        if current_version < 1 {
            self.create_schema(&transaction)?;
        }
        if current_version < 2 {
            self.ensure_study_block_task_columns(&transaction)?;
            self.backfill_study_block_task_fields(&transaction)?;
            self.clear_legacy_bootstrap_schedule_if_needed(&transaction)?;
        }
        transaction.pragma_update(None, "user_version", DB_SCHEMA_VERSION)?;
        self.set_metadata_tx(&transaction, "app_version", &self.app_version)?;
        self.log_event(
            &transaction,
            "schema_migrated",
            "database",
            Some("canonical"),
            Some(serde_json::json!({
                "fromVersion": current_version,
                "toVersion": DB_SCHEMA_VERSION,
            })),
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn create_schema(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        transaction.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS app_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preferences (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              active_section TEXT NOT NULL,
              last_active_date TEXT NOT NULL,
              theme_id TEXT NOT NULL,
              daily_goal_minutes INTEGER NOT NULL,
              planner_filter_search TEXT NOT NULL,
              planner_filter_category TEXT NOT NULL,
              planner_filter_status TEXT NOT NULL,
              planner_filter_from_date TEXT NOT NULL,
              planner_filter_to_date TEXT NOT NULL,
              planner_sort_field TEXT NOT NULL,
              planner_sort_direction TEXT NOT NULL,
              planner_mode TEXT NOT NULL,
              planner_focus_date TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS study_blocks (
              id TEXT PRIMARY KEY,
              date TEXT NOT NULL,
              day TEXT NOT NULL,
              duration_hours INTEGER NOT NULL DEFAULT 0,
              duration_minutes INTEGER NOT NULL DEFAULT 0,
              completed INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              start_time TEXT NOT NULL,
              end_time TEXT NOT NULL,
              is_overnight INTEGER NOT NULL,
              category TEXT NOT NULL,
              task TEXT NOT NULL,
              status TEXT NOT NULL,
              notes TEXT NOT NULL,
              reminder_at TEXT,
              reminder_sent_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              delete_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS practice_tests (
              id TEXT PRIMARY KEY,
              date TEXT NOT NULL,
              test_type TEXT NOT NULL,
              source TEXT NOT NULL,
              form TEXT NOT NULL,
              question_count INTEGER NOT NULL,
              score_percent REAL NOT NULL,
              weak_topics_json TEXT NOT NULL,
              strong_topics_json TEXT NOT NULL,
              reflections TEXT NOT NULL,
              action_plan TEXT NOT NULL,
              minutes_spent INTEGER NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              delete_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS weak_topic_entries (
              id TEXT PRIMARY KEY,
              topic TEXT NOT NULL,
              entry_type TEXT NOT NULL,
              priority TEXT NOT NULL,
              status TEXT NOT NULL,
              notes TEXT NOT NULL,
              last_seen_at TEXT NOT NULL,
              source_label TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT,
              delete_reason TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              entity_type TEXT NOT NULL,
              entity_id TEXT,
              created_at TEXT NOT NULL,
              details_json TEXT NOT NULL
            );
            ",
        )?;
        Ok(())
    }

    fn ensure_study_block_task_columns(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        let columns = self.table_columns(transaction, "study_blocks")?;

        if !columns.contains(&"duration_hours".to_string()) {
            transaction.execute(
                "ALTER TABLE study_blocks ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !columns.contains(&"duration_minutes".to_string()) {
            transaction.execute(
                "ALTER TABLE study_blocks ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !columns.contains(&"completed".to_string()) {
            transaction.execute(
                "ALTER TABLE study_blocks ADD COLUMN completed INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !columns.contains(&"sort_order".to_string()) {
            transaction.execute(
                "ALTER TABLE study_blocks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !columns.contains(&"reminder_at".to_string()) {
            transaction.execute("ALTER TABLE study_blocks ADD COLUMN reminder_at TEXT", [])?;
        }
        if !columns.contains(&"reminder_sent_at".to_string()) {
            transaction.execute("ALTER TABLE study_blocks ADD COLUMN reminder_sent_at TEXT", [])?;
        }

        Ok(())
    }

    fn table_columns(&self, transaction: &Transaction<'_>, table: &str) -> StorageResult<Vec<String>> {
        let sql = format!("PRAGMA table_info({})", table);
        let mut statement = transaction.prepare(&sql)?;
        let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }

    fn backfill_study_block_task_fields(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        let mut statement = transaction.prepare(
            "
            SELECT id, date, start_time, end_time, is_overnight, category, task, notes, status
            FROM study_blocks
            WHERE deleted_at IS NULL
            ORDER BY date ASC, start_time ASC, task ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)? == 1,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })?;

        let mut order_by_date = std::collections::HashMap::<String, i64>::new();
        for row in rows {
            let (id, date, start_time, end_time, is_overnight, category, task, notes, status) = row?;
            let (duration_hours, duration_minutes) =
                derive_duration_from_legacy_range(&start_time, &end_time, is_overnight)?;
            let order = {
                let entry = order_by_date.entry(date.clone()).or_insert(0);
                let current = *entry;
                *entry += 1;
                current
            };

            transaction.execute(
                "
                UPDATE study_blocks
                SET duration_hours = ?1,
                    duration_minutes = ?2,
                    completed = ?3,
                    sort_order = ?4,
                    category = ?5,
                    status = ?6
                WHERE id = ?7
                ",
                params![
                    duration_hours,
                    duration_minutes,
                    i64::from(status == "Completed"),
                    order,
                    normalize_study_task_category(&category, &task, &notes),
                    if status == "Completed" { "Completed" } else { "Not Started" },
                    id
                ],
            )?;
        }

        Ok(())
    }

    fn clear_legacy_bootstrap_schedule_if_needed(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        let legacy_bootstrap = self.legacy_bootstrap_study_blocks()?;
        let mut statement = transaction.prepare(
            "
            SELECT
              date, day, duration_hours, duration_minutes, completed, sort_order,
              start_time, end_time, is_overnight, category, task, status, notes
            FROM study_blocks
            WHERE deleted_at IS NULL
            ORDER BY date ASC, sort_order ASC, task ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(StudyBlock {
                id: String::new(),
                date: row.get(0)?,
                day: row.get(1)?,
                duration_hours: row.get(2)?,
                duration_minutes: row.get(3)?,
                completed: row.get::<_, i64>(4)? == 1,
                order: row.get(5)?,
                start_time: row.get(6)?,
                end_time: row.get(7)?,
                is_overnight: row.get::<_, i64>(8)? == 1,
                category: row.get(9)?,
                task: row.get(10)?,
                status: parse_study_status(&row.get::<_, String>(11)?)?,
                notes: row.get(12)?,
                reminder_at: None,
                reminder_sent_at: None,
                created_at: String::new(),
                updated_at: String::new(),
            })
        })?;
        let current = rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)?;

        if current.len() != legacy_bootstrap.len() {
            return Ok(());
        }

        let matches_bootstrap = current.iter().zip(legacy_bootstrap.iter()).all(|(left, right)| {
            left.date == right.date
                && left.day == right.day
                && left.duration_hours == right.duration_hours
                && left.duration_minutes == right.duration_minutes
                && left.completed == right.completed
                && left.order == right.order
                && left.start_time == right.start_time
                && left.end_time == right.end_time
                && left.is_overnight == right.is_overnight
                && left.category == right.category
                && left.task == right.task
                && left.status == right.status
                && left.notes == right.notes
        });

        if matches_bootstrap {
            transaction.execute("DELETE FROM study_blocks WHERE deleted_at IS NULL", [])?;
        }

        Ok(())
    }

    fn open_live_connection(&self) -> StorageResult<Connection> {
        let connection = Connection::open(&self.paths.live_db)?;
        Self::configure_live_connection(&connection)?;
        Ok(connection)
    }

    fn has_existing_schema_objects(&self, connection: &Connection) -> StorageResult<bool> {
        let count = connection.query_row(
            "
            SELECT COUNT(*)
            FROM sqlite_master
            WHERE type = 'table'
              AND name IN ('app_metadata', 'preferences', 'study_blocks', 'practice_tests', 'weak_topic_entries', 'audit_log')
            ",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        Ok(count > 0)
    }

    fn open_read_only_connection(path: &Path) -> StorageResult<Connection> {
        let connection = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    fn configure_live_connection(connection: &Connection) -> StorageResult<()> {
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "FULL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "busy_timeout", 5_000i64)?;
        Ok(())
    }

    fn create_snapshot(&self, reason: &str) -> StorageResult<()> {
        if !self.paths.live_db.exists() {
            return Ok(());
        }

        let connection = self.open_live_connection()?;
        let backup_id = timestamp_slug();
        let target_path = self.paths.backups_dir.join(format!("{}.sqlite3", backup_id));
        if target_path.exists() {
            fs::remove_file(&target_path)?;
        }
        let vacuum_sql = format!("VACUUM INTO '{}'", sqlite_escape_path(&target_path));
        connection.execute_batch(&vacuum_sql)?;

        let sidecar = BackupSidecar {
            created_at: now_iso(),
            reason: reason.to_string(),
            schema_version: DB_SCHEMA_VERSION,
            app_version: self.app_version.clone(),
        };
        fs::write(
            self.paths.backups_dir.join(format!("{}.json", backup_id)),
            serde_json::to_vec_pretty(&sidecar)?,
        )?;
        self.prune_backups()?;
        Ok(())
    }

    fn maybe_create_safe_checkpoint(&self) -> StorageResult<()> {
        let latest = self.list_backups()?.into_iter().next();
        let should_create = latest
            .as_ref()
            .and_then(|entry| chrono::DateTime::parse_from_rfc3339(&entry.created_at).ok())
            .map(|timestamp| Utc::now().signed_duration_since(timestamp.with_timezone(&Utc)).num_hours() >= SAFE_CHECKPOINT_INTERVAL_HOURS)
            .unwrap_or(true);

        if should_create {
            self.create_snapshot("safe-checkpoint")?;
        }
        Ok(())
    }

    fn prune_backups(&self) -> StorageResult<()> {
        let backups = self.list_backups()?;
        for backup in backups.into_iter().skip(MAX_BACKUPS) {
            let db_path = self.paths.backups_dir.join(format!("{}.sqlite3", backup.id));
            let meta_path = self.paths.backups_dir.join(format!("{}.json", backup.id));
            if db_path.exists() {
                fs::remove_file(db_path)?;
            }
            if meta_path.exists() {
                fs::remove_file(meta_path)?;
            }
        }
        Ok(())
    }

    fn list_backups(&self) -> StorageResult<Vec<BackupMetadata>> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&self.paths.backups_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            let sidecar: BackupSidecar = match serde_json::from_slice(&fs::read(&path)?) {
                Ok(sidecar) => sidecar,
                Err(_) => continue,
            };
            let database_path = self.paths.backups_dir.join(format!("{}.sqlite3", stem));
            if !database_path.exists() {
                continue;
            }
            let Ok(connection) = Self::open_read_only_connection(&database_path) else {
                continue;
            };
            let Ok(state) = self.read_state(&connection) else {
                continue;
            };
            let Ok(trash) = self.list_trash_items(&connection) else {
                continue;
            };
            entries.push(BackupMetadata {
                id: stem.to_string(),
                created_at: sidecar.created_at,
                reason: sidecar.reason,
                schema_version: sidecar.schema_version,
                app_version: sidecar.app_version,
                counts: calculate_counts(&state, trash.iter()),
            });
        }
        entries.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(entries)
    }

    fn replace_live_file(&self, source: &Path) -> StorageResult<()> {
        if self.paths.live_db.exists() {
            let _ = fs::remove_file(self.paths.live_db.with_extension("sqlite3-wal"));
            let _ = fs::remove_file(self.paths.live_db.with_extension("sqlite3-shm"));
            let _ = fs::remove_file(self.paths.live_db.with_file_name(format!("{}-wal", LIVE_DB_FILE)));
            let _ = fs::remove_file(self.paths.live_db.with_file_name(format!("{}-shm", LIVE_DB_FILE)));
            fs::remove_file(&self.paths.live_db)?;
        }
        fs::copy(source, &self.paths.live_db)?;
        Ok(())
    }

    fn quarantine_live_files(&self, reason: &str) -> StorageResult<PathBuf> {
        let folder = self
            .paths
            .quarantine_dir
            .join(format!("{}-{}", timestamp_slug(), reason));
        fs::create_dir_all(&folder)?;
        for suffix in ["", "-wal", "-shm"] {
            let candidate = if suffix.is_empty() {
                self.paths.live_db.clone()
            } else {
                self.paths.live_db.with_file_name(format!("{}{}", LIVE_DB_FILE, suffix))
            };
            if candidate.exists() {
                let file_name = candidate
                    .file_name()
                    .ok_or_else(|| StorageError::Recovery("Unable to quarantine live database.".into()))?;
                fs::rename(&candidate, folder.join(file_name))?;
            }
        }
        Ok(folder)
    }

    fn take_recovery_message(&self) -> StorageResult<Option<String>> {
        let connection = self.open_live_connection()?;
        let message = self.metadata_value(&connection, "recovery_message")?;
        if message.is_some() {
            connection.execute("DELETE FROM app_metadata WHERE key = 'recovery_message'", [])?;
        }
        Ok(message)
    }

    fn parse_backup_artifact(&self, raw: &str) -> StorageResult<BackupArtifact> {
        let value: serde_json::Value = serde_json::from_str(raw)?;
        if value.get("app").and_then(|entry| entry.as_str()) != Some(APP_ID) {
            return Err(StorageError::Validation(
                "This file is not a Step 2 Command Center backup artifact.".into(),
            ));
        }
        let artifact: BackupArtifact = serde_json::from_value(value)?;
        self.validate_app_state(&artifact.state)?;
        Ok(artifact)
    }

    fn read_state(&self, connection: &Connection) -> StorageResult<AppState> {
        let preferences = self.read_preferences(connection)?;
        let study_blocks = self.read_study_blocks(connection)?;
        let practice_tests = self.read_practice_tests(connection)?;
        let weak_topic_entries = self.reconciled_weak_topics(connection, &practice_tests)?;
        Ok(AppState {
            version: APP_STATE_VERSION,
            study_blocks,
            practice_tests,
            weak_topic_entries,
            preferences,
        })
    }

    fn read_preferences(&self, connection: &Connection) -> StorageResult<Preferences> {
        let preferences = connection
            .query_row(
                "
                SELECT
                  active_section,
                  last_active_date,
                  theme_id,
                  daily_goal_minutes,
                  planner_filter_search,
                  planner_filter_category,
                  planner_filter_status,
                  planner_filter_from_date,
                  planner_filter_to_date,
                  planner_sort_field,
                  planner_sort_direction,
                  planner_mode,
                  planner_focus_date
                FROM preferences
                WHERE id = 1
                ",
                [],
                |row| {
                    Ok(Preferences {
                        active_section: parse_section_id(&row.get::<_, String>(0)?)?,
                        last_active_date: row.get(1)?,
                        theme_id: parse_theme_id(&row.get::<_, String>(2)?)?,
                        daily_goal_minutes: row.get(3)?,
                        planner_filters: PlannerFilters {
                            search: row.get(4)?,
                            category: row.get(5)?,
                            status: parse_study_status_filter(&row.get::<_, String>(6)?)?,
                            from_date: row.get(7)?,
                            to_date: row.get(8)?,
                        },
                        planner_sort: PlannerSort {
                            field: parse_planner_sort_field(&row.get::<_, String>(9)?)?,
                            direction: parse_sort_direction(&row.get::<_, String>(10)?)?,
                        },
                        planner_mode: parse_planner_mode(&row.get::<_, String>(11)?)?,
                        planner_focus_date: row.get(12)?,
                    })
                },
            )
            .optional()?;
        Ok(preferences.unwrap_or_else(default_preferences))
    }

    fn read_study_blocks(&self, connection: &Connection) -> StorageResult<Vec<StudyBlock>> {
        let mut statement = connection.prepare(
            "
            SELECT
              id, date, day, duration_hours, duration_minutes, completed, sort_order,
              start_time, end_time, is_overnight, category, task, status, notes,
              reminder_at, reminder_sent_at, created_at, updated_at
            FROM study_blocks
            WHERE deleted_at IS NULL
            ORDER BY date ASC, sort_order ASC, created_at ASC, task ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(StudyBlock {
                id: row.get(0)?,
                date: row.get(1)?,
                day: row.get(2)?,
                duration_hours: row.get(3)?,
                duration_minutes: row.get(4)?,
                completed: row.get::<_, i64>(5)? == 1,
                order: row.get(6)?,
                start_time: row.get(7)?,
                end_time: row.get(8)?,
                is_overnight: row.get::<_, i64>(9)? == 1,
                category: row.get(10)?,
                task: row.get(11)?,
                status: parse_study_status(&row.get::<_, String>(12)?)?,
                notes: row.get(13)?,
                reminder_at: row.get(14)?,
                reminder_sent_at: row.get(15)?,
                created_at: row.get(16)?,
                updated_at: row.get(17)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }

    fn read_practice_tests(&self, connection: &Connection) -> StorageResult<Vec<PracticeTest>> {
        let mut statement = connection.prepare(
            "
            SELECT
              id, date, test_type, source, form, question_count, score_percent,
              weak_topics_json, strong_topics_json, reflections, action_plan,
              minutes_spent, created_at, updated_at
            FROM practice_tests
            WHERE deleted_at IS NULL
            ORDER BY date ASC, created_at ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            let test_type: String = row.get(2)?;
            let source: String = row.get(3)?;
            let form: String = row.get(4)?;

            Ok(PracticeTest {
                id: row.get(0)?,
                date: row.get(1)?,
                source: resolve_practice_test_source(&source, Some(&test_type)),
                form,
                question_count: row.get(5)?,
                score_percent: row.get(6)?,
                weak_topics: parse_string_list(&row.get::<_, String>(7)?)?,
                strong_topics: parse_string_list(&row.get::<_, String>(8)?)?,
                reflections: row.get(9)?,
                action_plan: row.get(10)?,
                minutes_spent: row.get(11)?,
                legacy_test_type: sanitize_optional_text(Some(&test_type)),
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
    }

    fn reconciled_weak_topics(
        &self,
        connection: &Connection,
        practice_tests: &[PracticeTest],
    ) -> StorageResult<Vec<WeakTopicEntry>> {
        let mut statement = connection.prepare(
            "
            SELECT id, topic, entry_type, priority, status, notes, last_seen_at, source_label, created_at, updated_at
            FROM weak_topic_entries
            WHERE deleted_at IS NULL
            ORDER BY updated_at ASC
            ",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(WeakTopicEntry {
                id: row.get(0)?,
                topic: row.get(1)?,
                entry_type: parse_weak_topic_entry_type(&row.get::<_, String>(2)?)?,
                priority: parse_weak_topic_priority(&row.get::<_, String>(3)?)?,
                status: parse_weak_topic_status(&row.get::<_, String>(4)?)?,
                notes: row.get(5)?,
                last_seen_at: row.get(6)?,
                source_label: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?;
        let existing = rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)?;
        Ok(merge_weak_topic_entries_from_practice_tests(practice_tests, &existing))
    }

    fn study_block_by_id(
        &self,
        connection: &Connection,
        id: Option<&str>,
    ) -> StorageResult<Option<StoredStudyBlock>> {
        let Some(id) = id else {
            return Ok(None);
        };
        connection
            .query_row(
                "
                SELECT
                  id, date, day, duration_hours, duration_minutes, completed, sort_order,
                  start_time, end_time, is_overnight, category, task, status, notes,
                  reminder_at, reminder_sent_at, created_at, updated_at, deleted_at
                FROM study_blocks
                WHERE id = ?1
                LIMIT 1
                ",
                params![id],
                |row| {
                    Ok(StoredStudyBlock {
                        block: StudyBlock {
                            id: row.get(0)?,
                            date: row.get(1)?,
                            day: row.get(2)?,
                            duration_hours: row.get(3)?,
                            duration_minutes: row.get(4)?,
                            completed: row.get::<_, i64>(5)? == 1,
                            order: row.get(6)?,
                            start_time: row.get(7)?,
                            end_time: row.get(8)?,
                            is_overnight: row.get::<_, i64>(9)? == 1,
                            category: row.get(10)?,
                            task: row.get(11)?,
                            status: parse_study_status(&row.get::<_, String>(12)?)?,
                            notes: row.get(13)?,
                            reminder_at: row.get(14)?,
                            reminder_sent_at: row.get(15)?,
                            created_at: row.get(16)?,
                            updated_at: row.get(17)?,
                        },
                        deleted_at: row.get(18)?,
                    })
                },
            )
            .optional()
            .map_err(StorageError::from)
    }

    fn practice_test_by_id(
        &self,
        connection: &Connection,
        id: Option<&str>,
    ) -> StorageResult<Option<StoredPracticeTest>> {
        let Some(id) = id else {
            return Ok(None);
        };
        connection
            .query_row(
                "
                SELECT
                  id, date, test_type, source, form, question_count, score_percent,
                  weak_topics_json, strong_topics_json, reflections, action_plan,
                  minutes_spent, created_at, updated_at, deleted_at
                FROM practice_tests
                WHERE id = ?1
                LIMIT 1
                ",
                params![id],
                |row| {
                    let test_type: String = row.get(2)?;
                    let source: String = row.get(3)?;
                    let form: String = row.get(4)?;

                    Ok(StoredPracticeTest {
                        test: PracticeTest {
                            id: row.get(0)?,
                            date: row.get(1)?,
                            source: resolve_practice_test_source(&source, Some(&test_type)),
                            form,
                            question_count: row.get(5)?,
                            score_percent: row.get(6)?,
                            weak_topics: parse_string_list(&row.get::<_, String>(7)?)?,
                            strong_topics: parse_string_list(&row.get::<_, String>(8)?)?,
                            reflections: row.get(9)?,
                            action_plan: row.get(10)?,
                            minutes_spent: row.get(11)?,
                            legacy_test_type: sanitize_optional_text(Some(&test_type)),
                            created_at: row.get(12)?,
                            updated_at: row.get(13)?,
                        },
                        deleted_at: row.get(14)?,
                    })
                },
            )
            .optional()
            .map_err(StorageError::from)
    }

    fn next_study_block_order(&self, connection: &Connection, date: &str) -> StorageResult<i64> {
        connection
            .query_row(
                "
                SELECT COALESCE(MAX(sort_order), -1) + 1
                FROM study_blocks
                WHERE deleted_at IS NULL AND date = ?1
                ",
                params![date],
                |row| row.get(0),
            )
            .map_err(StorageError::from)
    }

    fn next_study_block_order_tx(&self, transaction: &Transaction<'_>, date: &str) -> StorageResult<i64> {
        transaction
            .query_row(
                "
                SELECT COALESCE(MAX(sort_order), -1) + 1
                FROM study_blocks
                WHERE deleted_at IS NULL AND date = ?1
                ",
                params![date],
                |row| row.get(0),
            )
            .map_err(StorageError::from)
    }

    fn weak_topic_by_id(
        &self,
        connection: &Connection,
        id: Option<&str>,
    ) -> StorageResult<Option<StoredWeakTopic>> {
        let Some(id) = id else {
            return Ok(None);
        };
        connection
            .query_row(
                "
                SELECT id, topic, entry_type, priority, status, notes, last_seen_at, source_label, created_at, updated_at, deleted_at
                FROM weak_topic_entries
                WHERE id = ?1
                LIMIT 1
                ",
                params![id],
                |row| {
                    Ok(StoredWeakTopic {
                        entry: WeakTopicEntry {
                            id: row.get(0)?,
                            topic: row.get(1)?,
                            entry_type: parse_weak_topic_entry_type(&row.get::<_, String>(2)?)?,
                            priority: parse_weak_topic_priority(&row.get::<_, String>(3)?)?,
                            status: parse_weak_topic_status(&row.get::<_, String>(4)?)?,
                            notes: row.get(5)?,
                            last_seen_at: row.get(6)?,
                            source_label: row.get(7)?,
                            created_at: row.get(8)?,
                            updated_at: row.get(9)?,
                        },
                        deleted_at: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(StorageError::from)
    }

    fn persist_preferences(&self, transaction: &Transaction<'_>, preferences: &Preferences) -> StorageResult<()> {
        transaction.execute(
            "
            INSERT INTO preferences (
              id, active_section, last_active_date, theme_id, daily_goal_minutes,
              planner_filter_search, planner_filter_category, planner_filter_status,
              planner_filter_from_date, planner_filter_to_date,
              planner_sort_field, planner_sort_direction, planner_mode,
              planner_focus_date, updated_at
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
            ON CONFLICT(id) DO UPDATE SET
              active_section = excluded.active_section,
              last_active_date = excluded.last_active_date,
              theme_id = excluded.theme_id,
              daily_goal_minutes = excluded.daily_goal_minutes,
              planner_filter_search = excluded.planner_filter_search,
              planner_filter_category = excluded.planner_filter_category,
              planner_filter_status = excluded.planner_filter_status,
              planner_filter_from_date = excluded.planner_filter_from_date,
              planner_filter_to_date = excluded.planner_filter_to_date,
              planner_sort_field = excluded.planner_sort_field,
              planner_sort_direction = excluded.planner_sort_direction,
              planner_mode = excluded.planner_mode,
              planner_focus_date = excluded.planner_focus_date,
              updated_at = excluded.updated_at
            ",
            params![
                serialize_section_id(preferences.active_section),
                preferences.last_active_date,
                serialize_theme_id(preferences.theme_id),
                preferences.daily_goal_minutes,
                preferences.planner_filters.search,
                preferences.planner_filters.category,
                serialize_study_status_filter(preferences.planner_filters.status),
                preferences.planner_filters.from_date,
                preferences.planner_filters.to_date,
                serialize_planner_sort_field(preferences.planner_sort.field),
                serialize_sort_direction(preferences.planner_sort.direction),
                serialize_planner_mode(preferences.planner_mode),
                preferences.planner_focus_date,
                now_iso(),
            ],
        )?;
        Ok(())
    }

    fn persist_study_block(
        &self,
        transaction: &Transaction<'_>,
        block: &StudyBlock,
        _identity: Option<String>,
    ) -> StorageResult<()> {
        transaction.execute(
            "
            INSERT INTO study_blocks (
              id, date, day, duration_hours, duration_minutes, completed, sort_order,
              start_time, end_time, is_overnight, category, task,
              status, notes, reminder_at, reminder_sent_at, created_at, updated_at, deleted_at, delete_reason
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
              date = excluded.date,
              day = excluded.day,
              duration_hours = excluded.duration_hours,
              duration_minutes = excluded.duration_minutes,
              completed = excluded.completed,
              sort_order = excluded.sort_order,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              is_overnight = excluded.is_overnight,
              category = excluded.category,
              task = excluded.task,
              status = excluded.status,
              notes = excluded.notes,
              reminder_at = excluded.reminder_at,
              reminder_sent_at = excluded.reminder_sent_at,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              delete_reason = NULL
            ",
            params![
                block.id,
                block.date,
                block.day,
                block.duration_hours,
                block.duration_minutes,
                i64::from(block.completed),
                block.order,
                block.start_time,
                block.end_time,
                i64::from(block.is_overnight),
                block.category,
                block.task,
                serialize_study_status(block.status),
                block.notes,
                block.reminder_at,
                block.reminder_sent_at,
                block.created_at,
                block.updated_at,
            ],
        )?;
        Ok(())
    }

    fn persist_practice_test(&self, transaction: &Transaction<'_>, test: &PracticeTest) -> StorageResult<()> {
        let source = resolve_practice_test_source(&test.source, test.legacy_test_type.as_deref());
        let test_type = sanitize_optional_text(test.legacy_test_type.as_deref())
            .unwrap_or_else(|| source.clone());

        transaction.execute(
            "
            INSERT INTO practice_tests (
              id, date, test_type, source, form, question_count, score_percent,
              weak_topics_json, strong_topics_json, reflections, action_plan,
              minutes_spent, created_at, updated_at, deleted_at, delete_reason
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
              date = excluded.date,
              test_type = excluded.test_type,
              source = excluded.source,
              form = excluded.form,
              question_count = excluded.question_count,
              score_percent = excluded.score_percent,
              weak_topics_json = excluded.weak_topics_json,
              strong_topics_json = excluded.strong_topics_json,
              reflections = excluded.reflections,
              action_plan = excluded.action_plan,
              minutes_spent = excluded.minutes_spent,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              delete_reason = NULL
            ",
            params![
                test.id,
                test.date,
                test_type,
                source,
                test.form,
                test.question_count,
                test.score_percent,
                serde_json::to_string(&test.weak_topics)?,
                serde_json::to_string(&test.strong_topics)?,
                test.reflections,
                test.action_plan,
                test.minutes_spent,
                test.created_at,
                test.updated_at,
            ],
        )?;
        Ok(())
    }

    fn persist_weak_topic(&self, transaction: &Transaction<'_>, entry: &WeakTopicEntry) -> StorageResult<()> {
        transaction.execute(
            "
            INSERT INTO weak_topic_entries (
              id, topic, entry_type, priority, status, notes, last_seen_at, source_label,
              created_at, updated_at, deleted_at, delete_reason
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, NULL)
            ON CONFLICT(id) DO UPDATE SET
              topic = excluded.topic,
              entry_type = excluded.entry_type,
              priority = excluded.priority,
              status = excluded.status,
              notes = excluded.notes,
              last_seen_at = excluded.last_seen_at,
              source_label = excluded.source_label,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              deleted_at = NULL,
              delete_reason = NULL
            ",
            params![
                entry.id,
                entry.topic,
                serialize_weak_topic_entry_type(entry.entry_type),
                serialize_weak_topic_priority(entry.priority),
                serialize_weak_topic_status(entry.status),
                entry.notes,
                entry.last_seen_at,
                entry.source_label,
                entry.created_at,
                entry.updated_at,
            ],
        )?;
        Ok(())
    }

    fn reconcile_weak_topics(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        let practice_tests = self.read_practice_tests(transaction)?;
        let existing = self.reconciled_weak_topics(transaction, &practice_tests)?;
        let desired = merge_weak_topic_entries_from_practice_tests(&practice_tests, &existing);

        for entry in &desired {
            self.persist_weak_topic(transaction, entry)?;
        }

        let desired_auto_ids = desired
            .iter()
            .filter(|entry| entry.entry_type == WeakTopicEntryType::PracticeTest)
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        let deleted_at = now_iso();
        if desired_auto_ids.is_empty() {
            transaction.execute(
                "UPDATE weak_topic_entries
                 SET deleted_at = ?1, delete_reason = 'practice-test-sync'
                 WHERE entry_type = 'practice-test' AND deleted_at IS NULL",
                params![deleted_at],
            )?;
        } else {
            let placeholders = (0..desired_auto_ids.len())
                .map(|index| format!("?{}", index + 2))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "UPDATE weak_topic_entries
                 SET deleted_at = ?1, delete_reason = 'practice-test-sync'
                 WHERE entry_type = 'practice-test' AND deleted_at IS NULL AND id NOT IN ({})",
                placeholders
            );
            let mut parameters: Vec<&dyn rusqlite::ToSql> = vec![&deleted_at];
            for id in &desired_auto_ids {
                parameters.push(id);
            }
            transaction.execute(&sql, parameters.as_slice())?;
        }
        Ok(())
    }

    fn list_trash_items(&self, connection: &Connection) -> StorageResult<Vec<TrashItem>> {
        let mut items = Vec::new();
        items.extend(self.query_trash_items(connection, TrashEntityType::StudyBlock)?);
        items.extend(self.query_trash_items(connection, TrashEntityType::PracticeTest)?);
        items.extend(self.query_trash_items(connection, TrashEntityType::WeakTopic)?);
        items.sort_by(|left, right| right.deleted_at.cmp(&left.deleted_at));
        items.truncate(50);
        Ok(items)
    }

    fn query_trash_items(
        &self,
        connection: &Connection,
        entity_type: TrashEntityType,
    ) -> StorageResult<Vec<TrashItem>> {
        match entity_type {
            TrashEntityType::StudyBlock => {
                let mut statement = connection.prepare(
                    "SELECT id, task, date, deleted_at
                     FROM study_blocks
                     WHERE deleted_at IS NOT NULL
                     ORDER BY deleted_at DESC
                     LIMIT 50",
                )?;
                let rows = statement.query_map([], |row| {
                    Ok(TrashItem {
                        entity_type,
                        id: row.get(0)?,
                        title: row.get(1)?,
                        secondary_label: row.get(2)?,
                        deleted_at: row.get(3)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
            }
            TrashEntityType::PracticeTest => {
                let mut statement = connection.prepare(
                    "SELECT id, source, form, test_type, date, deleted_at
                     FROM practice_tests
                     WHERE deleted_at IS NOT NULL
                     ORDER BY deleted_at DESC
                     LIMIT 50",
                )?;
                let rows = statement.query_map([], |row| {
                    let source: String = row.get(1)?;
                    let form: String = row.get(2)?;
                    let test_type: String = row.get(3)?;
                    let resolved_source = resolve_practice_test_source(&source, Some(&test_type));

                    Ok(TrashItem {
                        entity_type,
                        id: row.get(0)?,
                        title: practice_test_label(&resolved_source, &form),
                        secondary_label: row.get(4)?,
                        deleted_at: row.get(5)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
            }
            TrashEntityType::WeakTopic => {
                let mut statement = connection.prepare(
                    "SELECT id, topic, source_label, deleted_at
                     FROM weak_topic_entries
                     WHERE deleted_at IS NOT NULL
                     ORDER BY deleted_at DESC
                     LIMIT 50",
                )?;
                let rows = statement.query_map([], |row| {
                    Ok(TrashItem {
                        entity_type,
                        id: row.get(0)?,
                        title: row.get(1)?,
                        secondary_label: row.get(2)?,
                        deleted_at: row.get(3)?,
                    })
                })?;
                rows.collect::<Result<Vec<_>, _>>().map_err(StorageError::from)
            }
        }
    }

    fn soft_delete(&self, entity_type: TrashEntityType, id: &str, reason: &str) -> StorageResult<()> {
        let mut connection = self.open_live_connection()?;
        let transaction = connection.transaction()?;
        let deleted_at = now_iso();
        let updated = match entity_type {
            TrashEntityType::StudyBlock => transaction.execute(
                "UPDATE study_blocks
                 SET deleted_at = ?1, delete_reason = ?2
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![deleted_at, reason, id],
            )?,
            TrashEntityType::PracticeTest => unreachable!(),
            TrashEntityType::WeakTopic => {
                let updated = transaction.execute(
                    "UPDATE weak_topic_entries
                     SET deleted_at = ?1, delete_reason = ?2
                     WHERE id = ?3 AND deleted_at IS NULL",
                    params![deleted_at, reason, id],
                )?;
                self.reconcile_weak_topics(&transaction)?;
                updated
            }
        };
        if updated == 0 {
            return Err(StorageError::Validation("Item not found.".into()));
        }
        self.touch_saved(&transaction)?;
        self.log_event(
            &transaction,
            "item_trashed",
            match entity_type {
                TrashEntityType::StudyBlock => "study_block",
                TrashEntityType::PracticeTest => "practice_test",
                TrashEntityType::WeakTopic => "weak_topic",
            },
            Some(id),
            None,
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn metadata_value(&self, connection: &Connection, key: &str) -> StorageResult<Option<String>> {
        connection
            .query_row(
                "SELECT value FROM app_metadata WHERE key = ?1 LIMIT 1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(StorageError::from)
    }

    fn set_metadata(&self, connection: &Connection, key: &str, value: &str) -> StorageResult<()> {
        connection.execute(
            "
            INSERT INTO app_metadata (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )?;
        Ok(())
    }

    fn set_metadata_tx(&self, transaction: &Transaction<'_>, key: &str, value: &str) -> StorageResult<()> {
        transaction.execute(
            "
            INSERT INTO app_metadata (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![key, value],
        )?;
        Ok(())
    }

    fn touch_saved(&self, transaction: &Transaction<'_>) -> StorageResult<()> {
        self.set_metadata_tx(transaction, "last_saved_at", &now_iso())
    }

    fn touch_saved_direct(&self, connection: &Connection) -> StorageResult<()> {
        self.set_metadata(connection, "last_saved_at", &now_iso())
    }

    fn log_event(
        &self,
        transaction: &Transaction<'_>,
        event_type: &str,
        entity_type: &str,
        entity_id: Option<&str>,
        details: Option<serde_json::Value>,
    ) -> StorageResult<()> {
        transaction.execute(
            "
            INSERT INTO audit_log (event_type, entity_type, entity_id, created_at, details_json)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ",
            params![
                event_type,
                entity_type,
                entity_id,
                now_iso(),
                serde_json::to_string(&details.unwrap_or_else(|| serde_json::json!({})))?,
            ],
        )?;
        Ok(())
    }

    fn normalize_study_block(
        &self,
        input: StudyBlockInput,
        existing: Option<&StudyBlock>,
        fallback_order: i64,
    ) -> StorageResult<StudyBlock> {
        validate_date(&input.date, "Study block date")?;
        validate_non_empty(&input.task, "Study block task")?;
        let start_time = input
            .start_time
            .unwrap_or_else(|| existing.map(|row| row.start_time.clone()).unwrap_or_default());
        let end_time = input
            .end_time
            .unwrap_or_else(|| existing.map(|row| row.end_time.clone()).unwrap_or_default());
        let is_overnight = input
            .is_overnight
            .unwrap_or_else(|| existing.map(|row| row.is_overnight).unwrap_or(false));
        if !start_time.trim().is_empty() || !end_time.trim().is_empty() {
            validate_time(&start_time, "Study block start time")?;
            validate_time(&end_time, "Study block end time")?;
            validate_time_range(&start_time, &end_time, is_overnight)?;
        }

        let legacy_duration = derive_duration_from_legacy_range(&start_time, &end_time, is_overnight)?;
        let (duration_hours, duration_minutes) = normalize_duration_parts(
            input.duration_hours.unwrap_or(legacy_duration.0),
            input.duration_minutes.unwrap_or(legacy_duration.1),
        );
        let completed = input
            .completed
            .unwrap_or_else(|| input.status == Some(StudyStatus::Completed) || existing.map(|row| row.completed).unwrap_or(false));
        let reminder_at = match input.reminder_at {
            Some(reminder_at) => {
                let trimmed = reminder_at.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }
            None => existing.and_then(|row| row.reminder_at.clone()),
        };
        let reminder_sent_at = match input.reminder_sent_at {
            Some(reminder_sent_at) => {
                let trimmed = reminder_sent_at.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }
            None => existing.and_then(|row| row.reminder_sent_at.clone()),
        };
        let timestamp = now_iso();
        let date = input.date;
        let day = input
            .day
            .unwrap_or_else(|| weekday_name(&date).unwrap_or_else(|_| "".into()));
        let order = input.order.unwrap_or_else(|| {
            existing
                .map(|row| if row.date == date { row.order } else { fallback_order })
                .unwrap_or(fallback_order)
        });
        Ok(StudyBlock {
            id: input.id.unwrap_or_else(new_id),
            date,
            day,
            duration_hours,
            duration_minutes,
            completed,
            order,
            start_time,
            end_time,
            is_overnight,
            category: normalize_study_task_category(&input.category, &input.task, input.notes.as_deref().unwrap_or("")),
            task: input.task.trim().to_string(),
            status: if completed { StudyStatus::Completed } else { StudyStatus::NotStarted },
            notes: sanitize_text(input.notes.as_deref().unwrap_or(""), ""),
            reminder_at,
            reminder_sent_at,
            created_at: existing
                .map(|row| row.created_at.clone())
                .unwrap_or_else(|| timestamp.clone()),
            updated_at: timestamp,
        })
    }

    fn normalize_practice_test(
        &self,
        input: PracticeTestInput,
        existing: Option<&PracticeTest>,
    ) -> StorageResult<PracticeTest> {
        validate_date(&input.date, "Practice test date")?;
        if input.question_count <= 0 {
            return Err(StorageError::Validation(
                "Practice test question count must be greater than 0.".into(),
            ));
        }
        if !(0.0..=100.0).contains(&input.score_percent) {
            return Err(StorageError::Validation(
                "Practice test score percent must be between 0 and 100.".into(),
            ));
        }
        if input.minutes_spent < 0 {
            return Err(StorageError::Validation(
                "Practice test minutes spent must be 0 or greater.".into(),
            ));
        }
        let timestamp = now_iso();
        let source = resolve_practice_test_source(&input.source, input.legacy_test_type.as_deref());
        Ok(PracticeTest {
            id: input.id.unwrap_or_else(new_id),
            date: input.date,
            source,
            form: sanitize_text(&input.form, ""),
            question_count: input.question_count,
            score_percent: input.score_percent,
            weak_topics: sanitize_list(&input.weak_topics),
            strong_topics: sanitize_list(&input.strong_topics),
            reflections: sanitize_text(&input.reflections, ""),
            action_plan: sanitize_text(&input.action_plan, ""),
            minutes_spent: input.minutes_spent,
            legacy_test_type: sanitize_optional_text(input.legacy_test_type.as_deref()),
            created_at: existing
                .map(|row| row.created_at.clone())
                .unwrap_or_else(|| timestamp.clone()),
            updated_at: timestamp,
        })
    }

    fn normalize_weak_topic(
        &self,
        input: WeakTopicInput,
        existing: Option<&WeakTopicEntry>,
    ) -> StorageResult<WeakTopicEntry> {
        validate_non_empty(&input.topic, "Weak topic")?;
        validate_date(&input.last_seen_at, "Weak topic last seen date")?;
        let timestamp = now_iso();
        Ok(WeakTopicEntry {
            id: input.id.unwrap_or_else(new_id),
            topic: input.topic.trim().to_string(),
            entry_type: input.entry_type.or_else(|| existing.map(|row| row.entry_type)).unwrap_or(WeakTopicEntryType::Manual),
            priority: input.priority,
            status: input.status,
            notes: sanitize_text(&input.notes, ""),
            last_seen_at: input.last_seen_at,
            source_label: sanitize_text(&input.source_label, "Manual"),
            created_at: existing
                .map(|row| row.created_at.clone())
                .unwrap_or_else(|| timestamp.clone()),
            updated_at: timestamp,
        })
    }

    fn validate_app_state(&self, state: &AppState) -> StorageResult<()> {
        self.validate_preferences(&state.preferences)?;
        for block in &state.study_blocks {
            validate_date(&block.date, "Study block date")?;
            if !block.start_time.trim().is_empty() || !block.end_time.trim().is_empty() {
                validate_time(&block.start_time, "Study block start time")?;
                validate_time(&block.end_time, "Study block end time")?;
                validate_time_range(&block.start_time, &block.end_time, block.is_overnight)?;
            }
            validate_non_empty(&block.task, "Study block task")?;
            validate_non_negative_integer(block.duration_hours, "Study block durationHours")?;
            validate_non_negative_integer(block.duration_minutes, "Study block durationMinutes")?;
            validate_study_task_category(&block.category)?;
            validate_date_time(&block.created_at, "Study block createdAt")?;
            validate_date_time(&block.updated_at, "Study block updatedAt")?;
        }
        for test in &state.practice_tests {
            validate_date(&test.date, "Practice test date")?;
            if test.question_count <= 0 || !(0.0..=100.0).contains(&test.score_percent) || test.minutes_spent < 0 {
                return Err(StorageError::Validation(
                    "Practice test values are outside the allowed range.".into(),
                ));
            }
            validate_date_time(&test.created_at, "Practice test createdAt")?;
            validate_date_time(&test.updated_at, "Practice test updatedAt")?;
        }
        for entry in &state.weak_topic_entries {
            validate_non_empty(&entry.topic, "Weak topic")?;
            validate_date(&entry.last_seen_at, "Weak topic lastSeenAt")?;
            validate_date_time(&entry.created_at, "Weak topic createdAt")?;
            validate_date_time(&entry.updated_at, "Weak topic updatedAt")?;
        }
        Ok(())
    }

    fn validate_preferences(&self, preferences: &Preferences) -> StorageResult<()> {
        validate_date(&preferences.last_active_date, "Preferences lastActiveDate")?;
        validate_date(&preferences.planner_focus_date, "Preferences plannerFocusDate")?;
        if !preferences.planner_filters.from_date.is_empty() {
            validate_date(&preferences.planner_filters.from_date, "Planner filter fromDate")?;
        }
        if !preferences.planner_filters.to_date.is_empty() {
            validate_date(&preferences.planner_filters.to_date, "Planner filter toDate")?;
        }
        if preferences.daily_goal_minutes < 0 {
            return Err(StorageError::Validation(
                "Daily goal minutes must be 0 or greater.".into(),
            ));
        }
        Ok(())
    }

    fn legacy_bootstrap_study_blocks(&self) -> StorageResult<Vec<StudyBlock>> {
        let defaults: Vec<BootstrapStudyBlock> = serde_json::from_str(BOOTSTRAP_SCHEDULE_JSON)?;
        let created_at = now_iso();
        let blocks = defaults
            .into_iter()
            .map(|entry| {
                self.normalize_study_block(
                    StudyBlockInput {
                        id: None,
                        date: entry.date,
                        day: Some(entry.day),
                        duration_hours: None,
                        duration_minutes: None,
                        completed: None,
                        order: None,
                        start_time: Some(entry.start_time),
                        end_time: Some(entry.end_time),
                        is_overnight: Some(false),
                        category: entry.category,
                        task: entry.task,
                        status: Some(entry.status),
                        notes: Some(entry.notes),
                        reminder_at: None,
                        reminder_sent_at: None,
                    },
                    None,
                    0,
                )
                .map(|mut block| {
                    block.created_at = created_at.clone();
                    block.updated_at = created_at.clone();
                    block
                })
            })
            .collect::<StorageResult<Vec<_>>>()?;

        Ok(reindex_study_blocks(blocks))
    }

    fn bootstrap_state(&self) -> StorageResult<AppState> {
        Ok(AppState {
            version: APP_STATE_VERSION,
            study_blocks: Vec::new(),
            practice_tests: Vec::new(),
            weak_topic_entries: Vec::new(),
            preferences: default_preferences(),
        })
    }

    fn study_block_identity(block: &StudyBlock) -> String {
        [
            block.date.trim().to_lowercase(),
            if block.start_time.trim().is_empty() {
                "task".into()
            } else {
                block.start_time.trim().to_lowercase()
            },
            block.category.trim().to_lowercase(),
            block.task.trim().to_lowercase(),
        ]
        .join("|")
    }

    fn run_integrity_check(connection: &Connection) -> StorageResult<()> {
        let mut statement = connection.prepare("PRAGMA integrity_check")?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        if rows.len() == 1 && rows[0] == "ok" {
            Ok(())
        } else {
            Err(StorageError::Recovery(format!(
                "SQLite integrity check failed: {}",
                rows.join("; ")
            )))
        }
    }
}

#[derive(Debug)]
struct StoredStudyBlock {
    block: StudyBlock,
    deleted_at: Option<String>,
}

#[derive(Debug)]
struct StoredPracticeTest {
    test: PracticeTest,
    deleted_at: Option<String>,
}

#[derive(Debug)]
struct StoredWeakTopic {
    entry: WeakTopicEntry,
    deleted_at: Option<String>,
}

fn calculate_counts<'a>(state: &AppState, trash: impl Iterator<Item = &'a TrashItem>) -> RecordCounts {
    let mut counts = RecordCounts {
        study_blocks: state.study_blocks.len(),
        practice_tests: state.practice_tests.len(),
        weak_topic_entries: state.weak_topic_entries.len(),
        trashed_study_blocks: 0,
        trashed_practice_tests: 0,
        trashed_weak_topic_entries: 0,
    };
    for item in trash {
        match item.entity_type {
            TrashEntityType::StudyBlock => counts.trashed_study_blocks += 1,
            TrashEntityType::PracticeTest => counts.trashed_practice_tests += 1,
            TrashEntityType::WeakTopic => counts.trashed_weak_topic_entries += 1,
        }
    }
    counts
}

fn sanitize_text(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_optional_text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn sanitize_list(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn validate_non_empty(value: &str, label: &str) -> StorageResult<()> {
    if value.trim().is_empty() {
        Err(StorageError::Validation(format!("{} is required.", label)))
    } else {
        Ok(())
    }
}

fn validate_date(value: &str, label: &str) -> StorageResult<()> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| StorageError::Validation(format!("{} must use YYYY-MM-DD.", label)))
}

fn validate_time(value: &str, label: &str) -> StorageResult<()> {
    NaiveTime::parse_from_str(value, "%H:%M")
        .map(|_| ())
        .map_err(|_| StorageError::Validation(format!("{} must use HH:MM 24-hour time.", label)))
}

fn validate_date_time(value: &str, label: &str) -> StorageResult<()> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|_| StorageError::Validation(format!("{} must be an ISO-8601 timestamp.", label)))
}

fn validate_time_range(start_time: &str, end_time: &str, is_overnight: bool) -> StorageResult<()> {
    let start = NaiveTime::parse_from_str(start_time, "%H:%M")
        .map_err(|_| StorageError::Validation("Start time must use HH:MM 24-hour time.".into()))?;
    let end = NaiveTime::parse_from_str(end_time, "%H:%M")
        .map_err(|_| StorageError::Validation("End time must use HH:MM 24-hour time.".into()))?;
    if start == end {
        return Err(StorageError::Validation(
            "Start and end times must be different.".into(),
        ));
    }
    if is_overnight {
        if end > start {
            return Err(StorageError::Validation(
                "Overnight blocks must end earlier than they start on the clock.".into(),
            ));
        }
        return Ok(());
    }
    if end < start {
        return Err(StorageError::Validation(
            "End time must be after start time unless overnight is enabled.".into(),
        ));
    }
    Ok(())
}

fn validate_non_negative_integer(value: i64, label: &str) -> StorageResult<()> {
    if value < 0 {
        Err(StorageError::Validation(format!("{} must be 0 or greater.", label)))
    } else {
        Ok(())
    }
}

fn normalize_duration_parts(hours: i64, minutes: i64) -> (i64, i64) {
    let safe_hours = hours.max(0);
    let safe_minutes = minutes.max(0);
    let total_minutes = safe_hours * 60 + safe_minutes;
    (total_minutes / 60, total_minutes % 60)
}

fn derive_duration_from_legacy_range(
    start_time: &str,
    end_time: &str,
    is_overnight: bool,
) -> StorageResult<(i64, i64)> {
    if start_time.trim().is_empty() || end_time.trim().is_empty() {
        return Ok((0, 0));
    }

    let start = NaiveTime::parse_from_str(start_time, "%H:%M")
        .map_err(|_| StorageError::Validation("Start time must use HH:MM 24-hour time.".into()))?;
    let end = NaiveTime::parse_from_str(end_time, "%H:%M")
        .map_err(|_| StorageError::Validation("End time must use HH:MM 24-hour time.".into()))?;
    let start_minutes = i64::from(start.num_seconds_from_midnight() / 60);
    let end_minutes = i64::from(end.num_seconds_from_midnight() / 60);
    let adjusted_end = if is_overnight && end_minutes < start_minutes {
        end_minutes + 24 * 60
    } else {
        end_minutes
    };
    let total_minutes = (adjusted_end - start_minutes).max(0);
    Ok((total_minutes / 60, total_minutes % 60))
}

fn normalize_study_task_category(category: &str, task: &str, notes: &str) -> String {
    let trimmed = category.trim();
    if matches!(trimmed, "Test" | "Review" | "Anki" | "Notes") {
        return trimmed.to_string();
    }

    let haystack = format!("{} {} {}", category, task, notes).to_lowercase();

    if haystack.contains("anki") {
        return "Anki".into();
    }
    if haystack.contains("nbme")
        || haystack.contains("uwsa")
        || haystack.contains("test")
        || haystack.contains("exam")
        || haystack.contains("assessment")
        || haystack.contains("uworld")
        || haystack.contains("truelearn")
        || haystack.contains("question")
    {
        return "Test".into();
    }
    if haystack.contains("note")
        || haystack.contains("notes")
        || haystack.contains("read")
        || haystack.contains("reading")
        || haystack.contains("lecture")
        || haystack.contains("podcast")
    {
        return "Notes".into();
    }

    "Review".into()
}

fn canonical_practice_test_source(value: &str) -> Option<&'static str> {
    let normalized = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    if normalized.contains("nbme") {
        Some("NBME")
    } else if normalized.contains("uwsa") {
        Some("UWSA")
    } else if normalized.contains("cms") {
        Some("CMS")
    } else if normalized.contains("free 120") || normalized.contains("free120") {
        Some("Free 120")
    } else if normalized.contains("amboss") {
        Some("Amboss")
    } else if normalized.contains("uworld") {
        Some("UWorld")
    } else if normalized.contains("truelearn") || normalized.contains("true learn") {
        Some("TrueLearn")
    } else if normalized.contains("other") {
        Some("Other")
    } else {
        None
    }
}

fn resolve_practice_test_source(source: &str, legacy_test_type: Option<&str>) -> String {
    let explicit_source = source.trim();
    if !explicit_source.is_empty() {
        return canonical_practice_test_source(explicit_source)
            .unwrap_or("Other")
            .to_string();
    }

    let fallback_source = legacy_test_type.unwrap_or("").trim();
    if !fallback_source.is_empty() {
        return canonical_practice_test_source(fallback_source)
            .unwrap_or("Other")
            .to_string();
    }

    "Other".into()
}

fn practice_test_label(source: &str, form: &str) -> String {
    let trimmed_source = source.trim();
    let trimmed_form = form.trim();

    if trimmed_source.is_empty() && trimmed_form.is_empty() {
        return "Practice test".into();
    }

    [trimmed_source, trimmed_form]
        .into_iter()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

fn validate_study_task_category(value: &str) -> StorageResult<()> {
    if matches!(value.trim(), "Test" | "Review" | "Anki" | "Notes") {
        Ok(())
    } else {
        Err(StorageError::Validation(
            "Study block category must be Test, Review, Anki, or Notes.".into(),
        ))
    }
}

fn reindex_study_blocks(mut blocks: Vec<StudyBlock>) -> Vec<StudyBlock> {
    blocks.sort_by(|left, right| {
        left.date
            .cmp(&right.date)
            .then(left.order.cmp(&right.order))
            .then(left.start_time.cmp(&right.start_time))
            .then(left.task.cmp(&right.task))
    });

    let mut next_order_by_date = std::collections::HashMap::<String, i64>::new();
    for block in &mut blocks {
        let entry = next_order_by_date.entry(block.date.clone()).or_insert(0);
        block.order = *entry;
        *entry += 1;
    }

    blocks
}

fn parse_string_list(raw: &str) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(raw)
        .map_err(|error| rusqlite::Error::FromSqlConversionFailure(raw.len(), Type::Text, Box::new(error)))
}

fn merge_weak_topic_entries_from_practice_tests(
    tests: &[PracticeTest],
    existing_entries: &[WeakTopicEntry],
) -> Vec<WeakTopicEntry> {
    let manual_entries = existing_entries
        .iter()
        .filter(|entry| entry.entry_type != WeakTopicEntryType::PracticeTest)
        .cloned()
        .collect::<Vec<_>>();
    let manual_topics = manual_entries
        .iter()
        .map(|entry| entry.topic.trim().to_lowercase())
        .collect::<std::collections::HashSet<_>>();
    let mut prior_auto_entries = std::collections::HashMap::new();
    for entry in existing_entries {
        if entry.entry_type == WeakTopicEntryType::PracticeTest {
            prior_auto_entries.insert(entry.topic.trim().to_lowercase(), entry.clone());
        }
    }

    let mut by_topic = std::collections::HashMap::new();
    for test in tests {
        let source_label = practice_test_label(&test.source, &test.form);

        for topic in &test.weak_topics {
            let trimmed = topic.trim();
            if trimmed.is_empty() {
                continue;
            }
            let key = trimmed.to_lowercase();
            if manual_topics.contains(&key) {
                continue;
            }
            let existing = by_topic
                .get(&key)
                .cloned()
                .or_else(|| prior_auto_entries.get(&key).cloned());
            let last_seen_at = existing
                .as_ref()
                .map(|entry| {
                    if entry.last_seen_at > test.date {
                        entry.last_seen_at.clone()
                    } else {
                        test.date.clone()
                    }
                })
                .unwrap_or_else(|| test.date.clone());
            let next = WeakTopicEntry {
                id: existing
                    .as_ref()
                    .map(|entry| entry.id.clone())
                    .unwrap_or_else(new_id),
                topic: existing
                    .as_ref()
                    .map(|entry| entry.topic.clone())
                    .unwrap_or_else(|| trimmed.to_string()),
                entry_type: WeakTopicEntryType::PracticeTest,
                priority: existing.as_ref().map(|entry| entry.priority).unwrap_or(WeakTopicPriority::High),
                status: existing.as_ref().map(|entry| entry.status).unwrap_or(WeakTopicStatus::Active),
                notes: existing.as_ref().map(|entry| entry.notes.clone()).unwrap_or_default(),
                last_seen_at: last_seen_at.clone(),
                source_label: if last_seen_at == test.date {
                    source_label.clone()
                } else {
                    existing
                        .as_ref()
                        .map(|entry| entry.source_label.clone())
                        .unwrap_or_else(|| source_label.clone())
                },
                created_at: existing
                    .as_ref()
                    .map(|entry| entry.created_at.clone())
                    .unwrap_or_else(now_iso),
                updated_at: now_iso(),
            };
            by_topic.insert(key, next);
        }
    }

    let mut merged = manual_entries;
    merged.extend(by_topic.into_values());
    merged.sort_by(|left, right| {
        weak_topic_priority_rank(left.priority)
            .cmp(&weak_topic_priority_rank(right.priority))
            .then(weak_topic_status_rank(left.status).cmp(&weak_topic_status_rank(right.status)))
            .then(right.last_seen_at.cmp(&left.last_seen_at))
            .then(left.topic.cmp(&right.topic))
    });
    merged
}

fn weak_topic_priority_rank(priority: WeakTopicPriority) -> usize {
    match priority {
        WeakTopicPriority::High => 0,
        WeakTopicPriority::Medium => 1,
        WeakTopicPriority::Low => 2,
    }
}

fn weak_topic_status_rank(status: WeakTopicStatus) -> usize {
    match status {
        WeakTopicStatus::Active => 0,
        WeakTopicStatus::Watching => 1,
        WeakTopicStatus::Improving => 2,
        WeakTopicStatus::Resolved => 3,
    }
}

fn default_preferences() -> Preferences {
    let today = today_key();
    Preferences {
        active_section: SectionId::Dashboard,
        last_active_date: today.clone(),
        theme_id: ThemeId::Aurora,
        daily_goal_minutes: 8 * 60,
        planner_filters: PlannerFilters {
            search: String::new(),
            category: "All".into(),
            status: StudyStatusFilter::All,
            from_date: String::new(),
            to_date: String::new(),
        },
        planner_sort: PlannerSort {
            field: PlannerSortField::Date,
            direction: SortDirection::Asc,
        },
        planner_mode: PlannerMode::Week,
        planner_focus_date: today,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn today_key() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

fn timestamp_slug() -> String {
    format!(
        "{}-{}",
        Utc::now().format("%Y%m%dT%H%M%S%3fZ"),
        Uuid::new_v4().simple()
    )
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn weekday_name(value: &str) -> StorageResult<String> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| StorageError::Validation("Date must use YYYY-MM-DD.".into()))?;
    Ok(date.format("%A").to_string())
}

fn sqlite_escape_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

fn parse_section_id(value: &str) -> rusqlite::Result<SectionId> {
    match value {
        "dashboard" => Ok(SectionId::Dashboard),
        "planner" => Ok(SectionId::Planner),
        "weakTopics" => Ok(SectionId::WeakTopics),
        "tests" => Ok(SectionId::Tests),
        "analytics" => Ok(SectionId::Analytics),
        "settings" => Ok(SectionId::Settings),
        _ => Err(enum_error("SectionId", value)),
    }
}

fn parse_study_status(value: &str) -> rusqlite::Result<StudyStatus> {
    match value {
        "Not Started" => Ok(StudyStatus::NotStarted),
        "In Progress" => Ok(StudyStatus::InProgress),
        "Completed" => Ok(StudyStatus::Completed),
        "Skipped" => Ok(StudyStatus::Skipped),
        _ => Err(enum_error("StudyStatus", value)),
    }
}

fn parse_study_status_filter(value: &str) -> rusqlite::Result<StudyStatusFilter> {
    match value {
        "Not Started" => Ok(StudyStatusFilter::NotStarted),
        "In Progress" => Ok(StudyStatusFilter::InProgress),
        "Completed" => Ok(StudyStatusFilter::Completed),
        "Skipped" => Ok(StudyStatusFilter::Skipped),
        "All" => Ok(StudyStatusFilter::All),
        _ => Err(enum_error("StudyStatusFilter", value)),
    }
}

fn parse_theme_id(value: &str) -> rusqlite::Result<ThemeId> {
    match value {
        "aurora" => Ok(ThemeId::Aurora),
        "ember" => Ok(ThemeId::Ember),
        "tide" => Ok(ThemeId::Tide),
        "bubblegum" => Ok(ThemeId::Bubblegum),
        "signal" => Ok(ThemeId::Signal),
        "prism" => Ok(ThemeId::Prism),
        _ => Err(enum_error("ThemeId", value)),
    }
}

fn parse_planner_sort_field(value: &str) -> rusqlite::Result<PlannerSortField> {
    match value {
        "date" => Ok(PlannerSortField::Date),
        "startTime" => Ok(PlannerSortField::StartTime),
        "category" => Ok(PlannerSortField::Category),
        "status" => Ok(PlannerSortField::Status),
        "task" => Ok(PlannerSortField::Task),
        _ => Err(enum_error("PlannerSortField", value)),
    }
}

fn parse_sort_direction(value: &str) -> rusqlite::Result<SortDirection> {
    match value {
        "asc" => Ok(SortDirection::Asc),
        "desc" => Ok(SortDirection::Desc),
        _ => Err(enum_error("SortDirection", value)),
    }
}

fn parse_planner_mode(value: &str) -> rusqlite::Result<PlannerMode> {
    match value {
        "week" => Ok(PlannerMode::Week),
        "database" => Ok(PlannerMode::Database),
        _ => Err(enum_error("PlannerMode", value)),
    }
}

fn parse_weak_topic_priority(value: &str) -> rusqlite::Result<WeakTopicPriority> {
    match value {
        "High" => Ok(WeakTopicPriority::High),
        "Medium" => Ok(WeakTopicPriority::Medium),
        "Low" => Ok(WeakTopicPriority::Low),
        _ => Err(enum_error("WeakTopicPriority", value)),
    }
}

fn parse_weak_topic_status(value: &str) -> rusqlite::Result<WeakTopicStatus> {
    match value {
        "Active" => Ok(WeakTopicStatus::Active),
        "Watching" => Ok(WeakTopicStatus::Watching),
        "Improving" => Ok(WeakTopicStatus::Improving),
        "Resolved" => Ok(WeakTopicStatus::Resolved),
        _ => Err(enum_error("WeakTopicStatus", value)),
    }
}

fn parse_weak_topic_entry_type(value: &str) -> rusqlite::Result<WeakTopicEntryType> {
    match value {
        "manual" => Ok(WeakTopicEntryType::Manual),
        "practice-test" => Ok(WeakTopicEntryType::PracticeTest),
        _ => Err(enum_error("WeakTopicEntryType", value)),
    }
}

fn enum_error(kind: &str, value: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        value.len(),
        Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Invalid {} value: {}", kind, value),
        )),
    )
}

fn serialize_section_id(value: SectionId) -> &'static str {
    match value {
        SectionId::Dashboard => "dashboard",
        SectionId::Planner => "planner",
        SectionId::WeakTopics => "weakTopics",
        SectionId::Tests => "tests",
        SectionId::Analytics => "analytics",
        SectionId::Settings => "settings",
    }
}

fn serialize_study_status(value: StudyStatus) -> &'static str {
    match value {
        StudyStatus::NotStarted => "Not Started",
        StudyStatus::InProgress => "In Progress",
        StudyStatus::Completed => "Completed",
        StudyStatus::Skipped => "Skipped",
    }
}

fn serialize_study_status_filter(value: StudyStatusFilter) -> &'static str {
    match value {
        StudyStatusFilter::NotStarted => "Not Started",
        StudyStatusFilter::InProgress => "In Progress",
        StudyStatusFilter::Completed => "Completed",
        StudyStatusFilter::Skipped => "Skipped",
        StudyStatusFilter::All => "All",
    }
}

fn serialize_theme_id(value: ThemeId) -> &'static str {
    match value {
        ThemeId::Aurora => "aurora",
        ThemeId::Ember => "ember",
        ThemeId::Tide => "tide",
        ThemeId::Bubblegum => "bubblegum",
        ThemeId::Signal => "signal",
        ThemeId::Prism => "prism",
    }
}

fn serialize_planner_sort_field(value: PlannerSortField) -> &'static str {
    match value {
        PlannerSortField::Date => "date",
        PlannerSortField::StartTime => "startTime",
        PlannerSortField::Category => "category",
        PlannerSortField::Status => "status",
        PlannerSortField::Task => "task",
    }
}

fn serialize_sort_direction(value: SortDirection) -> &'static str {
    match value {
        SortDirection::Asc => "asc",
        SortDirection::Desc => "desc",
    }
}

fn serialize_planner_mode(value: PlannerMode) -> &'static str {
    match value {
        PlannerMode::Week => "week",
        PlannerMode::Database => "database",
    }
}

fn serialize_weak_topic_priority(value: WeakTopicPriority) -> &'static str {
    match value {
        WeakTopicPriority::High => "High",
        WeakTopicPriority::Medium => "Medium",
        WeakTopicPriority::Low => "Low",
    }
}

fn serialize_weak_topic_status(value: WeakTopicStatus) -> &'static str {
    match value {
        WeakTopicStatus::Active => "Active",
        WeakTopicStatus::Watching => "Watching",
        WeakTopicStatus::Improving => "Improving",
        WeakTopicStatus::Resolved => "Resolved",
    }
}

fn serialize_weak_topic_entry_type(value: WeakTopicEntryType) -> &'static str {
    match value {
        WeakTopicEntryType::Manual => "manual",
        WeakTopicEntryType::PracticeTest => "practice-test",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_service() -> (TempDir, StorageService) {
        let temp_dir = TempDir::new().expect("tempdir");
        let service = StorageService::new(temp_dir.path().to_path_buf(), "test-app");
        (temp_dir, service)
    }

    #[test]
    fn load_creates_live_database_with_wal() {
        let (_temp, service) = test_service();
        let snapshot = service.load_snapshot().expect("load snapshot");
        assert!(Path::new(&snapshot.persistence.storage_path).exists());
        let connection = service.open_live_connection().expect("live connection");
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("journal mode");
        assert_eq!(mode.to_uppercase(), "WAL");
        assert!(!snapshot.state.study_blocks.is_empty());
    }

    #[test]
    fn legacy_browser_migration_preserves_source_and_imports_state() {
        let (_temp, service) = test_service();
        let baseline = service.load_snapshot().expect("baseline");
        let state = AppState {
            version: APP_STATE_VERSION,
            study_blocks: baseline.state.study_blocks.into_iter().take(1).collect(),
            practice_tests: vec![PracticeTest {
                id: new_id(),
                date: "2026-04-23".into(),
                source: String::new(),
                form: "13".into(),
                question_count: 40,
                score_percent: 72.0,
                weak_topics: vec!["Cardio".into()],
                strong_topics: vec!["Renal".into()],
                reflections: "notes".into(),
                action_plan: "plan".into(),
                minutes_spent: 70,
                legacy_test_type: Some("NBME".into()),
                created_at: now_iso(),
                updated_at: now_iso(),
            }],
            weak_topic_entries: vec![],
            preferences: default_preferences(),
        };

        let mut connection = service.open_live_connection().expect("live connection");
        let transaction = connection.transaction().expect("tx");
        service.clear_active_state(&transaction).expect("clear");
        transaction.commit().expect("commit");

        let migrated = service
            .migrate_legacy_browser_state("{\"legacy\":true}".into(), state)
            .expect("migrate");
        assert_eq!(migrated.state.practice_tests.len(), 1);
        assert_eq!(migrated.state.practice_tests[0].source, "NBME");
        assert!(migrated.persistence.legacy_migration_completed_at.is_some());
        let legacy_files = fs::read_dir(&service.paths.legacy_dir)
            .expect("legacy dir")
            .count();
        assert_eq!(legacy_files, 1);
    }

    #[test]
    fn soft_delete_and_restore_study_block() {
        let (_temp, service) = test_service();
        let snapshot = service.load_snapshot().expect("load snapshot");
        let id = snapshot.state.study_blocks[0].id.clone();

        let trashed = service.trash_study_block(id.clone()).expect("trash");
        assert!(trashed.state.study_blocks.iter().all(|block| block.id != id));
        assert!(trashed.trash.iter().any(|item| item.id == id));

        let restored = service
            .restore_trashed_item(TrashEntityType::StudyBlock, id.clone())
            .expect("restore");
        assert!(restored.state.study_blocks.iter().any(|block| block.id == id));
    }

    #[test]
    fn restore_from_snapshot_snapshots_live_state_first() {
        let (_temp, service) = test_service();
        let initial = service.load_snapshot().expect("initial");
        let initial_backup_count = initial.backups.len();

        let block = initial.state.study_blocks[0].clone();
        service
            .upsert_study_block(StudyBlockInput {
                id: Some(block.id.clone()),
                date: block.date,
                day: Some(block.day),
                start_time: block.start_time,
                end_time: block.end_time,
                is_overnight: Some(block.is_overnight),
                category: block.category,
                task: "Mutated task".into(),
                status: StudyStatus::Completed,
                notes: block.notes,
                reminder_at: None,
                reminder_sent_at: None,
            })
            .expect("mutate");

        let backups = service.list_backups().expect("list backups");
        let target_backup = backups.last().expect("oldest backup").id.clone();
        let restored = service.restore_from_snapshot(target_backup).expect("restore");
        assert!(restored.backups.len() >= initial_backup_count + 1);
        assert!(restored.state.study_blocks.iter().any(|entry| entry.task != "Mutated task"));
    }

    #[test]
    fn rejects_invalid_backup_artifact() {
        let (_temp, service) = test_service();
        let error = service
            .preview_backup_artifact("{\"app\":\"wrong-app\"}".into())
            .expect_err("should reject");
        assert!(error.to_string().contains("not a Step 2 Command Center backup artifact"));
    }

    #[test]
    fn corrupt_live_database_recovers_from_latest_snapshot() {
        let (_temp, service) = test_service();
        let snapshot = service.load_snapshot().expect("initial snapshot");
        let original_task = snapshot.state.study_blocks[0].task.clone();
        service.create_snapshot("manual-test-backup").expect("snapshot");

        fs::write(&service.paths.live_db, b"not-a-sqlite-database").expect("corrupt db");

        let recovered = service.load_snapshot().expect("recover");
        assert_eq!(recovered.state.study_blocks[0].task, original_task);
        assert!(recovered
            .persistence
            .recovery_message
            .as_deref()
            .unwrap_or_default()
            .contains("Recovered from snapshot"));
        assert!(fs::read_dir(&service.paths.quarantine_dir)
            .expect("quarantine dir")
            .next()
            .is_some());
    }

    #[test]
    fn migration_creates_pre_migration_backup_when_schema_exists() {
        let (_temp, service) = test_service();
        let initial = service.load_snapshot().expect("initial snapshot");
        let initial_backup_count = initial.backups.len();

        let connection = service.open_live_connection().expect("live connection");
        connection
            .pragma_update(None, "user_version", 0)
            .expect("reset schema version");

        let migrated = service.load_snapshot().expect("migrated snapshot");
        assert!(migrated.backups.len() > initial_backup_count);
    }

    #[test]
    fn study_block_update_persists_across_reload() {
        let (_temp, service) = test_service();
        let initial = service.load_snapshot().expect("initial snapshot");
        let block = initial.state.study_blocks[0].clone();

        service
            .upsert_study_block(StudyBlockInput {
                id: Some(block.id.clone()),
                date: block.date,
                day: Some(block.day),
                start_time: block.start_time,
                end_time: block.end_time,
                is_overnight: Some(block.is_overnight),
                category: block.category,
                task: "Persisted task".into(),
                status: StudyStatus::InProgress,
                notes: "persisted notes".into(),
                reminder_at: None,
                reminder_sent_at: None,
            })
            .expect("upsert study block");

        let reloaded = service.load_snapshot().expect("reloaded snapshot");
        let persisted = reloaded
            .state
            .study_blocks
            .iter()
            .find(|entry| entry.id == block.id)
            .expect("persisted block");
        assert_eq!(persisted.task, "Persisted task");
        assert_eq!(persisted.status, StudyStatus::InProgress);
        assert_eq!(persisted.notes, "persisted notes");
    }
}
