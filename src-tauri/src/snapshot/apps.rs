use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;
use crate::identity::{ClassifiedLeftover, LeftoverStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: String,
    pub size_bytes: u64,
    pub last_opened_days_ago: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeftoverDir {
    pub path: String,
    pub size_bytes: u64,
    pub matched_app_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppsSnapshot {
    pub installed: Vec<InstalledApp>,
    /// Legacy field: only orphaned leftovers. Kept for backward compat with old snapshots.
    pub leftovers: Vec<LeftoverDir>,
    /// Full identity-classified leftover list (includes companion, system_managed, ambiguous).
    /// Missing in snapshots taken before this field was added; deserialises as empty Vec.
    #[serde(default)]
    pub classified_leftovers: Vec<ClassifiedLeftover>,
}

const SKIP_PREFIXES: &[&str] = &[
    "com.apple.",
    ".",
    "MobileSync",
    "Mobile Documents",
    "Logs",
    "Containers",
    "Group Containers",
    "CrashReporter",
    "DiagnosticReports",
];

struct AppMetadata {
    bundle_id: Option<String>,
    last_opened_days_ago: Option<u32>,
    size_bytes: u64,
}

pub async fn probe() -> Result<AppsSnapshot, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;

    let app_paths = enumerate_apps(&home).await?;

    let mut installed: Vec<InstalledApp> = Vec::new();
    for path in &app_paths {
        let name = path
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let meta = read_app_meta(path).await;
        installed.push(InstalledApp {
            name,
            bundle_id: meta.bundle_id,
            path: path.display().to_string(),
            size_bytes: meta.size_bytes,
            last_opened_days_ago: meta.last_opened_days_ago,
        });
    }

    // Collect ALL lib entries (no pre-filter) and du them in parallel.
    let lib_entries = enumerate_user_library_entries(&home);
    let handles: Vec<_> = lib_entries.iter().map(|p| {
        let p = p.clone();
        tokio::task::spawn_blocking(move || du_path_blocking(&p))
    }).collect();

    let mut raw_leftovers: Vec<LeftoverDir> = Vec::new();
    for (path, handle) in lib_entries.into_iter().zip(handles.into_iter()) {
        let size_bytes = handle.await.unwrap_or(0);
        raw_leftovers.push(LeftoverDir {
            path: path.display().to_string(),
            size_bytes,
            matched_app_name: None,
        });
    }

    // Classify every entry through the identity layer.
    let graph = crate::identity::resolve(&installed, &raw_leftovers);
    let classified_leftovers = graph.leftovers;

    // Backward-compat: populate old `leftovers` with orphans only.
    let leftovers: Vec<LeftoverDir> = classified_leftovers
        .iter()
        .filter(|cl| matches!(cl.status, LeftoverStatus::Orphaned))
        .map(|cl| LeftoverDir {
            path: cl.path.clone(),
            size_bytes: cl.size_bytes,
            matched_app_name: None,
        })
        .collect();

    Ok(AppsSnapshot { installed, leftovers, classified_leftovers })
}

async fn enumerate_apps(home: &Path) -> Result<Vec<PathBuf>, String> {
    let mut apps = Vec::new();
    let scan_dirs = vec![PathBuf::from("/Applications"), home.join("Applications")];

    for dir in scan_dirs {
        if !dir.exists() {
            continue;
        }
        let mut entries = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| format!("read_dir {}: {}", dir.display(), e))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("next_entry: {}", e))?
        {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "app") {
                apps.push(path);
            }
        }
    }
    Ok(apps)
}

async fn read_app_meta(app_path: &Path) -> AppMetadata {
    let bundle_id = read_bundle_id(app_path).await;
    let last_opened_days_ago = read_last_opened_days_ago(app_path).await;
    let path_owned = app_path.to_path_buf();
    let size_bytes = tokio::task::spawn_blocking(move || du_path_blocking(&path_owned))
        .await
        .unwrap_or(0);
    AppMetadata { bundle_id, last_opened_days_ago, size_bytes }
}

async fn read_bundle_id(app_path: &Path) -> Option<String> {
    let path_str = app_path.display().to_string();
    let out = Command::new("mdls")
        .args(["-name", "kMDItemCFBundleIdentifier", &path_str])
        .output()
        .await
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        if let Some((key, val)) = line.split_once('=') {
            if key.trim() == "kMDItemCFBundleIdentifier" {
                let val = val.trim();
                if val != "(null)" && !val.is_empty() {
                    return Some(val.trim_matches('"').to_string());
                }
            }
        }
    }
    None
}

