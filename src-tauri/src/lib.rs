pub mod analyzer;
pub mod db;
pub mod error;
pub mod finding;
pub mod snapshot;

use analyzer::ClaudeStatus;
use db::Db;
use finding::Finding;
use snapshot::{Snapshot, SnapshotMeta};
use tauri::State;

// ── Snapshot commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn take_snapshot() -> Result<Snapshot, String> {
    Ok(snapshot::take_snapshot().await)
}

#[tauri::command]
async fn save_snapshot(snapshot: Snapshot, db: State<'_, Db>) -> Result<i64, String> {
    let created_at = snapshot.created_at.to_rfc3339();
    let payload = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.save_snapshot(&created_at, &payload))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn list_snapshots(db: State<'_, Db>) -> Result<Vec<SnapshotMeta>, String> {
    let db = db.inner().clone();
    let rows = tokio::task::spawn_blocking(move || db.list_snapshots())
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;

    rows.into_iter()
        .map(|(id, ts)| {
            let created_at = ts
                .parse::<chrono::DateTime<chrono::Utc>>()
                .map_err(|e| e.to_string())?;
            Ok(SnapshotMeta { id, created_at })
        })
        .collect()
}

#[tauri::command]
async fn get_snapshot(id: i64, db: State<'_, Db>) -> Result<Snapshot, String> {
    let db = db.inner().clone();
    let payload = tokio::task::spawn_blocking(move || db.get_snapshot_payload(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;
    serde_json::from_str(&payload).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_snapshot(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.delete_snapshot(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

// ── Settings commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn get_setting(key: String, db: State<'_, Db>) -> Result<Option<String>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_setting(&key))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn set_setting(key: String, value: String, db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.set_setting(&key, &value))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn list_settings(db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.list_settings())
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

// ── Analyzer commands ────────────────────────────────────────────────────────

#[tauri::command]
fn get_claude_status(status: State<'_, ClaudeStatus>) -> ClaudeStatus {
    status.inner().clone()
}

#[tauri::command]
async fn analyze_snapshot(
    snapshot_id: i64,
    preset: String,
    db: State<'_, Db>,
    claude_status: State<'_, ClaudeStatus>,
) -> Result<Vec<Finding>, String> {
    analyzer::analyze_snapshot(
        snapshot_id,
        preset,
        db.inner(),
        claude_status.inner(),
    )
    .await
    .map_err(Into::into)
}

// ── App setup ────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Db::new().expect("failed to open database");

    if let Err(e) = analyzer::copy_default_prompts() {
        eprintln!("[macroscope] Warning: could not copy default prompts: {e}");
    }

    let claude_status = analyzer::compute_claude_status(&db);

    if claude_status.available {
        println!(
            "[macroscope] Claude CLI: {} ({})",
            claude_status.path.as_deref().unwrap_or("?"),
            claude_status.version.as_deref().unwrap_or("?")
        );
    } else {
        println!(
            "[macroscope] Claude CLI unavailable: {}",
            claude_status.error.as_deref().unwrap_or("unknown error")
        );
    }

    tauri::Builder::default()
        .manage(db)
        .manage(claude_status)
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            take_snapshot,
            save_snapshot,
            list_snapshots,
            get_snapshot,
            delete_snapshot,
            get_setting,
            set_setting,
            list_settings,
            get_claude_status,
            analyze_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
