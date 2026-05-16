use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::db::{settings_keys, Db};
use crate::error::AppError;
use crate::finding::{Finding, SuggestedAction};
use crate::snapshot::Snapshot;

// Compiled-in defaults — always present regardless of AppSupport directory state.
const DISK_AUDIT_PROMPT: &str = include_str!("../prompts/disk-audit.md");
const SECURITY_AUDIT_PROMPT: &str = include_str!("../prompts/security-audit.md");

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
pub fn filter_snapshot_for_preset(
    snapshot: &Snapshot,
    preset: &str,
) -> Result<serde_json::Value, AppError> {
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

/// Run the Claude CLI against a snapshot stored in the DB and return validated findings.
///
/// Snapshot JSON (~38 KB) is inlined directly into the prompt argument — no temp
/// file or file-read tool access required. claude -p receives all context in a
/// single argument string, well within macOS ARG_MAX.
///
/// Actual command line:
///   <claude_path> -p "<prompt_template>\n\n# Snapshot data\n\n```json\n<json>\n```" --output-format=json
///
/// Output format: `--output-format=json` emits a single JSON object at process exit:
///   { "type": "result", "subtype": "success", "result": "<text>", "is_error": false, ... }
/// The `.result` field contains Claude's raw text response (the findings JSON array).
pub async fn analyze_snapshot(
    snapshot_id: i64,
    preset: String,
    db: &Db,
    claude_status: &ClaudeStatus,
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

    // Load snapshot payload from DB
    let payload = db.get_snapshot_payload(snapshot_id)?;
    let snapshot: Snapshot = serde_json::from_str(&payload)?;

    // Filter to only the fields this preset needs
    let filtered = filter_snapshot_for_preset(&snapshot, &preset)?;
    let filtered_json = serde_json::to_string_pretty(&filtered)?;

    // Inline snapshot JSON directly into the prompt — no file I/O needed
    let template = load_prompt(&preset)?;
    let full_prompt = format!("{template}\n\n# Snapshot data\n\n```json\n{filtered_json}\n```");

    let output = tokio::time::timeout(
        Duration::from_secs(180),
        tokio::process::Command::new(&claude_path)
            .arg("-p")
            .arg(&full_prompt)
            .arg("--output-format=json")
            .output(),
    )
    .await
    .map_err(|_| AppError::ClaudeCli("Claude CLI timed out after 180 seconds".into()))?
    .map_err(|e| AppError::ClaudeCli(format!("Failed to spawn claude: {e}")))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse the outer --output-format=json envelope
    let envelope: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| {
        AppError::ClaudeCli(format!(
            "Failed to parse claude JSON envelope: {e}\nstdout: {stdout}\nstderr: {stderr}"
        ))
    })?;

    if envelope
        .get("is_error")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let msg = envelope
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::ClaudeCli(format!("Claude returned an error: {msg}")));
    }

    let result_text = envelope
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            AppError::ClaudeCli(format!(
                "No 'result' field in claude output. stdout: {stdout}"
            ))
        })?;

    // Defensively strip markdown code fences Claude occasionally emits
    let json_text = strip_code_fences(result_text);

    let mut findings: Vec<Finding> = serde_json::from_str(json_text.trim()).map_err(|e| {
        AppError::ClaudeCli(format!(
            "Failed to parse findings array: {e}\nContent: {json_text}"
        ))
    })?;

    // Validation and normalisation
    for f in &mut findings {
        // Fill missing UUIDs (Claude occasionally omits them)
        if f.id.trim().is_empty() {
            f.id = uuid::Uuid::new_v4().to_string();
        }
        // Security-audit must never delete paths — override if Claude ignored the instruction
        if preset == "security-audit" && f.suggested_action == SuggestedAction::DeletePaths {
            f.suggested_action = SuggestedAction::Investigate;
            f.paths_to_remove = None;
            f.estimated_bytes_freed = None;
        }
        // Ensure optional fields are absent when action is not delete_paths
        if f.suggested_action != SuggestedAction::DeletePaths {
            f.paths_to_remove = None;
            f.estimated_bytes_freed = None;
        }
    }

    Ok(findings)
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
