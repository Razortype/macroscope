pub mod analyzer;
pub mod db;
pub mod error;
pub mod executor;
pub mod finding;
pub mod identity;
pub mod keychain;
pub mod provider_config;
pub mod snapshot;

use std::sync::Arc;

use analyzer::{ClaudeStatus, ClaudeCliProvider, AnalyzerService};
use db::Db;
use provider_config::{ProviderConfig, ProviderId};
use executor::{ExecutionReport, get_allowed_prefixes, get_allowed_globs, get_denied_prefixes, get_denied_exact, ToggleAction};
use finding::Finding;
use snapshot::{Snapshot, SnapshotMeta};
use identity::target_resolver::ResolvedTarget;
use tauri::State;
use libc;

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

// ── Provider config commands ─────────────────────────────────────────────────

#[tauri::command]
async fn get_provider_config(db: State<'_, Db>) -> Result<ProviderConfig, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || ProviderConfig::load(&db))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn set_provider_config(config: ProviderConfig, db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || config.save(&db))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn set_provider_secret(provider: ProviderId, secret: String) -> Result<(), String> {
    let account = provider
        .keychain_account()
        .ok_or_else(|| format!("{} does not use API keys", provider.display_name()))?;
    keychain::keychain_set(account, &secret).map_err(Into::into)
}

#[tauri::command]
async fn clear_provider_secret(provider: ProviderId) -> Result<(), String> {
    let account = provider
        .keychain_account()
        .ok_or_else(|| format!("{} does not use API keys", provider.display_name()))?;
    keychain::keychain_delete(account).map_err(Into::into)
}

#[tauri::command]
async fn has_provider_secret(provider: ProviderId) -> Result<bool, String> {
    let Some(account) = provider.keychain_account() else {
        return Ok(false);
    };
    keychain::keychain_has(account).map_err(Into::into)
}

// ── Executor commands ────────────────────────────────────────────────────────

/// Execute paths that have been identity-reviewed in the preview modal.
/// `safe_paths` are SafeOrphan items; `companion_approved` are CompanionNotRunning
/// items the user individually opted into. All other ActionClass values are never sent.
#[tauri::command]
async fn execute_previewed(
    safe_paths: Vec<String>,
    companion_approved: Vec<String>,
    db: State<'_, Db>,
) -> Result<ExecutionReport, String> {
    let db = db.inner().clone();
    executor::execute_previewed_paths(safe_paths, companion_approved, &db)
        .await
        .map_err(Into::into)
}

// ── Launchctl toggle command ─────────────────────────────────────────────────

/// Build the launchctl service target string in Rust using the actual running
/// user's UID from libc. The frontend passes only the label and kind; it never
/// constructs or supplies the service target string.
fn build_service_target(label: &str, kind: &str) -> Result<(String, bool), String> {
    let uid = unsafe { libc::getuid() };
    match kind {
        "user_agent" | "login_item" => Ok((format!("gui/{uid}/{label}"), false)),
        "user_daemon"               => Ok((format!("user/{uid}/{label}"), false)),
        "system_daemon" | "system_agent" => Ok((format!("system/{label}"), true)),
        other => Err(format!("unknown persistence kind: {other}")),
    }
}

