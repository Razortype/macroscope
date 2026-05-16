use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use chrono::Utc;
use globset::{GlobBuilder, GlobSetBuilder};
use serde::{Deserialize, Serialize};

use crate::analyzer::expand_tilde;
use crate::db::Db;
use crate::error::AppError;

// ── Output types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionItem {
    pub path: String,
    pub status: String, // "moved" | "denied" | "failed"
    pub bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReport {
    pub items: Vec<ExecutionItem>,
    pub total_bytes_freed: u64,
}

// ── Allowlist and deny list ───────────────────────────────────────────────────

// Exact-prefix allowlist: a path is allowed if it starts with one of these
// (after tilde expansion). Order is irrelevant; deny list is checked first.
const ALLOWED_PREFIXES: &[&str] = &[
    "~/.cache/",
    "~/.npm/_cacache/",
    "~/Library/Caches/",
    "~/Library/Application Support/Notion/Partitions/notion/Service Worker/",
    "~/Library/Application Support/Notion/Partitions/notion/Cache/",
    "~/Library/Application Support/Notion/Partitions/notion/Code Cache/",
    "~/Library/Developer/Xcode/DerivedData/",
    "~/Library/Developer/CoreSimulator/Caches/",
    "~/Library/Logs/",
];

// Glob patterns: matched with globset after tilde expansion of both pattern and path.
const ALLOWED_GLOBS: &[&str] = &[
    "~/.cache/huggingface/hub/models--*",
    "~/Desktop/Orkun/Projects/*/node_modules",
    "~/Desktop/Orkun/Projects/*/.next",
    "~/Desktop/Orkun/Projects/*/target",
    "~/Desktop/Orkun/Projects/*/build",
    "~/Desktop/Orkun/Projects/*/dist",
];

// Hard deny: these prefixes are NEVER allowed regardless of the allowlist above.
// These are checked before the allowlist.
const DENIED_PREFIXES: &[&str] = &[
    "~/Documents/",
    "~/Library/Mobile Documents/",
    "/System/",
    "/Library/",
    "/usr/",
    "/bin/",
    "/sbin/",
];

// The root "/" itself is also denied (guards against empty-string expansion).
const DENIED_EXACT: &[&str] = &["/"];

// ── Path validation ───────────────────────────────────────────────────────────

/// Validate that `path` is safe to move to Trash.
/// Returns the expanded, canonical PathBuf on success.
/// Returns `AppError::PathNotAllowed` if the path fails any check.
pub fn check_path(path: &str) -> Result<PathBuf, AppError> {
    let expanded = expand_tilde(path);
    let expanded_str = expanded.display().to_string();

    // 1. Hard deny (checked before everything else)
    for prefix in DENIED_EXACT {
        if expanded_str == *prefix {
            return Err(AppError::PathNotAllowed(format!(
                "{path}: matches hard-deny exact rule ({})",
                prefix
            )));
        }
    }
    // Expand deny prefixes (they may contain ~)
    for raw_prefix in DENIED_PREFIXES {
        let denied = expand_tilde(raw_prefix);
        if expanded.starts_with(&denied) {
            return Err(AppError::PathNotAllowed(format!(
                "{path}: matches hard-deny prefix ({})",
                raw_prefix
            )));
        }
    }

    // 2. Exact-prefix allowlist
    for raw_prefix in ALLOWED_PREFIXES {
        let allowed = expand_tilde(raw_prefix);
        // Path must start with the allowed directory, OR be the directory itself
        // (e.g. "~/.npm/_cacache" without trailing slash is also fine)
        let allowed_no_slash = allowed.display().to_string().trim_end_matches('/').to_string();
        if expanded.starts_with(&allowed) || expanded_str == allowed_no_slash {
            return Ok(expanded);
        }
    }

    // 3. Glob allowlist
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    let mut builder = GlobSetBuilder::new();
    for raw_glob in ALLOWED_GLOBS {
        let expanded_glob = if raw_glob.starts_with("~/") {
            format!("{}/{}", home.display(), &raw_glob[2..])
        } else {
            raw_glob.to_string()
        };
        let glob = GlobBuilder::new(&expanded_glob)
            .literal_separator(true) // * does not cross /
            .build()
            .map_err(|e| AppError::Config(format!("invalid glob {raw_glob}: {e}")))?;
        builder.add(glob);
    }
    let glob_set = builder.build().map_err(|e| AppError::Config(e.to_string()))?;

    if glob_set.is_match(&expanded) {
        return Ok(expanded);
    }

    Err(AppError::PathNotAllowed(format!(
        "{path}: not in allowlist — only pre-approved directories may be trashed"
    )))
}

