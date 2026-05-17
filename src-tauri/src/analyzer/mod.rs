pub mod providers;

use std::sync::Arc;

use async_trait::async_trait;
use tauri::{AppHandle, Emitter};

use serde::Serialize;

use crate::db::Db;
use crate::error::AppError;
use crate::finding::{Finding, SuggestedAction};
use crate::snapshot::{AuditTokenUsage, Snapshot};

// Re-exports so lib.rs import paths are unchanged
pub use providers::claude_cli::{
    ClaudeStatus, ClaudeCliProvider, compute_claude_status, detect_claude_path,
};
pub use providers::claude_cli::expand_tilde;

/// Auto-detect Claude CLI without DB lookup (used when path_override is empty).
pub fn detect_claude_path_simple() -> Option<String> {
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

// ── Compiled-in prompt defaults ───────────────────────────────────────────────

const DISK_AUDIT_PROMPT: &str = include_str!("../../prompts/disk-audit.md");
const SECURITY_AUDIT_PROMPT: &str = include_str!("../../prompts/security-audit.md");
const APP_LIFECYCLE_AUDIT_PROMPT: &str = include_str!("../../prompts/app-lifecycle-audit.md");
const FILE_INVENTORY_AUDIT_PROMPT: &str = include_str!("../../prompts/file-inventory-audit.md");

// ── Trait types ───────────────────────────────────────────────────────────────

pub struct AnalysisRequest {
    pub system_prompt: String,
    pub user_prompt: String,
    pub model: Option<String>,
}

pub struct ChunkPhase {
    pub name: String,
    pub pid: Option<u32>,
    pub elapsed_ms: u64,
    pub timing: Option<serde_json::Value>,
}

pub struct AnalysisChunk {
    pub text: String,
    pub usage: Option<AuditTokenUsage>,
    /// Phase notification for Tauri event forwarding. Non-None means this chunk
    /// carries progress metadata rather than (or in addition to) text content.
    pub phase: Option<ChunkPhase>,
}

#[derive(Debug, Serialize)]
pub struct TestConnectionResult {
    pub ok: bool,
    pub model_responded: Option<String>,
    pub error: Option<String>,
}

#[async_trait]
pub trait AnalyzerService: Send + Sync {
    async fn analyze(
        &self,
        request: AnalysisRequest,
        on_chunk: Box<dyn FnMut(AnalysisChunk) + Send>,
    ) -> Result<(String, AuditTokenUsage), AppError>;

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError>;

    fn provider_id(&self) -> &'static str;

    /// Human-readable display name for UI labels.
    fn display_name(&self) -> &'static str;
}

// ── Snapshot filtering ────────────────────────────────────────────────────────

pub fn filter_snapshot_for_preset(
    snapshot: &Snapshot,
    preset: &str,
) -> Result<serde_json::Value, AppError> {
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

// ── Prompt loading ────────────────────────────────────────────────────────────

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

fn appsupport_prompt_path(preset: &str) -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("prompts")
        .join(format!("{preset}.md")))
}

// ── Analysis orchestration ────────────────────────────────────────────────────

