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
use analyzer::providers::{
    anthropic_api::AnthropicApiProvider,
    gemini::GeminiProvider,
    ollama::OllamaProvider,
    openai::OpenAiProvider,
};
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
async fn take_snapshot(app: tauri::AppHandle, db: State<'_, Db>) -> Result<Snapshot, String> {
    Ok(snapshot::take_snapshot(&app, db.inner()).await)
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
async fn set_provider_secret(
    provider: ProviderId,
    secret: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let account = provider
        .keychain_account()
        .ok_or_else(|| format!("{} does not use API keys", provider.display_name()))?;
    // Keychain write first; only flag if successful.
    keychain::keychain_set(account, &secret).map_err(Into::<String>::into)?;
    // Mirror existence into SQLite so has_provider_secret never touches keychain.
    let flag_key = format!("provider_has_key:{}", provider.as_str());
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.set_setting(&flag_key, "1"))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn clear_provider_secret(provider: ProviderId) -> Result<(), String> {
    let account = provider
        .keychain_account()
        .ok_or_else(|| format!("{} does not use API keys", provider.display_name()))?;
    keychain::keychain_delete(account).map_err(Into::into)
}

#[tauri::command]
async fn has_provider_secret(provider: ProviderId, db: State<'_, Db>) -> Result<bool, String> {
    // Non-key providers (claude_cli, ollama) never have secrets.
    if provider.keychain_account().is_none() {
        return Ok(false);
    }
    let flag_key = format!("provider_has_key:{}", provider.as_str());
    let db = db.inner().clone();
    let val = tokio::task::spawn_blocking(move || db.get_setting(&flag_key))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;
    Ok(val.as_deref() == Some("1"))
}

// ── Provider factory ─────────────────────────────────────────────────────────

fn build_provider(
    provider_id: &ProviderId,
    config: &ProviderConfig,
) -> Result<Arc<dyn AnalyzerService>, String> {
    use analyzer::providers::{
        anthropic_api::AnthropicApiProvider,
        gemini::GeminiProvider,
        ollama::OllamaProvider,
        openai::OpenAiProvider,
    };

    match provider_id {
        ProviderId::ClaudeCli => {
            let path = if config.claude_cli.path_override.is_empty() {
                analyzer::detect_claude_path_simple().ok_or_else(|| {
                    "Claude CLI not found. Check Settings → AI Provider → Claude CLI".to_string()
                })?
            } else {
                config.claude_cli.path_override.clone()
            };
            Ok(Arc::new(ClaudeCliProvider { path }))
        }
        ProviderId::AnthropicApi => {
            let key = keychain::keychain_get(keychain::ACCOUNT_ANTHROPIC)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| {
                    "Anthropic API key not set. Add it in Settings → AI Provider".to_string()
                })?;
            Ok(Arc::new(AnthropicApiProvider {
                api_key: key,
                model: config.anthropic_api.model.clone(),
            }))
        }
        ProviderId::OpenAi => {
            let key = keychain::keychain_get(keychain::ACCOUNT_OPENAI)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| {
                    "OpenAI API key not set. Add it in Settings → AI Provider".to_string()
                })?;
            Ok(Arc::new(OpenAiProvider {
                api_key: key,
                model: config.openai.model.clone(),
            }))
        }
        ProviderId::Gemini => {
            let key = keychain::keychain_get(keychain::ACCOUNT_GEMINI)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| {
                    "No Gemini API key configured. Open Settings → AI Provider to add one, or switch to a different provider.".to_string()
                })?;
            Ok(Arc::new(GeminiProvider {
                api_key: key,
                model: config.gemini.model.clone(),
            }))
        }
        ProviderId::Ollama => {
            if config.ollama.model.is_empty() {
                return Err(
                    "No Ollama model selected. Choose one in Settings → AI Provider".to_string(),
                );
            }
            Ok(Arc::new(OllamaProvider {
                endpoint: config.ollama.endpoint.clone(),
                model: config.ollama.model.clone(),
            }))
        }
    }
}

#[tauri::command]
async fn test_provider_connection(
    provider_id: ProviderId,
    db: State<'_, Db>,
) -> Result<analyzer::TestConnectionResult, String> {
    let db_clone = db.inner().clone();
    let config = tokio::task::spawn_blocking(move || ProviderConfig::load(&db_clone))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e: crate::error::AppError| e.to_string())?;

    let provider = build_provider(&provider_id, &config)?;
    provider.test_connection().await.map_err(Into::into)
}

// ── Ollama model discovery ────────────────────────────────────────────────────

#[tauri::command]
async fn fetch_ollama_models(endpoint: String) -> Result<Vec<String>, String> {
    analyzer::providers::ollama::fetch_model_names(&endpoint)
        .await
        .map_err(Into::into)
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
    app: tauri::AppHandle,
) -> Result<Vec<Finding>, String> {
    let db_inner = db.inner().clone();
    let config = tokio::task::spawn_blocking(move || ProviderConfig::load(&db_inner))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e: crate::error::AppError| e.to_string())?;

    // Pre-flight: verify the active provider is reachable before starting audits
    let provider = build_provider(&config.active_provider, &config)?;
    let pre = provider.test_connection().await.map_err(|e| e.to_string())?;
    if !pre.ok {
        return Err(format!(
            "{} is not reachable: {} — check Settings → AI Provider",
            config.active_provider.display_name(),
            pre.error.as_deref().unwrap_or("unknown error")
        ));
    }

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

// ── Provider readiness check ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct ProviderReadiness {
    ready: bool,
    reason: Option<String>,
    active_provider: String,
}

