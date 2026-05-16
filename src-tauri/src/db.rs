use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::error::AppError;

// Known settings keys — use these constants everywhere in Rust code
// rather than bare string literals to prevent typos.
pub mod settings_keys {
    pub const CLAUDE_CLI_PATH: &str = "claude_cli_path";
    pub const SNAPSHOT_RETENTION: &str = "snapshot_retention";
    pub const HOTKEY_COMBO: &str = "hotkey_combo";
    pub const HOTKEY_ENABLED: &str = "hotkey_enabled";
}

// Migrations applied in order. Index i is migration version i+1.
// Never edit existing entries — only append.
const MIGRATIONS: &[&str] = &[
    // v1: initial schema
    "CREATE TABLE snapshots (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       created_at TEXT    NOT NULL,
       payload    TEXT    NOT NULL
     );
     CREATE INDEX idx_snapshots_created_at ON snapshots(created_at DESC);
     CREATE TABLE settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );",
];

#[derive(Clone)]
pub struct Db {
    conn: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn new() -> Result<Self, AppError> {
        let path = db_path()?;
        // Ensure parent directory exists on every launch
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        // WAL mode: allows concurrent readers while writer is active
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

        let db = Db { conn: Arc::new(Mutex::new(conn)) };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);",
        )?;

        let current_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let pending = &MIGRATIONS[current_version as usize..];
        if pending.is_empty() {
            return Ok(());
        }

        for (i, sql) in pending.iter().enumerate() {
            let new_version = current_version + i as i64 + 1;
            // Each migration runs inside its own transaction
            conn.execute_batch(&format!(
                "BEGIN; {sql} INSERT INTO schema_version (version) VALUES ({new_version}); COMMIT;"
            ))?;
        }

        Ok(())
    }

    // ── Snapshot methods ────────────────────────────────────────────────────

    /// Insert a snapshot and enforce the retention limit. Returns the new row id.
    pub fn save_snapshot(
        &self,
        created_at: &str,
        payload: &str,
    ) -> Result<i64, AppError> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO snapshots (created_at, payload) VALUES (?1, ?2)",
            params![created_at, payload],
        )?;

        let id = conn.last_insert_rowid();

        // Retention enforcement
        let retention_str: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![settings_keys::SNAPSHOT_RETENTION],
                |row| row.get(0),
            )
            .ok();

        let limit: Option<i64> = retention_str
            .as_deref()
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|&n| n > 0);

        if let Some(n) = limit {
            conn.execute(
                "DELETE FROM snapshots WHERE id NOT IN (
                   SELECT id FROM snapshots ORDER BY created_at DESC LIMIT ?1
                 )",
                params![n],
            )?;
        }

        Ok(id)
    }

    pub fn list_snapshots(&self) -> Result<Vec<(i64, String)>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, created_at FROM snapshots ORDER BY id DESC",
        )?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_snapshot_payload(&self, id: i64) -> Result<String, AppError> {
        let conn = self.conn.lock().unwrap();
        let payload: String = conn.query_row(
            "SELECT payload FROM snapshots WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )?;
        Ok(payload)
    }

    pub fn delete_snapshot(&self, id: i64) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM snapshots WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Settings methods ─────────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Db(e)),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list_settings(&self) -> Result<Vec<(String, String)>, AppError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn db_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("macroscope.db"))
}
