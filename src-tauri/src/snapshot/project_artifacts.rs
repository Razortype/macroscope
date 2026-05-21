use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::db::Db;

const MAX_DEPTH: usize = 5;
const SECS_PER_DAY: u64 = 86_400;

// ── Configuration ─────────────────────────────────────────────────────────────

pub struct ProbeConfig {
    pub project_roots: Vec<PathBuf>,
    pub active_days: u64,
    pub stale_days: u64,
    pub min_size_bytes: u64,
}

pub fn load_probe_config(db: &Db) -> ProbeConfig {
    let project_roots = crate::executor::load_project_roots(db);

    let active_days = db
        .get_setting("artifact_active_days")
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(14u64);

    let stale_days = db
        .get_setting("artifact_stale_days")
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(90u64);

    let min_size_mb: u64 = db
        .get_setting("artifact_min_size_mb")
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(100u64);

    ProbeConfig {
        project_roots,
        active_days,
        stale_days,
        min_size_bytes: min_size_mb.saturating_mul(1_000_000),
    }
}

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactEntry {
    pub path: String,
    pub artifact_type: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectArtifactGroup {
    pub project_path: String,
    pub project_name: String,
    pub recency_days: u64,
    /// "active" | "idle" | "stale"
    pub recency_bucket: String,
    pub artifacts: Vec<ArtifactEntry>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectArtifactsSnapshot {
    pub groups: Vec<ProjectArtifactGroup>,
    pub total_bytes: u64,
    pub active_days_threshold: u64,
    pub stale_days_threshold: u64,
    pub min_size_bytes: u64,
}

// ── Artifact pattern table ────────────────────────────────────────────────────

struct Pattern {
    dir_name: &'static str,
    /// At least one of these files must exist in the parent directory.
    anchors: &'static [&'static str],
}

static PATTERNS: &[Pattern] = &[
    Pattern {
        dir_name: "node_modules",
        anchors: &["package.json"],
    },
    Pattern {
        dir_name: ".venv",
        anchors: &["pyproject.toml", "requirements.txt", "setup.py"],
    },
    Pattern {
        dir_name: "venv",
        anchors: &["pyproject.toml", "requirements.txt", "setup.py"],
    },
    Pattern {
        dir_name: "target",
        anchors: &["Cargo.toml"],
    },
    Pattern {
        dir_name: ".next",
        anchors: &[
            "package.json",
            "next.config.js",
            "next.config.ts",
            "next.config.mjs",
            "next.config.cjs",
        ],
    },
    Pattern {
        dir_name: "dist",
        anchors: &[
            "package.json",
            "vite.config.js",
            "vite.config.ts",
            "vite.config.mjs",
            "vite.config.cjs",
        ],
    },
    Pattern {
        dir_name: "build",
        anchors: &["package.json", "CMakeLists.txt", "Makefile"],
    },
    Pattern {
        dir_name: "__pycache__",
        anchors: &["pyproject.toml", "requirements.txt", "setup.py"],
    },
    Pattern {
        dir_name: ".pytest_cache",
        anchors: &["pyproject.toml", "requirements.txt", "setup.py"],
    },
    Pattern {
        dir_name: ".mypy_cache",
        anchors: &["pyproject.toml", "requirements.txt", "setup.py"],
    },
];

// Directory names that should not be recursed into during the walk.
static SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".venv",
    "venv",
    "target",
    ".next",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".git",
];

// ── Probe ─────────────────────────────────────────────────────────────────────

pub async fn probe(config: ProbeConfig) -> ProjectArtifactsSnapshot {
    let defaults = ProjectArtifactsSnapshot {
        active_days_threshold: config.active_days,
        stale_days_threshold: config.stale_days,
        min_size_bytes: config.min_size_bytes,
        ..Default::default()
    };

    if config.project_roots.is_empty() {
        return defaults;
    }

    let config = std::sync::Arc::new(config);
    let config_for_spawn = config.clone();

    let groups = tokio::task::spawn_blocking(move || collect_groups(&config_for_spawn))
        .await
        .unwrap_or_default();

    let total_bytes = groups.iter().map(|g| g.total_bytes).sum();

    ProjectArtifactsSnapshot {
        groups,
        total_bytes,
        active_days_threshold: config.active_days,
        stale_days_threshold: config.stale_days,
        min_size_bytes: config.min_size_bytes,
    }
}

// ── Walk logic ────────────────────────────────────────────────────────────────

fn collect_groups(config: &ProbeConfig) -> Vec<ProjectArtifactGroup> {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut groups: Vec<ProjectArtifactGroup> = Vec::new();

    for root in &config.project_roots {
        if !root.is_dir() {
            continue;
        }
        scan_root(root, config, now_secs, &mut groups);
    }

    groups.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
    groups
}