async fn read_last_opened_days_ago(app_path: &Path) -> Option<u32> {
    let path_str = app_path.display().to_string();
    // Try in order: kMDItemLastUsedDate is unreliable on newer macOS; fall back to
    // kMDItemUseDate and kMDItemContentModificationDate as progressively looser signals.
    let attrs = ["kMDItemLastUsedDate", "kMDItemUseDate", "kMDItemContentModificationDate"];
    for attr in attrs {
        let Ok(out) = Command::new("mdls")
            .args(["-name", attr, "-raw", &path_str])
            .output()
            .await
        else {
            continue;
        };
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s == "(null)" || s.is_empty() {
            continue;
        }
        if let Some(days) = parse_macos_date_to_days_ago(&s) {
            return Some(days);
        }
    }
    None
}

fn parse_macos_date_to_days_ago(s: &str) -> Option<u32> {
    let parsed = chrono::DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S %z").ok()?;
    let now = Utc::now();
    let diff = now.signed_duration_since(parsed.with_timezone(&Utc));
    let days = diff.num_days();
    if days < 0 {
        return Some(0);
    }
    Some(days as u32)
}

fn enumerate_user_library_entries(home: &Path) -> Vec<PathBuf> {
    let scan_dirs = [
        home.join("Library/Application Support"),
        home.join("Library/Preferences"),
        home.join("Library/Caches"),
    ];

    let mut entries = Vec::new();
    for dir in &scan_dirs {
        let Ok(iter) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in iter.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if should_skip_lib_entry(&name) {
                continue;
            }
            entries.push(path);
        }
    }
    entries
}

fn should_skip_lib_entry(name: &str) -> bool {
    SKIP_PREFIXES.iter().any(|p| name.starts_with(p))
}

fn du_path_blocking(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return path.metadata().ok().map(|m| m.len()).unwrap_or(0);
    }
    let out = std::process::Command::new("du")
        .args(["-sk", &path.display().to_string()])
        .output()
        .ok();
    match out {
        Some(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let kb: u64 = stdout
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            kb * 1024
        }
        None => 0,
    }
}

// ── Identity-aware analyzer payload ──────────────────────────────────────────

