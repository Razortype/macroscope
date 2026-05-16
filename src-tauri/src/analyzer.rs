use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::{settings_keys, Db};

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
