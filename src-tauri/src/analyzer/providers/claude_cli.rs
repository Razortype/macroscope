use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt;

use crate::analyzer::{AnalysisChunk, AnalysisRequest, ChunkPhase, AnalyzerService, TestConnectionResult};
use crate::db::{settings_keys, Db};
use crate::error::AppError;
use crate::snapshot::AuditTokenUsage;

// ── ClaudeStatus (public, re-exported from analyzer) ─────────────────────────

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
    if let Ok(Some(p)) = db.get_setting(settings_keys::CLAUDE_CLI_PATH) {
        if Path::new(&p).exists() {
            return Some(p);
        }
    }

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

pub fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(s)
}

// ── ClaudeCliProvider ─────────────────────────────────────────────────────────

pub struct ClaudeCliProvider {
    pub path: String,
}

#[async_trait]
impl AnalyzerService for ClaudeCliProvider {
    fn provider_id(&self) -> &'static str {
        "claude_cli"
    }

    fn display_name(&self) -> &'static str {
        "Claude Code CLI"
    }

    async fn test_connection(&self) -> Result<TestConnectionResult, AppError> {
        match tokio::process::Command::new(&self.path)
            .arg("--version")
            .output()
            .await
        {
            Ok(out) if out.status.success() => {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(TestConnectionResult {
                    ok: true,
                    model_responded: Some(version),
                    error: None,
                })
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Ok(TestConnectionResult {
                    ok: false,
                    model_responded: None,
                    error: Some(format!("claude --version failed: {stderr}")),
                })
            }
            Err(e) => Ok(TestConnectionResult {
                ok: false,
                model_responded: None,
                error: Some(format!("failed to run claude: {e}")),
            }),
        }
    }

    /// For Claude CLI, system_prompt and user_prompt are combined into a single
    /// `-p` argument (system_prompt\n\nuser_prompt). Streaming text is not
    /// available; on_chunk carries phase notifications and final usage only.
    async fn analyze(
        &self,
        request: AnalysisRequest,
        mut on_chunk: Box<dyn FnMut(AnalysisChunk) + Send>,
    ) -> Result<(String, AuditTokenUsage), AppError> {
        let start = Instant::now();

        let full_prompt = if request.system_prompt.is_empty() {
            request.user_prompt.clone()
        } else {
            format!("{}\n\n{}", request.system_prompt, request.user_prompt)
        };

        let mut child = tokio::process::Command::new(&self.path)
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

        let lines = tokio::io::BufReader::new(stdout).lines();

        let read_result = tokio::time::timeout(Duration::from_secs(300), async move {
            let mut lines = lines;
            let mut result_text: Option<String> = None;
            let mut is_error = false;
            let mut token_usage = AuditTokenUsage::default();

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
                        on_chunk(AnalysisChunk {
                            text: String::new(),
                            usage: None,
                            phase: Some(ChunkPhase {
                                name: "analyzing".into(),
                                pid,
                                elapsed_ms,
                                timing: None,
                            }),
                        });
                    }
                    "rate_limit_event" => {
                        on_chunk(AnalysisChunk {
                            text: String::new(),
                            usage: None,
                            phase: Some(ChunkPhase {
                                name: "waiting".into(),
                                pid,
                                elapsed_ms,
                                timing: None,
                            }),
                        });
                    }
                    "result" => {
                        is_error = event
                            .get("is_error")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        if let Some(u) = event.get("usage") {
                            token_usage = AuditTokenUsage {
                                input_tokens: u
                                    .get("input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0),
                                output_tokens: u
                                    .get("output_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0),
                                cache_read_input_tokens: u
                                    .get("cache_read_input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0),
                                cache_creation_input_tokens: u
                                    .get("cache_creation_input_tokens")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0),
                            };
                        }
                        let timing = serde_json::json!({
                            "duration_ms": event.get("duration_ms").and_then(|v| v.as_u64()),
                            "duration_api_ms": event.get("duration_api_ms").and_then(|v| v.as_u64()),
                        });
                        let phase_name = if is_error { "error" } else { "complete" };
                        on_chunk(AnalysisChunk {
                            text: String::new(),
                            usage: Some(token_usage.clone()),
                            phase: Some(ChunkPhase {
                                name: phase_name.into(),
                                pid,
                                elapsed_ms,
                                timing: Some(timing),
                            }),
                        });
                        result_text = event
                            .get("result")
                            .and_then(|v| v.as_str())
                            .map(str::to_string);
                    }
                    _ => {}
                }
            }
            Ok::<_, std::io::Error>((result_text, is_error, token_usage))
        })
        .await;

        child.wait().await.ok();

        let (result_text, is_error, token_usage) = read_result
            .map_err(|_| AppError::ClaudeCli("Claude CLI timed out after 300 seconds".into()))?
            .map_err(|e| AppError::ClaudeCli(format!("IO error reading claude output: {e}")))?;

        if is_error {
            let msg = result_text.as_deref().unwrap_or("unknown error");
            return Err(AppError::ClaudeCli(format!("Claude returned an error: {msg}")));
        }

        let text = result_text.ok_or_else(|| {
            AppError::ClaudeCli("No result event in claude stream-json output".into())
        })?;

        Ok((text, token_usage))
    }
}
