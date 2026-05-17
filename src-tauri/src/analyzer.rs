use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::io::AsyncBufReadExt;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::db::{settings_keys, Db};
use crate::error::AppError;
use crate::finding::{Finding, SuggestedAction};
use crate::snapshot::Snapshot;

// Compiled-in defaults — always present regardless of AppSupport directory state.
const DISK_AUDIT_PROMPT: &str = include_str!("../prompts/disk-audit.md");
const SECURITY_AUDIT_PROMPT: &str = include_str!("../prompts/security-audit.md");
const APP_LIFECYCLE_AUDIT_PROMPT: &str = include_str!("../prompts/app-lifecycle-audit.md");
const FILE_INVENTORY_AUDIT_PROMPT: &str = include_str!("../prompts/file-inventory-audit.md");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

pub fn compute_claude_status(db: &Db) -> ClaudeStatus {
    let Some(path) = detect_claude_path(db) else {
        return ClaudeStatus {
            available: false,
            path: None,
            version: None,
            error: Some(
                "Claude CLI not found. Checked /opt/homebrew/bin/claude, \
                 ~/.local/bin/claude, /usr/local/bin/claude, ~/.claude/local/claude. \
                 Configure a custom path in Settings."
                    .to_string(),
            ),
        };
    };

    // Run claude --version synchronously (called during app setup, before async runtime)
    match std::process::Command::new(&path).arg("--version").output() {
        Ok(out) if out.status.success() => {
            let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
            ClaudeStatus {
                available: true,
                path: Some(path),
                version: Some(version),
                error: None,
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            ClaudeStatus {
                available: false,
                path: Some(path),
                version: None,
                error: Some(format!("claude --version failed: {stderr}")),
            }
        }
        Err(e) => ClaudeStatus {
            available: false,
            path: Some(path),
            version: None,
            error: Some(format!("failed to run claude: {e}")),
        },
    }
}

pub fn detect_claude_path(db: &Db) -> Option<String> {
    // 1. User-configured path
    if let Ok(Some(p)) = db.get_setting(settings_keys::CLAUDE_CLI_PATH) {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }

    // 2. Auto-detect in known locations (Apple Silicon Homebrew first)
    let candidates = [
        "/opt/homebrew/bin/claude",
        "~/.local/bin/claude",
        "/usr/local/bin/claude",
        "~/.claude/local/claude",
    ];

    for raw in candidates {
        let path = expand_tilde(raw);
        if path.exists() {
            return Some(path.display().to_string());
        }
    }

    None
}

pub(crate) fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(s)
}

// ── Snapshot filtering ───────────────────────────────────────────────────────

/// Returns a serde_json::Value containing only the snapshot keys relevant to
/// the given preset, reducing token cost and keeping Claude focused.
///
/// For `app-lifecycle-audit`, the raw apps array is replaced with a pre-grouped
/// summary (Rust does deterministic filtering; Claude does insight only).
pub fn filter_snapshot_for_preset(
    snapshot: &Snapshot,
    preset: &str,
) -> Result<serde_json::Value, AppError> {
    // app-lifecycle-audit uses a summarized payload, not the raw key extraction path
    if preset == "app-lifecycle-audit" {
        let summary = snapshot
            .apps
            .as_ref()
            .map(crate::snapshot::apps::summarize_for_analyzer)
            .unwrap_or_default();
        return Ok(serde_json::json!({
            "created_at": snapshot.created_at,
            "apps": summary,
        }));
    }

    if preset == "file-inventory-audit" {
        let summary = snapshot
            .large_files
            .as_ref()
            .map(crate::snapshot::large_files::summarize_for_analyzer)
            .unwrap_or_default();
        return Ok(serde_json::json!({
            "created_at": snapshot.created_at,
            "files": summary,
        }));
    }

    let keys: &[&str] = match preset {
        "disk-audit" => &["created_at", "disk", "processes"],
        "security-audit" => &[
            "created_at",
            "network",
            "persistence",
            "users",
            "kernel",
            "partial_failures",
        ],
        other => return Err(AppError::Config(format!("unknown preset: {other}"))),
    };

    let full = serde_json::to_value(snapshot)?;
    let map = full
        .as_object()
        .ok_or_else(|| AppError::Config("snapshot is not a JSON object".into()))?;

    let filtered: serde_json::Map<String, serde_json::Value> = keys
        .iter()
        .filter_map(|k| map.get(*k).map(|v| (k.to_string(), v.clone())))
        .collect();

    Ok(serde_json::Value::Object(filtered))
}

// ── Prompt loading ───────────────────────────────────────────────────────────