// ── Executor ─────────────────────────────────────────────────────────────────

pub async fn execute_actions(paths: Vec<String>, db: &Db) -> Result<ExecutionReport, AppError> {
    let _ = db; // reserved for future per-item DB logging
    let audit_log = audit_log_path()?;

    // Ensure the parent directory exists (it should from Db::new, but be safe)
    if let Some(parent) = audit_log.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut items: Vec<ExecutionItem> = Vec::new();
    let mut total_freed: u64 = 0;

    for path in paths {
        let item = execute_single(&path, &audit_log).await;
        if item.status == "moved" {
            total_freed += item.bytes;
        }
        items.push(item);
    }

    Ok(ExecutionReport {
        items,
        total_bytes_freed: total_freed,
    })
}

async fn execute_single(path: &str, audit_log: &Path) -> ExecutionItem {
    match check_path(path) {
        Err(AppError::PathNotAllowed(msg)) => {
            append_audit_log(audit_log, path, "denied", 0, Some(&msg));
            ExecutionItem {
                path: path.to_string(),
                status: "denied".to_string(),
                bytes: 0,
                error: Some(msg),
            }
        }
        Err(e) => {
            let msg = e.to_string();
            append_audit_log(audit_log, path, "failed", 0, Some(&msg));
            ExecutionItem {
                path: path.to_string(),
                status: "failed".to_string(),
                bytes: 0,
                error: Some(msg),
            }
        }
        Ok(canonical) => {
            // Capture size BEFORE trashing
            let bytes = dir_size(&canonical).unwrap_or(0);
            match trash::delete(&canonical) {
                Ok(()) => {
                    append_audit_log(audit_log, path, "moved", bytes, None);
                    ExecutionItem {
                        path: path.to_string(),
                        status: "moved".to_string(),
                        bytes,
                        error: None,
                    }
                }
                Err(e) => {
                    let msg = e.to_string();
                    append_audit_log(audit_log, path, "failed", 0, Some(&msg));
                    ExecutionItem {
                        path: path.to_string(),
                        status: "failed".to_string(),
                        bytes: 0,
                        error: Some(msg),
                    }
                }
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn dir_size(path: &Path) -> Option<u64> {
    // Best-effort recursive size using du -sk. Falls back to metadata for files.
    if path.is_file() {
        return path.metadata().ok().map(|m| m.len());
    }
    let out = std::process::Command::new("du")
        .args(["-sk", &path.display().to_string()])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let kb: u64 = stdout.split_whitespace().next()?.parse().ok()?;
    Some(kb * 1024)
}

fn append_audit_log(log: &Path, path: &str, status: &str, bytes: u64, error: Option<&str>) {
    let line = format!(
        "{}\n",
        serde_json::json!({
            "timestamp": Utc::now().to_rfc3339(),
            "path": path,
            "status": status,
            "bytes": bytes,
            "error": error,
        })
    );
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn audit_log_path() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Config("no home dir".into()))?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join("Macroscope")
        .join("audit.log"))
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::check_path;

    #[test]
    fn allowed_cache_prefix() {
        // ~/.cache/ is in the exact-prefix allowlist
        let result = check_path("~/.cache/something");
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
    }

    #[test]
    fn denied_documents_prefix() {
        // ~/Documents/ is in the hard-deny list — must reject even if it somehow
        // matched an allowlist entry (it doesn't, but the deny check runs first)
        let result = check_path("~/Documents/anything");
        assert!(result.is_err(), "expected Err for Documents path");
        let err_str = result.unwrap_err().to_string();
        assert!(err_str.contains("hard-deny"), "error should mention hard-deny: {err_str}");
    }

    #[test]
    fn allowed_via_glob() {
        // ~/Desktop/Orkun/Projects/*/node_modules matches via the glob allowlist
        let result = check_path("~/Desktop/Orkun/Projects/librarr/node_modules");
        assert!(result.is_ok(), "expected glob match, got: {result:?}");
    }

    #[test]
    fn denied_non_allowlisted_path() {
        // A random path that is not in any allowlist entry
        let result = check_path("~/Desktop/Orkun/random.txt");
        assert!(result.is_err(), "expected Err for non-allowlisted path");
    }
}