#[tauri::command]
async fn is_provider_ready(db: State<'_, Db>) -> Result<ProviderReadiness, String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || -> Result<ProviderReadiness, String> {
        let config = provider_config::ProviderConfig::load(&db)
            .map_err(|e: crate::error::AppError| e.to_string())?;
        let active = config.active_provider.clone();
        let active_str = active.as_str().to_string();

        let has_key = if active.keychain_account().is_some() {
            let flag_key = format!("provider_has_key:{}", active.as_str());
            db.get_setting(&flag_key)
                .map(|v| v.as_deref() == Some("1"))
                .unwrap_or(false)
        } else {
            true
        };

        let (ready, reason) = match active {
            provider_config::ProviderId::ClaudeCli => (true, None),
            provider_config::ProviderId::AnthropicApi => {
                if !has_key {
                    (false, Some("Anthropic API key not set".to_string()))
                } else if config.anthropic_api.model.is_empty() {
                    (false, Some("Anthropic model not selected".to_string()))
                } else {
                    (true, None)
                }
            }
            provider_config::ProviderId::OpenAi => {
                if !has_key {
                    (false, Some("OpenAI API key not set".to_string()))
                } else if config.openai.model.is_empty() {
                    (false, Some("OpenAI model not selected".to_string()))
                } else {
                    (true, None)
                }
            }
            provider_config::ProviderId::Gemini => {
                if !has_key {
                    (false, Some("Gemini API key not set".to_string()))
                } else if config.gemini.model.is_empty() {
                    (false, Some("Gemini model not selected".to_string()))
                } else {
                    (true, None)
                }
            }
            provider_config::ProviderId::Ollama => {
                if config.ollama.endpoint.is_empty() {
                    (false, Some("Ollama endpoint not set".to_string()))
                } else if config.ollama.model.is_empty() {
                    (false, Some("Ollama model not selected".to_string()))
                } else {
                    (true, None)
                }
            }
        };

        Ok(ProviderReadiness { ready, reason, active_provider: active_str })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── First-run onboarding commands ────────────────────────────────────────────

#[tauri::command]
async fn get_first_run_state(db: State<'_, Db>) -> Result<bool, String> {
    let db = db.inner().clone();
    let value = tokio::task::spawn_blocking(move || {
        db.get_setting(db::settings_keys::FIRST_RUN_COMPLETED)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(Into::<String>::into)?;
    Ok(value.as_deref() == Some("true"))
}

#[tauri::command]
async fn set_first_run_state(completed: bool, db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    let value = if completed { "true" } else { "false" };
    tokio::task::spawn_blocking(move || {
        db.set_setting(db::settings_keys::FIRST_RUN_COMPLETED, value)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(Into::into)
}

#[tauri::command]
async fn reset_app_state(db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.factory_reset())
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

// ── System utility commands ───────────────────────────────────────────────────

// ── Permission probe commands ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct PermProbeResult {
    granted: bool,
}

#[tauri::command]
async fn probe_folder_access(path: String) -> Result<PermProbeResult, String> {
    let expanded = analyzer::expand_tilde(&path);
    match tokio::fs::read_dir(&expanded).await {
        Ok(_) => Ok(PermProbeResult { granted: true }),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            Ok(PermProbeResult { granted: false })
        }
        // NotFound means the folder doesn't exist — not a TCC block.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(PermProbeResult { granted: true })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn probe_automation_permission() -> Result<PermProbeResult, String> {
    let output = tokio::process::Command::new("osascript")
        .args(["-e", r#"tell application "System Events" to return name of first process"#])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(PermProbeResult { granted: true });
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // -1743 = errAEEventNotPermitted; "Not authorized" / "not allowed" in
    // some locales — all indicate TCC denial.
    let denied = stderr.contains("1743")
        || stderr.contains("Not authorized")
        || stderr.contains("not allowed");
    Ok(PermProbeResult { granted: !denied })
}

#[tauri::command]
async fn probe_full_disk_access() -> Result<PermProbeResult, String> {
    // ~/Library/Mail is the canonical FDA probe; only readable with FDA.
    let expanded = analyzer::expand_tilde("~/Library/Mail");
    match tokio::fs::read_dir(&expanded).await {
        Ok(_) => Ok(PermProbeResult { granted: true }),
        Err(_) => Ok(PermProbeResult { granted: false }),
    }
}

#[tauri::command]
async fn open_system_settings_pane(pane: String) -> Result<(), String> {
    const ALLOWED: &[&str] = &[
        "Automation", "DesktopFolder", "DownloadsFolder", "DocumentsFolder", "AllFiles",
    ];
    if !ALLOWED.contains(&pane.as_str()) {
        return Err(format!("unknown settings pane: {pane}"));
    }
    // Desktop/Downloads/Documents all map to the unified Files & Folders pane
    // (individual per-folder panes were removed in macOS 13 Ventura).
    let target = match pane.as_str() {
        "Automation" => "Privacy_Automation",
        "DesktopFolder" | "DownloadsFolder" | "DocumentsFolder" => "Privacy_FilesAndFolders",
        "AllFiles" => "Privacy_AllFiles",
        _ => unreachable!(),
    };
    // macOS 13+ (System Settings) format
    let modern = format!(
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?{target}"
    );
    let ok = tokio::process::Command::new("open")
        .arg(&modern)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        return Ok(());
    }
    // Fallback for macOS 12 and earlier
    let legacy = format!(
        "x-apple.systempreferences:com.apple.preference.security?{target}"
    );
    tokio::process::Command::new("open")
        .arg(&legacy)
        .status()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

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
            test_provider_connection,
            fetch_ollama_models,
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
            get_first_run_state,
            set_first_run_state,
            reset_app_state,
            probe_folder_access,
            probe_automation_permission,
            probe_full_disk_access,
            open_system_settings_pane,
            is_provider_ready,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
