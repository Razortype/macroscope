use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

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
    pub leftovers: Vec<LeftoverDir>,
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

    let lib_entries = enumerate_user_library_entries(&home);

    let mut leftovers: Vec<LeftoverDir> = Vec::new();
    for entry_path in lib_entries {
        let dir_name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if installed.iter().any(|app| app_matches_dir(app, &dir_name)) {
            continue;
        }

        let p = entry_path.clone();
        let size_bytes = tokio::task::spawn_blocking(move || du_path_blocking(&p))
            .await
            .unwrap_or(0);

        leftovers.push(LeftoverDir {
            path: entry_path.display().to_string(),
            size_bytes,
            matched_app_name: None,
        });
    }

    Ok(AppsSnapshot { installed, leftovers })
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