/// Load a prompt preset. Checks ~/Library/Application Support/Macroscope/prompts/
/// first so the user can override bundled defaults without rebuilding the app.
/// Falls back to the compiled-in constant if the file is absent or unreadable.
pub fn load_prompt(preset: &str) -> Result<String, AppError> {
    let override_path = appsupport_prompt_path(preset)?;
    if override_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&override_path) {
            return Ok(content);
        }
    }
    match preset {
        "disk-audit" => Ok(DISK_AUDIT_PROMPT.to_string()),
        "security-audit" => Ok(SECURITY_AUDIT_PROMPT.to_string()),
        "app-lifecycle-audit" => Ok(APP_LIFECYCLE_AUDIT_PROMPT.to_string()),
        "file-inventory-audit" => Ok(FILE_INVENTORY_AUDIT_PROMPT.to_string()),
        other => Err(AppError::Config(format!("unknown preset: {other}"))),
    }
}

/// Copy bundled defaults to AppSupport/prompts/ on first run so the user
/// can discover and edit them. Skips files that already exist (no overwrite).
pub fn copy_default_prompts() -> Result<(), AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    let dir = home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("prompts");
    std::fs::create_dir_all(&dir)?;

    for (name, content) in [
        ("disk-audit", DISK_AUDIT_PROMPT),
        ("security-audit", SECURITY_AUDIT_PROMPT),
        ("app-lifecycle-audit", APP_LIFECYCLE_AUDIT_PROMPT),
        ("file-inventory-audit", FILE_INVENTORY_AUDIT_PROMPT),
    ] {
        let dest = dir.join(format!("{name}.md"));
        if !dest.exists() {
            std::fs::write(&dest, content)?;
        }
    }
    Ok(())
}

fn appsupport_prompt_path(preset: &str) -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("prompts")
        .join(format!("{preset}.md")))
}

// ── Claude spawn ─────────────────────────────────────────────────────────────

/// Run all requested presets against a snapshot in parallel. Presets are independent
/// Claude invocations; each filters the snapshot to only its relevant fields.
///
/// Each preset's findings are persisted to DB immediately on success. If a preset
/// fails, `analyzer:preset_failed` is emitted so the UI can surface it without
/// blocking the overall flow — the other presets' results are still saved and returned.
///
/// Command line per preset (output-format=json, no temp file, snapshot inlined):
///   <claude_path> -p "<template>\n\n# Snapshot data\n\n```json\n<json>\n```" --output-format=json
pub async fn analyze_snapshot(
    snapshot_id: i64,
    presets: Vec<String>,
    db: &Db,
    claude_status: &ClaudeStatus,
    app: &AppHandle,
) -> Result<Vec<Finding>, AppError> {
    if !claude_status.available {
        return Err(AppError::ClaudeCli(
            claude_status
                .error
                .clone()
                .unwrap_or_else(|| "Claude CLI not available".into()),
        ));
    }
    let claude_path = claude_status.path.clone().unwrap();

    // Load and parse snapshot once — shared across all preset tasks via clone
    let payload = db.get_snapshot_payload(snapshot_id)?;
    let snapshot: Snapshot = serde_json::from_str(&payload)?;

    // Spawn one task per preset; each task is fully self-contained
    let tasks: Vec<_> = presets
        .into_iter()
        .map(|preset| {
            let snap = snapshot.clone();
            let path = claude_path.clone();
            let db = db.clone();
            let app = app.clone();
            tokio::spawn(async move {
                let result = run_single_preset(&snap, &preset, &path, &app).await;
                match result {
                    Ok(findings) => {
                        if let Err(e) = db.save_analysis_result(snapshot_id, &preset, &findings) {
                            eprintln!("[macroscope] Could not persist {preset} results: {e}");
                        }
                        (preset, Ok(findings))
                    }
                    Err(e) => {
                        let _ = app.emit(
                            "analyzer:preset_failed",
                            serde_json::json!({ "preset": preset, "error": e.to_string() }),
                        );
                        (preset, Err(e))
                    }
                }
            })
        })
        .collect();

    // Collect results; partial failures have already been emitted as events
    let mut all_findings: Vec<Finding> = Vec::new();
    for handle in tasks {
        match handle.await {
            Ok((_, Ok(findings))) => all_findings.extend(findings),
            Ok((preset, Err(e))) => {
                eprintln!("[macroscope] Preset {preset} failed: {e}");
            }
            Err(e) => eprintln!("[macroscope] Task panicked: {e}"),
        }
    }

    Ok(all_findings)
}

// ── Single-preset execution ──────────────────────────────────────────────────

