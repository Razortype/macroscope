use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

fn app_matches_dir(app: &InstalledApp, dir_name: &str) -> bool {
    // 1. Bundle ID exact match or component match
    if let Some(bid) = &app.bundle_id {
        if bid == dir_name {
            return true;
        }
        // e.g. "com.brave.Browser" → check if "BraveSoftware" matches segment "brave"
        if bid.split('.').any(|part| part.to_lowercase() == dir_name.to_lowercase()) {
            return true;
        }
    }

    // 2. Normalized name match (strip .plist suffix for Preferences entries)
    let dir_base = dir_name.trim_end_matches(".plist");
    let app_name_norm = app.name.to_lowercase().replace(".app", "").replace(' ', "");
    let dir_norm = dir_base.to_lowercase().replace(' ', "");

    if !app_name_norm.is_empty()
        && !dir_norm.is_empty()
        && (app_name_norm.contains(&dir_norm) || dir_norm.contains(&app_name_norm))
    {
        return true;
    }

    false
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

// ── Analyzer summary types ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppGroup {
    pub vendor: String,
    pub paths: Vec<String>,
    pub total_bytes: u64,
    pub dir_count: usize,
    pub examples: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StaleAppSummary {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub last_opened_days_ago: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppStats {
    pub installed_total: usize,
    pub active_count: usize,
    pub stale_count: usize,
    pub leftover_count: usize,
    pub leftover_total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MiscBucket {
    pub count: usize,
    pub total_bytes: u64,
    pub sample_names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppsSummaryForAnalyzer {
    pub stats: AppStats,
    pub leftover_groups: Vec<AppGroup>,
    pub misc_leftovers: MiscBucket,
    pub stale_apps: Vec<StaleAppSummary>,
}

// ── Summarizer ────────────────────────────────────────────────────────────────

const SMALL_LEFTOVER_THRESHOLD: u64 = 50_000_000; // 50 MB
const STALE_DAYS_THRESHOLD: u32 = 180;
const MAX_STALE_APPS: usize = 15;
const MAX_GROUPS: usize = 20;

pub fn summarize_for_analyzer(snap: &AppsSnapshot) -> AppsSummaryForAnalyzer {
    // 1. Split leftovers into big (≥50 MB) vs small (<50 MB)
    let (big_leftovers, small_leftovers): (Vec<_>, Vec<_>) =
        snap.leftovers.iter().partition(|l| l.size_bytes >= SMALL_LEFTOVER_THRESHOLD);

    // 2. Group big leftovers by vendor
    let mut groups: HashMap<String, AppGroup> = HashMap::new();
    for leftover in &big_leftovers {
        let vendor = infer_vendor(&leftover.path, leftover.matched_app_name.as_deref());
        let group = groups.entry(vendor.clone()).or_insert_with(|| AppGroup {
            vendor: vendor.clone(),
            paths: Vec::new(),
            total_bytes: 0,
            dir_count: 0,
            examples: Vec::new(),
        });
        group.paths.push(leftover.path.clone());
        group.total_bytes += leftover.size_bytes;
        group.dir_count += 1;
        if let Some(name) = &leftover.matched_app_name {
            if !group.examples.contains(name) && group.examples.len() < 3 {
                group.examples.push(name.clone());
            }
        }
    }

    // 3. Sort groups by total_bytes desc, cap at MAX_GROUPS
    let mut leftover_groups: Vec<AppGroup> = groups.into_values().collect();
    leftover_groups.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
    leftover_groups.truncate(MAX_GROUPS);

    // 4. Aggregate small leftovers into misc bucket
    let misc_leftovers = MiscBucket {
        count: small_leftovers.len(),
        total_bytes: small_leftovers.iter().map(|l| l.size_bytes).sum(),
        sample_names: small_leftovers
            .iter()
            .filter_map(|l| {
                l.matched_app_name.clone().or_else(|| {
                    std::path::Path::new(&l.path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(String::from)
                })
            })
            .take(8)
            .collect(),
    };

    // 5. Stale apps: unused for > STALE_DAYS_THRESHOLD, top N by size
    let mut stale_apps: Vec<StaleAppSummary> = snap
        .installed
        .iter()
        .filter(|a| a.last_opened_days_ago.map_or(false, |d| d > STALE_DAYS_THRESHOLD))
        .map(|a| StaleAppSummary {
            name: a.name.clone(),
            path: a.path.clone(),
            size_bytes: a.size_bytes,
            last_opened_days_ago: a.last_opened_days_ago.unwrap_or(0),
        })
        .collect();
    stale_apps.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    stale_apps.truncate(MAX_STALE_APPS);

    // 6. Stats
    let stale_count = snap
        .installed
        .iter()
        .filter(|a| a.last_opened_days_ago.map_or(false, |d| d > STALE_DAYS_THRESHOLD))
        .count();
    let active_count = snap.installed.len() - stale_count;
    let leftover_total_bytes = snap.leftovers.iter().map(|l| l.size_bytes).sum();

    AppsSummaryForAnalyzer {
        stats: AppStats {
            installed_total: snap.installed.len(),
            active_count,
            stale_count,
            leftover_count: snap.leftovers.len(),
            leftover_total_bytes,
        },
        leftover_groups,
        misc_leftovers,
        stale_apps,
    }
}

fn infer_vendor(path: &str, matched_app_name: Option<&str>) -> String {
    let dirname = std::path::Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path);

    let candidate = matched_app_name.unwrap_or(dirname);

    // Reverse-domain bundle IDs: com.adobe.Acrobat → "Adobe"
    if candidate.starts_with("com.") || candidate.starts_with("org.") {
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() >= 2 {
            return capitalize(parts[1]);
        }
    }

    // Known multi-word brands (normalize both sides)
    let known_brands: &[(&str, &str)] = &[
        ("adobe", "Adobe"),
        ("brave", "Brave"),
        ("jetbrains", "JetBrains"),
        ("google", "Google"),
        ("microsoft", "Microsoft"),
        ("zoom", "Zoom"),
        ("slack", "Slack"),
        ("discord", "Discord"),
        ("notion", "Notion"),
        ("unity", "Unity"),
        ("docker", "Docker"),
        ("vmware", "VMware"),
        ("parallels", "Parallels"),
    ];
    let lower = candidate.to_lowercase();
    for (key, label) in known_brands {
        if lower.contains(key) {
            return label.to_string();
        }
    }

    capitalize(candidate)
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().chain(chars).collect(),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_leftover(path: &str, size: u64, name: Option<&str>) -> LeftoverDir {
        LeftoverDir {
            path: path.to_string(),
            size_bytes: size,
            matched_app_name: name.map(String::from),
        }
    }

    fn make_app(name: &str, days: Option<u32>, size: u64) -> InstalledApp {
        InstalledApp {
            name: name.to_string(),
            bundle_id: None,
            path: format!("/Applications/{}.app", name),
            size_bytes: size,
            last_opened_days_ago: days,
        }
    }

    #[test]
    fn small_leftovers_go_to_misc_bucket() {
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![
                make_leftover("/test/SmallApp", 10_000_000, Some("SmallApp")),
                make_leftover("/test/SmallApp2", 30_000_000, Some("SmallApp2")),
            ],
            classified_leftovers: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.misc_leftovers.count, 2);
        assert_eq!(summary.leftover_groups.len(), 0);
    }

    #[test]
    fn big_leftovers_grouped_by_vendor() {
        let snap = AppsSnapshot {
            installed: vec![],
            leftovers: vec![
                make_leftover("/test/Adobe", 200_000_000, Some("Adobe")),
                make_leftover("/test/com.adobe.Acrobat.plist", 60_000_000, None),
            ],
            classified_leftovers: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        let adobe_group = summary.leftover_groups.iter().find(|g| g.vendor == "Adobe");
        assert!(adobe_group.is_some(), "expected Adobe group");
        assert_eq!(adobe_group.unwrap().dir_count, 2);
    }

    #[test]
    fn stale_apps_capped_and_sorted_by_size() {
        let snap = AppsSnapshot {
            installed: vec![
                make_app("OldApp1", Some(365), 5_000_000_000),
                make_app("OldApp2", Some(300), 1_000_000_000),
                make_app("Recent", Some(10), 100_000_000),
                make_app("NeverOpened", None, 100_000_000),
            ],
            leftovers: vec![],
            classified_leftovers: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.stale_apps.len(), 2);
        assert_eq!(summary.stale_apps[0].name, "OldApp1");
    }

    #[test]
    fn stats_are_correct() {
        let snap = AppsSnapshot {
            installed: vec![
                make_app("ActiveApp", Some(5), 100_000_000),
                make_app("StaleApp", Some(300), 200_000_000),
            ],
            leftovers: vec![make_leftover("/test/X", 50_000_000, None)],
            classified_leftovers: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.stats.installed_total, 2);
        assert_eq!(summary.stats.active_count, 1);
        assert_eq!(summary.stats.stale_count, 1);
        assert_eq!(summary.stats.leftover_count, 1);
    }
}
