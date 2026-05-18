use std::path::{Path, PathBuf};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use tauri::Manager;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountSummary {
    pub id: String,
    pub email: String,
    pub created_at: String,
    pub last_login_at: Option<String>,
    pub email_verified_at: Option<String>,
}

fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("accounts").join("accounts.sqlite3")
}

fn open_db(app_data_dir: &Path) -> Result<Connection, String> {
    let path = db_path(app_data_dir);
    let parent = path.parent().expect("accounts.sqlite3 always has a parent");
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Unable to create accounts directory: {e}"))?;
    let conn =
        Connection::open(&path).map_err(|e| format!("Unable to open accounts database: {e}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_meta (
            version INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id                TEXT PRIMARY KEY,
            email_normalized  TEXT NOT NULL UNIQUE,
            email_display     TEXT NOT NULL,
            password_hash     TEXT NOT NULL,
            created_at        TEXT NOT NULL,
            last_login_at     TEXT,
            email_verified_at TEXT
        );
    "#,
    )
    .map_err(|e| format!("Schema init failed: {e}"))?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_meta", [], |row| row.get(0))
        .map_err(|e| format!("Schema meta query failed: {e}"))?;
    if count == 0 {
        conn.execute("INSERT INTO schema_meta (version) VALUES (1)", [])
            .map_err(|e| format!("Schema meta insert failed: {e}"))?;
    }

    Ok(())
}

fn validate_email(email: &str) -> Result<(String, String), String> {
    let trimmed = email.trim();
    let at_count = trimmed.chars().filter(|&c| c == '@').count();
    if at_count != 1 {
        return Err("INVALID_EMAIL".to_string());
    }
    let at_pos = trimmed.find('@').unwrap();
    let local = &trimmed[..at_pos];
    let domain = &trimmed[at_pos + 1..];
    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err("INVALID_EMAIL".to_string());
    }
    let normalized = trimmed.to_lowercase();
    Ok((normalized, trimmed.to_string()))
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() < 10 {
        return Err("PASSWORD_TOO_SHORT".to_string());
    }
    if !password.chars().any(|c| c.is_ascii_digit()) {
        return Err("PASSWORD_REQUIRES_NUMBER".to_string());
    }
    if !password
        .chars()
        .any(|c| c.is_ascii() && !c.is_ascii_alphanumeric())
    {
        return Err("PASSWORD_REQUIRES_SPECIAL".to_string());
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Password hashing failed: {e}"))
}

fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    let parsed =
        PasswordHash::new(hash).map_err(|e| format!("Invalid stored hash: {e}"))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

fn get_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data directory: {e}"))
}

// Inner functions used by both commands and tests.

pub fn count_inner(app_data_dir: &Path) -> Result<u32, String> {
    let conn = open_db(app_data_dir)?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| format!("Query failed: {e}"))?;
    Ok(count as u32)
}

pub fn list_emails_inner(app_data_dir: &Path) -> Result<Vec<String>, String> {
    let conn = open_db(app_data_dir)?;
    let mut stmt = conn
        .prepare("SELECT email_display FROM accounts ORDER BY created_at")
        .map_err(|e| format!("Prepare failed: {e}"))?;
    let emails: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Query failed: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(emails)
}

pub fn create_inner(
    app_data_dir: &Path,
    email: String,
    password: String,
) -> Result<AccountSummary, String> {
    let (email_normalized, email_display) = validate_email(&email)?;
    validate_password(&password)?;

    let conn = open_db(app_data_dir)?;

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM accounts WHERE email_normalized = ?1",
            params![email_normalized],
            |row| row.get(0),
        )
        .map_err(|e| format!("Query failed: {e}"))?;
    if exists > 0 {
        return Err("EMAIL_IN_USE".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    let password_hash = hash_password(&password)?;

    conn.execute(
        "INSERT INTO accounts (id, email_normalized, email_display, password_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, email_normalized, email_display, password_hash, created_at],
    )
    .map_err(|e| format!("Insert failed: {e}"))?;

    Ok(AccountSummary {
        id,
        email: email_display,
        created_at,
        last_login_at: None,
        email_verified_at: None,
    })
}

pub fn verify_inner(
    app_data_dir: &Path,
    email: String,
    password: String,
) -> Result<AccountSummary, String> {
    let (email_normalized, _) = validate_email(&email)?;

    let conn = open_db(app_data_dir)?;

    let result: Result<(String, String, String, String, Option<String>, Option<String>), _> =
        conn.query_row(
            "SELECT id, email_display, password_hash, created_at, last_login_at, email_verified_at \
             FROM accounts WHERE email_normalized = ?1",
            params![email_normalized],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        );

    let (id, email_display, stored_hash, created_at, _, email_verified_at) =
        result.map_err(|_| "INVALID_CREDENTIALS".to_string())?;

    if !verify_password(&password, &stored_hash)? {
        return Err("INVALID_CREDENTIALS".to_string());
    }

    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE accounts SET last_login_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| format!("Update failed: {e}"))?;

    Ok(AccountSummary {
        id,
        email: email_display,
        created_at,
        last_login_at: Some(now),
        email_verified_at,
    })
}