/// Run the Claude CLI for one preset against a pre-loaded Snapshot.
///
/// Phase mapping (emitted as `analyzer:progress` events on `app`):
///   starting  — before spawn
///   analyzing — system/init received (Claude processing the prompt)
///   waiting   — rate_limit_event received (API back-pressure, dominant ~30-90s)
///   complete  — result event received with success
///   error     — result event received with is_error=true
///
/// Returns validated findings. Does NOT touch the DB — caller persists.
async fn run_single_preset(
    snapshot: &Snapshot,
    preset: &str,
    claude_path: &str,
    app: &AppHandle,
) -> Result<Vec<Finding>, AppError> {
    let start = Instant::now();

    let filtered = filter_snapshot_for_preset(snapshot, preset)?;
    let filtered_json = serde_json::to_string_pretty(&filtered)?;
    let template = load_prompt(preset)?;
    let full_prompt = format!("{template}\n\n# Snapshot data\n\n```json\n{filtered_json}\n```");

    let _ = app.emit(
        "analyzer:progress",
        serde_json::json!({ "preset": preset, "phase": "starting", "elapsed_ms": 0u64 }),
    );

    let mut child = tokio::process::Command::new(claude_path)
        .arg("-p")
        .arg(&full_prompt)
        .arg("--output-format=stream-json")
        .arg("--verbose")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::ClaudeCli(format!("Failed to spawn claude: {e}")))?;

    let pid = child.id();

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::ClaudeCli("No stdout pipe from claude".into()))?;

    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let mut result_text: Option<String> = None;
    let mut is_error = false;

    let read_result = tokio::time::timeout(Duration::from_secs(300), async {
        while let Some(line) = lines.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let elapsed_ms = start.elapsed().as_millis() as u64;
            match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "system/init" => {
                    let _ = app.emit(
                        "analyzer:progress",
                        serde_json::json!({
                            "preset": preset,
                            "phase": "analyzing",
                            "elapsed_ms": elapsed_ms,
                            "pid": pid,
                        }),
                    );
                }
                "rate_limit_event" => {
                    let _ = app.emit(
                        "analyzer:progress",
                        serde_json::json!({
                            "preset": preset,
                            "phase": "waiting",
                            "elapsed_ms": elapsed_ms,
                            "pid": pid,
                        }),
                    );
                }
                "result" => {
                    let error_flag =
                        event.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                    is_error = error_flag;
                    let timing = serde_json::json!({
                        "duration_ms": event.get("duration_ms").and_then(|v| v.as_u64()),
                        "duration_api_ms": event.get("duration_api_ms").and_then(|v| v.as_u64()),
                    });
                    let _ = app.emit(
                        "analyzer:progress",
                        serde_json::json!({
                            "preset": preset,
                            "phase": if is_error { "error" } else { "complete" },
                            "elapsed_ms": elapsed_ms,
                            "pid": pid,
                            "timing": timing,
                        }),
                    );
                    result_text =
                        event.get("result").and_then(|v| v.as_str()).map(str::to_string);
                }
                _ => {}
            }
        }
        Ok::<(), std::io::Error>(())
    })
    .await;

    child.wait().await.ok();

    read_result
        .map_err(|_| AppError::ClaudeCli("Claude CLI timed out after 300 seconds".into()))?
        .map_err(|e| AppError::ClaudeCli(format!("IO error reading claude output: {e}")))?;

    if is_error {
        let msg = result_text.as_deref().unwrap_or("unknown error");
        return Err(AppError::ClaudeCli(format!("Claude returned an error: {msg}")));
    }

    let text = result_text
        .ok_or_else(|| AppError::ClaudeCli("No result event in claude stream-json output".into()))?;

    let json_text = strip_code_fences(&text);
    let mut findings: Vec<Finding> = serde_json::from_str(json_text.trim()).map_err(|e| {
        AppError::ClaudeCli(format!("Failed to parse findings array: {e}\nContent: {json_text}"))
    })?;

    validate_findings(&mut findings, preset);
    Ok(findings)
}

fn validate_findings(findings: &mut Vec<Finding>, preset: &str) {
    use crate::finding::Category;
    for f in findings.iter_mut() {
        if f.id.trim().is_empty() {
            f.id = uuid::Uuid::new_v4().to_string();
        }
        if preset == "security-audit" && f.suggested_action == SuggestedAction::DeletePaths {
            f.suggested_action = SuggestedAction::Investigate;
            f.paths_to_remove = None;
            f.estimated_bytes_freed = None;
        }
        if preset == "app-lifecycle-audit" {
            f.category = Category::Apps;
        }
        if preset == "file-inventory-audit" {
            f.category = Category::Files;
        }
        if f.suggested_action != SuggestedAction::DeletePaths {
            f.paths_to_remove = None;
            f.estimated_bytes_freed = None;
        }
    }
}

/// Strip ```json ... ``` or ``` ... ``` code fences if Claude wraps its response.
fn strip_code_fences(s: &str) -> String {
    let s = s.trim();

    // Fast-path: no fences at all
    if !s.starts_with("```") {
        return s.to_string();
    }

    // Strip the opening fence line (``` or ```json)
    let after_open = s
        .find('\n')
        .map(|i| &s[i + 1..])
        .unwrap_or(s);

    // Strip the closing fence if present
    if let Some(stripped) = after_open.trim_end().strip_suffix("```") {
        return stripped.trim_end().to_string();
    }

    // Fence opener was present but no closer — return everything after the opener
    after_open.to_string()
}