/// Run all presets against a snapshot in parallel using the given provider.
/// Each preset's findings are persisted immediately. Partial failures are
/// emitted as `analyzer:preset_failed` events without blocking other presets.
pub async fn analyze_snapshot(
    snapshot_id: i64,
    presets: Vec<String>,
    db: &Db,
    provider: Arc<dyn AnalyzerService>,
    app: &AppHandle,
) -> Result<Vec<Finding>, AppError> {
    let payload = db.get_snapshot_payload(snapshot_id)?;
    let snapshot: Snapshot = serde_json::from_str(&payload)?;

    let tasks: Vec<_> = presets
        .into_iter()
        .map(|preset| {
            let snap = snapshot.clone();
            let db = db.clone();
            let app = app.clone();
            let provider = Arc::clone(&provider);
            tokio::spawn(async move {
                let result = run_single_preset(&snap, &preset, provider, &app).await;
                match result {
                    Ok((findings, usage)) => {
                        if let Err(e) = db.save_analysis_result(snapshot_id, &preset, &findings) {
                            eprintln!("[macroscope] Could not persist {preset} results: {e}");
                        }
                        (preset, Ok((findings, usage)))
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

    let mut all_findings: Vec<Finding> = Vec::new();
    let mut all_usage: std::collections::HashMap<String, AuditTokenUsage> =
        std::collections::HashMap::new();

    for handle in tasks {
        match handle.await {
            Ok((preset, Ok((findings, usage)))) => {
                all_findings.extend(findings);
                all_usage.insert(preset, usage);
            }
            Ok((preset, Err(e))) => {
                eprintln!("[macroscope] Preset {preset} failed: {e}");
            }
            Err(e) => eprintln!("[macroscope] Task panicked: {e}"),
        }
    }

    if !all_usage.is_empty() {
        match db.get_snapshot_payload(snapshot_id) {
            Ok(payload_str) => {
                if let Ok(mut snap) = serde_json::from_str::<Snapshot>(&payload_str) {
                    snap.token_usage = all_usage;
                    if let Ok(updated) = serde_json::to_string(&snap) {
                        if let Err(e) = db.update_snapshot_payload(snapshot_id, &updated) {
                            eprintln!("[macroscope] Could not persist token usage: {e}");
                        }
                    }
                }
            }
            Err(e) => eprintln!(
                "[macroscope] Could not load snapshot for token usage patch: {e}"
            ),
        }
    }

    Ok(all_findings)
}

// ── Single-preset execution ───────────────────────────────────────────────────

async fn run_single_preset(
    snapshot: &Snapshot,
    preset: &str,
    provider: Arc<dyn AnalyzerService>,
    app: &AppHandle,
) -> Result<(Vec<Finding>, AuditTokenUsage), AppError> {
    let filtered = filter_snapshot_for_preset(snapshot, preset)?;
    let filtered_json = serde_json::to_string_pretty(&filtered)?;
    let template = load_prompt(preset)?;

    // system_prompt: the audit instructions template
    // user_prompt: the snapshot data section
    let system_prompt = template;
    let user_prompt = format!("# Snapshot data\n\n```json\n{filtered_json}\n```");

    let _ = app.emit(
        "analyzer:progress",
        serde_json::json!({ "preset": preset, "phase": "starting", "elapsed_ms": 0u64 }),
    );

    let preset_owned = preset.to_string();
    let app_clone = app.clone();

    let on_chunk = Box::new(move |chunk: AnalysisChunk| {
        if let Some(phase) = chunk.phase {
            let mut payload = serde_json::json!({
                "preset": preset_owned,
                "phase": phase.name,
                "elapsed_ms": phase.elapsed_ms,
            });
            if let Some(pid) = phase.pid {
                payload["pid"] = serde_json::json!(pid);
            }
            if let Some(t) = phase.timing {
                payload["timing"] = t;
            }
            if let Some(usage) = &chunk.usage {
                payload["usage"] = serde_json::json!({
                    "input_tokens": usage.input_tokens,
                    "output_tokens": usage.output_tokens,
                    "cache_read_input_tokens": usage.cache_read_input_tokens,
                    "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                });
            }
            let _ = app_clone.emit("analyzer:progress", payload);
        }
    });

    let request = AnalysisRequest {
        system_prompt,
        user_prompt,
        model: None,
    };

    let (text, token_usage) = provider.analyze(request, on_chunk).await?;

    let json_text = strip_code_fences(&text);
    let mut findings: Vec<Finding> =
        extract_json_array(json_text.trim()).map_err(|e| {
            AppError::ClaudeCli(format!(
                "Failed to parse findings array: {e}\nContent: {json_text}"
            ))
        })?;

    validate_findings(&mut findings, preset);
    Ok((findings, token_usage))
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

fn strip_code_fences(s: &str) -> String {
    let s = s.trim();
    if !s.starts_with("```") {
        return s.to_string();
    }
    let after_open = s.find('\n').map(|i| &s[i + 1..]).unwrap_or(s);
    if let Some(stripped) = after_open.trim_end().strip_suffix("```") {
        return stripped.trim_end().to_string();
    }
    after_open.to_string()
}

/// Parse a findings array from provider output that may contain leading prose
/// or trailing text. Fast path: text already starts with `[`. Slow path: scan
/// for the first `[` and last `]` and attempt to parse the bracketed span.
/// Falls back to a direct parse of the original text to surface the real error.
fn extract_json_array(s: &str) -> Result<Vec<Finding>, serde_json::Error> {
    if s.starts_with('[') {
        return serde_json::from_str(s);
    }
    if let (Some(start), Some(end)) = (s.find('['), s.rfind(']')) {
        if start < end {
            if let Ok(findings) = serde_json::from_str::<Vec<Finding>>(&s[start..=end]) {
                return Ok(findings);
            }
        }
    }
    serde_json::from_str(s)
}