// Tauri commands.

#[tauri::command]
pub fn account_count(app: tauri::AppHandle) -> Result<u32, String> {
    count_inner(&get_app_data_dir(&app)?)
}

#[tauri::command]
pub fn account_list_emails(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    list_emails_inner(&get_app_data_dir(&app)?)
}

#[tauri::command]
pub fn account_create(
    app: tauri::AppHandle,
    email: String,
    password: String,
) -> Result<AccountSummary, String> {
    create_inner(&get_app_data_dir(&app)?, email, password)
}

#[tauri::command]
pub fn account_verify(
    app: tauri::AppHandle,
    email: String,
    password: String,
) -> Result<AccountSummary, String> {
    verify_inner(&get_app_data_dir(&app)?, email, password)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    #[test]
    fn create_account_succeeds() {
        let dir = tmp();
        let summary = create_inner(dir.path(), "user@example.com".into(), "Password1!".into());
        assert!(summary.is_ok(), "expected create to succeed: {:?}", summary);
        let s = summary.unwrap();
        assert!(!s.id.is_empty());
        assert_eq!(s.email, "user@example.com");
        assert!(s.last_login_at.is_none());
    }

    #[test]
    fn duplicate_normalized_email_rejected() {
        let dir = tmp();
        create_inner(dir.path(), "User@Example.com".into(), "Password1!".into()).unwrap();
        let second = create_inner(dir.path(), "user@example.com".into(), "Password1!".into());
        assert!(
            second.is_err(),
            "expected duplicate to be rejected"
        );
        assert!(
            second.unwrap_err().contains("EMAIL_IN_USE"),
            "error must contain EMAIL_IN_USE"
        );
    }

    #[test]
    fn count_increments_correctly() {
        let dir = tmp();
        assert_eq!(count_inner(dir.path()).unwrap(), 0);
        create_inner(dir.path(), "a@example.com".into(), "Password1!".into()).unwrap();
        assert_eq!(count_inner(dir.path()).unwrap(), 1);
        create_inner(dir.path(), "b@example.com".into(), "Password1!".into()).unwrap();
        assert_eq!(count_inner(dir.path()).unwrap(), 2);
    }

    #[test]
    fn correct_password_verifies() {
        let dir = tmp();
        create_inner(dir.path(), "user@example.com".into(), "Password1!".into()).unwrap();
        let result = verify_inner(dir.path(), "user@example.com".into(), "Password1!".into());
        assert!(result.is_ok(), "correct password should verify: {:?}", result);
        assert!(result.unwrap().last_login_at.is_some());
    }

    #[test]
    fn wrong_password_rejected() {
        let dir = tmp();
        create_inner(dir.path(), "user@example.com".into(), "Password1!".into()).unwrap();
        let result = verify_inner(dir.path(), "user@example.com".into(), "WrongPass1!".into());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "INVALID_CREDENTIALS");
    }

    #[test]
    fn policy_rejects_too_short() {
        let dir = tmp();
        let result = create_inner(dir.path(), "x@y.com".into(), "Short1!".into());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PASSWORD_TOO_SHORT");
    }

    #[test]
    fn policy_rejects_no_number() {
        let dir = tmp();
        let result = create_inner(dir.path(), "x@y.com".into(), "LongPassword!".into());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PASSWORD_REQUIRES_NUMBER");
    }

    #[test]
    fn policy_rejects_no_special() {
        let dir = tmp();
        let result = create_inner(dir.path(), "x@y.com".into(), "LongPassword1".into());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "PASSWORD_REQUIRES_SPECIAL");
    }
}