#[derive(Debug, Serialize, Clone, Default)]
pub struct InstalledAppEntry {
    pub bundle_id: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub last_opened_days_ago: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CompanionEntry {
    pub path: String,
    pub size_bytes: u64,
    pub belongs_to: String,
    pub belongs_to_display: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct OrphanEntry {
    pub path: String,
    pub size_bytes: u64,
    pub guessed_vendor: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AmbiguousEntry {
    pub path: String,
    pub size_bytes: u64,
    pub pattern: String,
}

/// Structured identity-aware summary sent to app-lifecycle-audit Claude invocation.
/// system_managed and self_managed entries are intentionally excluded — Claude never sees them.
#[derive(Debug, Serialize, Clone, Default)]
pub struct AppIdentityPayload {
    pub installed_apps: Vec<InstalledAppEntry>,
    pub companion_data: Vec<CompanionEntry>,
    pub real_orphans: Vec<OrphanEntry>,
    pub ambiguous: Vec<AmbiguousEntry>,
}

const MAX_ORPHANS: usize = 20;
const MAX_AMBIGUOUS: usize = 10;

pub fn summarize_for_analyzer(snap: &AppsSnapshot) -> AppIdentityPayload {
    let mut installed_apps: Vec<InstalledAppEntry> = snap.installed.iter()
        .map(|a| InstalledAppEntry {
            bundle_id: a.bundle_id.clone().unwrap_or_default(),
            display_name: a.name.clone(),
            size_bytes: a.size_bytes,
            last_opened_days_ago: a.last_opened_days_ago,
        })
        .collect();
    installed_apps.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    // Fall back to legacy leftovers as orphans for old snapshots without identity data
    let classified = &snap.classified_leftovers;
    if classified.is_empty() {
        let real_orphans = snap.leftovers.iter()
            .map(|l| OrphanEntry {
                path: l.path.clone(),
                size_bytes: l.size_bytes,
                guessed_vendor: Path::new(&l.path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string(),
            })
            .take(MAX_ORPHANS)
            .collect();
        return AppIdentityPayload {
            installed_apps,
            companion_data: vec![],
            real_orphans,
            ambiguous: vec![],
        };
    }

    // companion_data: all entries, never truncated (needed for context)
    let companion_data: Vec<CompanionEntry> = classified.iter()
        .filter_map(|cl| {
            if let LeftoverStatus::Companion { belongs_to_bundle_id, belongs_to_display_name } = &cl.status {
                Some(CompanionEntry {
                    path: cl.path.clone(),
                    size_bytes: cl.size_bytes,
                    belongs_to: belongs_to_bundle_id.clone(),
                    belongs_to_display: belongs_to_display_name.clone(),
                })
            } else { None }
        })
        .collect();

    // real_orphans: top MAX_ORPHANS by size
    let mut real_orphans: Vec<OrphanEntry> = classified.iter()
        .filter(|cl| matches!(cl.status, LeftoverStatus::Orphaned))
        .map(|cl| OrphanEntry {
            path: cl.path.clone(),
            size_bytes: cl.size_bytes,
            guessed_vendor: cl.dir_name.clone(),
        })
        .collect();
    real_orphans.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    real_orphans.truncate(MAX_ORPHANS);

    // ambiguous: top MAX_AMBIGUOUS by size
    let mut ambiguous: Vec<AmbiguousEntry> = classified.iter()
        .filter_map(|cl| {
            if let LeftoverStatus::Ambiguous { pattern_hint } = &cl.status {
                Some(AmbiguousEntry {
                    path: cl.path.clone(),
                    size_bytes: cl.size_bytes,
                    pattern: pattern_hint.clone(),
                })
            } else { None }
        })
        .collect();
    ambiguous.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    ambiguous.truncate(MAX_AMBIGUOUS);

    AppIdentityPayload { installed_apps, companion_data, real_orphans, ambiguous }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{ClassifiedLeftover, LeftoverStatus};

    fn make_app(name: &str, bundle_id: Option<&str>, size: u64, days: Option<u32>) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            bundle_id: bundle_id.map(String::from),
            path: format!("/Applications/{}.app", name),
            size_bytes: size,
            last_opened_days_ago: days,
        }
    }

    fn cl(path: &str, dir: &str, size: u64, status: LeftoverStatus) -> ClassifiedLeftover {
        ClassifiedLeftover { path: path.to_string(), dir_name: dir.to_string(), size_bytes: size, status }
    }

    #[test]
    fn installed_apps_sorted_by_size_desc() {
        let snap = AppsSnapshot {
            installed: vec![
                make_app("Small", None, 100_000_000, Some(5)),
                make_app("Large", None, 5_000_000_000, Some(5)),
            ],
            leftovers: vec![],
            classified_leftovers: vec![],
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.installed_apps[0].display_name, "Large");
        assert_eq!(payload.installed_apps[1].display_name, "Small");
    }

    #[test]
    fn orphans_capped_at_max_by_size() {
        let classified_leftovers = (0..25u64).map(|i| {
            cl(&format!("/x/App{}", i), &format!("App{}", i),
               (25 - i) * 100_000_000, LeftoverStatus::Orphaned)
        }).collect();
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![],
            classified_leftovers,
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.real_orphans.len(), 20); // capped at MAX_ORPHANS
        assert!(payload.real_orphans[0].size_bytes >= payload.real_orphans[19].size_bytes);
    }

    #[test]
    fn companion_data_never_truncated() {
        let classified_leftovers = (0..30u64).map(|i| {
            cl(&format!("/x/Companion{}", i), &format!("Companion{}", i),
               1_000_000, LeftoverStatus::Companion {
                   belongs_to_bundle_id: "com.example.App".into(),
                   belongs_to_display_name: "Example App".into(),
               })
        }).collect();
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![],
            classified_leftovers,
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.companion_data.len(), 30);
    }

    #[test]
    fn ambiguous_capped_at_max_by_size() {
        let classified_leftovers = (0..15u64).map(|i| {
            cl(&format!("/x/cache_{}", i), &format!("cache_{}", i),
               i * 200_000_000, LeftoverStatus::Ambiguous { pattern_hint: "electron_shell_cache".into() })
        }).collect();
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![],
            classified_leftovers,
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.ambiguous.len(), 10); // capped at MAX_AMBIGUOUS
    }

    #[test]
    fn system_managed_excluded_from_payload() {
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![],
            classified_leftovers: vec![
                cl("/x/SiriTTS", "SiriTTS", 50_000_000, LeftoverStatus::SystemManaged),
                cl("/x/JetBrains", "JetBrains", 999_000_000, LeftoverStatus::Orphaned),
            ],
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.real_orphans.len(), 1);
        assert_eq!(payload.real_orphans[0].guessed_vendor, "JetBrains");
        assert!(payload.companion_data.is_empty());
    }

    #[test]
    fn legacy_fallback_uses_leftovers_field() {
        // classified_leftovers empty → falls back to legacy leftovers
        let snap = AppsSnapshot {
            installed: vec![make_app("App", None, 100_000_000, None)],
            leftovers: vec![
                LeftoverDir { path: "/x/OldLeftover".into(), size_bytes: 200_000_000, matched_app_name: None },
            ],
            classified_leftovers: vec![],
        };
        let payload = summarize_for_analyzer(&snap);
        assert_eq!(payload.real_orphans.len(), 1);
        assert_eq!(payload.real_orphans[0].guessed_vendor, "OldLeftover");
    }
}
