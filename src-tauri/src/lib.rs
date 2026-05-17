pub mod analyzer;
pub mod db;
pub mod error;
pub mod executor;
pub mod finding;
pub mod snapshot;

use analyzer::ClaudeStatus;
use db::Db;
use executor::{ExecutionReport, get_allowed_prefixes, get_allowed_globs, get_denied_prefixes, get_denied_exact, ToggleAction};
use finding::Finding;
use snapshot::{Snapshot, SnapshotMeta};
use tauri::State;

// ── Snapshot commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn take_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    Ok(snapshot::take_snapshot(&app).await)
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

// ── Executor commands ────────────────────────────────────────────────────────

#[tauri::command]
async fn execute_paths(paths: Vec<String>, db: State<'_, Db>) -> Result<ExecutionReport, String> {
    let db = db.inner().clone();
    executor::execute_actions(paths, &db)
        .await
        .map_err(Into::into)
}

// ── Launchctl toggle command ─────────────────────────────────────────────────

#[tauri::command]
async fn toggle_persistence(
    label: String,
    service_target: String,
    action: String,
    requires_sudo: bool,
) -> Result<bool, String> {
    let action_enum = match action.as_str() {
        "disable" => ToggleAction::Disable,
        "enable" => ToggleAction::Enable,
        other => return Err(format!("unknown action: {other}")),
    };
    tokio::task::spawn_blocking(move || {
        let result = executor::toggle_launchctl(&label, &service_target, action_enum, requires_sudo);
        if result.success {
            Ok(true)
        } else {
            Err(result.error.unwrap_or_else(|| "toggle failed".into()))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Analysis result commands ─────────────────────────────────────────────────

#[tauri::command]
async fn latest_snapshot_id(db: State<'_, Db>) -> Result<Option<i64>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.latest_snapshot_id())
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn get_findings_for_snapshot(snapshot_id: i64, db: State<'_, Db>) -> Result<Vec<Finding>, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.get_analysis_results_for_snapshot(snapshot_id))
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
    presets: Vec<String>,
    db: State<'_, Db>,
    claude_status: State<'_, ClaudeStatus>,
    app: tauri::AppHandle,
) -> Result<Vec<Finding>, String> {
    analyzer::analyze_snapshot(
        snapshot_id,
        presets,
        db.inner(),
        claude_status.inner(),
        &app,
    )
    .await
    .map_err(Into::into)
}

// ── Lifetime stats ────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct LifetimeStats {
    snapshots: usize,
    findings: usize,
    bytes_freed: u64,
}

#[tauri::command]
async fn get_lifetime_stats(db: State<'_, Db>) -> Result<LifetimeStats, String> {
    let db = db.inner().clone();
    let (snapshots, findings) = tokio::task::spawn_blocking(move || {
        let s = db.count_snapshots().unwrap_or(0);
        let f = db.count_all_findings().unwrap_or(0);
        (s, f)
    })
    .await
    .map_err(|e| e.to_string())?;

    // Parse audit.log to sum bytes where status is "moved" or "partial"
    let bytes_freed = read_bytes_freed_from_audit_log();

    Ok(LifetimeStats { snapshots, findings, bytes_freed })
}

fn read_bytes_freed_from_audit_log() -> u64 {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return 0,
    };
    let log_path = home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("audit.log");

    let content = match std::fs::read_to_string(&log_path) {
        Ok(c) => c,
        Err(_) => return 0,
    };

    let mut total: u64 = 0;
    for line in content.lines() {
        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
            let status = entry.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if status == "moved" || status == "partial" {
                let bytes = entry.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
                total += bytes;
            }
        }
    }
    total
}

// ── System utility commands ───────────────────────────────────────────────────

#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    let expanded = analyzer::expand_tilde(&path);
    tokio::process::Command::new("open")
        .args(["-R", &expanded.display().to_string()])
        .status()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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
            latest_snapshot_id,
            get_findings_for_snapshot,
            execute_paths,
            get_allowed_prefixes,
            get_allowed_globs,
            get_denied_prefixes,
            get_denied_exact,
            toggle_persistence,
            reveal_in_finder,
            get_app_version,
            get_lifetime_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