#[tauri::command]
async fn toggle_persistence(
    label: String,
    kind: String,
    action: String,
) -> Result<bool, String> {
    let action_enum = match action.as_str() {
        "disable" => ToggleAction::Disable,
        "enable" => ToggleAction::Enable,
        other => return Err(format!("unknown action: {other}")),
    };
    let (service_target, requires_sudo) = build_service_target(&label, &kind)?;
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

// ── Preview execution command ────────────────────────────────────────────────

/// Resolve finding target paths to a per-item identity-classified list.
/// Parent directories (~/Library/Caches, ~/Library/Logs) are expanded to their
/// direct children so the UI can show each item with its ActionClass before any
/// execution occurs. Runs du in a blocking thread pool.
#[tauri::command]
async fn preview_execution(
    snapshot_id: i64,
    paths: Vec<String>,
    db: State<'_, Db>,
) -> Result<Vec<ResolvedTarget>, String> {
    let db = db.inner().clone();
    let payload = tokio::task::spawn_blocking(move || db.get_snapshot_payload(snapshot_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;

    let snapshot: Snapshot = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    let installed = snapshot.apps.as_ref().map(|a| a.installed.clone()).unwrap_or_default();
    let classified = snapshot.apps.as_ref().map(|a| a.classified_leftovers.clone()).unwrap_or_default();
    let processes = snapshot.processes.clone().unwrap_or_default();

    let result = tokio::task::spawn_blocking(move || {
        identity::target_resolver::resolve_finding_targets(&paths, &installed, &classified, &processes)
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(result)
}

// ── Snapshot patch commands ──────────────────────────────────────────────────

/// Persist executed/partial path sets back to the snapshot JSON blob.
/// Called fire-and-forget from the frontend after execute_previewed resolves.
#[tauri::command]
async fn patch_snapshot_actions(
    snapshot_id: i64,
    executed_paths: Vec<String>,
    partial_paths: Vec<String>,
    db: State<'_, Db>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let payload_str = db.get_snapshot_payload(snapshot_id).map_err(Into::<String>::into)?;
        let mut snap: Snapshot = serde_json::from_str(&payload_str).map_err(|e| e.to_string())?;
        snap.executed_paths = executed_paths;
        snap.partial_paths = partial_paths;
        let updated = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
        db.update_snapshot_payload(snapshot_id, &updated).map_err(Into::<String>::into)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Persist a single persistence entry's disabled state back to the snapshot JSON blob.
/// Called fire-and-forget from the frontend after toggle_persistence resolves.
#[tauri::command]
async fn patch_snapshot_persistence(
    snapshot_id: i64,
    label: String,
    disabled: bool,
    db: State<'_, Db>,
) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let payload_str = db.get_snapshot_payload(snapshot_id).map_err(Into::<String>::into)?;
        let mut snap: Snapshot = serde_json::from_str(&payload_str).map_err(|e| e.to_string())?;
        if let Some(persistence) = snap.persistence.as_mut() {
            for entry in persistence.entries.iter_mut() {
                if entry.label == label {
                    entry.disabled = disabled;
                    break;
                }
            }
        }
        let updated = serde_json::to_string(&snap).map_err(|e| e.to_string())?;
        db.update_snapshot_payload(snapshot_id, &updated).map_err(Into::<String>::into)
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
    if !claude_status.available {
        return Err(claude_status
            .error
            .clone()
            .unwrap_or_else(|| "Claude CLI not available".into()));
    }
    let path = claude_status.path.clone().ok_or_else(|| {
        "claude path is None despite available=true".to_string()
    })?;
    let provider: Arc<dyn AnalyzerService> = Arc::new(ClaudeCliProvider { path });
    analyzer::analyze_snapshot(snapshot_id, presets, db.inner(), provider, &app)
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

    // On first launch (key absent), silently populate project_roots from auto-detection.
    // A stored "[]" means the user intentionally cleared it — don't re-run.
    if db.get_setting("project_roots").ok().flatten().is_none() {
        let detected = executor::auto_detect_project_roots();
        let n = detected.len();
        let paths: Vec<String> = detected.iter().map(|p| p.display().to_string()).collect();
        let json = serde_json::to_string(&paths).unwrap_or_else(|_| "[]".to_string());
        if let Err(e) = db.set_setting("project_roots", &json) {
            eprintln!("[macroscope] warning: could not save project_roots: {e}");
        }
        if n > 0 {
            eprintln!("[macroscope] auto-detected {n} project roots: {paths:?}");
        }
    }

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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            take_snapshot,
            save_snapshot,
            list_snapshots,
            get_snapshot,
            delete_snapshot,
            get_setting,
            set_setting,
            list_settings,
            get_provider_config,
            set_provider_config,
            set_provider_secret,
            clear_provider_secret,
            has_provider_secret,
            get_claude_status,
            analyze_snapshot,
            latest_snapshot_id,
            get_findings_for_snapshot,
            get_allowed_prefixes,
            get_allowed_globs,
            get_denied_prefixes,
            get_denied_exact,
            toggle_persistence,
            reveal_in_finder,
            get_app_version,
            get_lifetime_stats,
            preview_execution,
            execute_previewed,
            patch_snapshot_actions,
            patch_snapshot_persistence,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