fn scan_root(root: &Path, config: &ProbeConfig, now_secs: u64, groups: &mut Vec<ProjectArtifactGroup>) {
    for entry in WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            // Always allow the root itself (depth 0).
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy();
                // Don't descend into artifact dirs — we detect them from the parent.
                if SKIP_DIRS.contains(&name.as_ref()) {
                    return false;
                }
                // Skip hidden dirs that aren't artifact dirs.
                if name.starts_with('.') {
                    return false;
                }
            }
            true
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let dir = entry.path();
        let artifacts = detect_artifacts(dir);
        if artifacts.is_empty() {
            continue;
        }

        let total_bytes: u64 = artifacts.iter().map(|a| a.size_bytes).sum();
        if total_bytes < config.min_size_bytes {
            continue;
        }

        let recency_days = recency_for_dir(dir, now_secs);
        let recency_bucket = classify_bucket(recency_days, config.active_days, config.stale_days);
        let project_name = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.display().to_string());

        groups.push(ProjectArtifactGroup {
            project_path: dir.display().to_string(),
            project_name,
            recency_days,
            recency_bucket,
            artifacts,
            total_bytes,
        });
    }
}

fn detect_artifacts(dir: &Path) -> Vec<ArtifactEntry> {
    let mut artifacts: Vec<ArtifactEntry> = Vec::new();

    for pattern in PATTERNS {
        let artifact_path = dir.join(pattern.dir_name);
        if !artifact_path.is_dir() {
            continue;
        }
        if !pattern.anchors.iter().any(|a| dir.join(a).is_file()) {
            continue;
        }
        let size_bytes = dir_size_bytes(&artifact_path).unwrap_or(0);
        artifacts.push(ArtifactEntry {
            path: artifact_path.display().to_string(),
            artifact_type: pattern.dir_name.to_string(),
            size_bytes,
        });
    }

    artifacts
}

fn recency_for_dir(dir: &Path, now_secs: u64) -> u64 {
    // Prefer .git/HEAD mtime — last commit or checkout timestamp.
    let git_head = dir.join(".git").join("HEAD");
    if let Ok(meta) = git_head.metadata() {
        if let Ok(mtime) = meta.modified() {
            let age = now_secs.saturating_sub(
                mtime.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            );
            return age / SECS_PER_DAY;
        }
    }

    // Fall back to the mtime of the first anchor file found in the directory.
    for pattern in PATTERNS {
        for anchor in pattern.anchors {
            let anchor_path = dir.join(anchor);
            if let Ok(meta) = anchor_path.metadata() {
                if let Ok(mtime) = meta.modified() {
                    let age = now_secs.saturating_sub(
                        mtime.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
                    );
                    return age / SECS_PER_DAY;
                }
            }
        }
    }

    // Unknown — treat as idle boundary so it gets medium severity.
    52
}

fn classify_bucket(days: u64, active_days: u64, stale_days: u64) -> String {
    if days < active_days {
        "active".to_string()
    } else if days <= stale_days {
        "idle".to_string()
    } else {
        "stale".to_string()
    }
}

fn dir_size_bytes(path: &Path) -> Option<u64> {
    let out = std::process::Command::new("du")
        .args(["-sk", &path.display().to_string()])
        .output()
        .ok()?;
    let kb: u64 = String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()?
        .parse()
        .ok()?;
    Some(kb.saturating_mul(1024))
}

// ── Summarize for AI analyzer ─────────────────────────────────────────────────

pub fn summarize_for_analyzer(snap: &ProjectArtifactsSnapshot) -> serde_json::Value {
    serde_json::json!({
        "thresholds": {
            "active_days": snap.active_days_threshold,
            "stale_days": snap.stale_days_threshold,
            "min_size_bytes": snap.min_size_bytes,
        },
        "total_bytes": snap.total_bytes,
        "group_count": snap.groups.len(),
        "groups": snap.groups.iter().map(|g| {
            let artifact_summary: Vec<serde_json::Value> = g.artifacts.iter().map(|a| {
                serde_json::json!({
                    "path": a.path,
                    "type": a.artifact_type,
                    "size_bytes": a.size_bytes,
                })
            }).collect();
            serde_json::json!({
                "project_path": g.project_path,
                "project_name": g.project_name,
                "recency_days": g.recency_days,
                "recency_bucket": g.recency_bucket,
                "total_bytes": g.total_bytes,
                "artifacts": artifact_summary,
            })
        }).collect::<Vec<_>>(),
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_bucket_boundaries() {
        assert_eq!(classify_bucket(0, 14, 90), "active");
        assert_eq!(classify_bucket(13, 14, 90), "active");
        assert_eq!(classify_bucket(14, 14, 90), "idle");
        assert_eq!(classify_bucket(90, 14, 90), "idle");
        assert_eq!(classify_bucket(91, 14, 90), "stale");
    }
}
