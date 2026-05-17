use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::{DirEntry, WalkDir};

const SIZE_THRESHOLD_BYTES: u64 = 50_000_000; // 50 MB

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileCategory {
    Video,
    Archive,
    Binary,
    Other,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LargeFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified_days_ago: u32,
    pub category: FileCategory,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LargeFilesSnapshot {
    pub files: Vec<LargeFile>,
    pub scopes_scanned: Vec<String>,
    pub partial_failures: Vec<String>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".cache",
    ".npm",
    ".cargo",
    ".rustup",
    ".local",
    ".venv",
    "venv",
    "__pycache__",
    "target",      // Rust/Cargo build output — regenerates on every build
    "dist",        // Common JS/Python/Rust build output
    "build",       // Common C/C++/CMake/Xcode build output
    ".next",       // Next.js build cache
    ".turbo",      // Turborepo build cache
    "DerivedData", // Xcode build cache
];

fn is_skipped(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy();
    if entry.depth() > 0 && name.starts_with('.') {
        return true;
    }
    if entry.file_type().is_dir() && SKIP_DIRS.contains(&name.as_ref()) {
        return true;
    }
    false
}

fn classify_extension(path: &Path) -> FileCategory {
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase());
    match ext.as_deref() {
        Some("mp4") | Some("mov") | Some("mkv") | Some("webm") | Some("avi") | Some("m4v") => {
            FileCategory::Video
        }
        Some("dmg")
        | Some("zip")
        | Some("tar")
        | Some("gz")
        | Some("bz2")
        | Some("xz")
        | Some("7z")
        | Some("rar")
        | Some("iso") => FileCategory::Archive,
        Some("bin")
        | Some("gguf")
        | Some("safetensors")
        | Some("onnx")
        | Some("pb")
        | Some("h5")
        | Some("ckpt")
        | Some("pt")
        | Some("pth")
        | Some("node") => FileCategory::Binary,
        _ => FileCategory::Other,
    }
}

fn modified_days_ago(modified: std::time::SystemTime) -> u32 {
    let dt: DateTime<Utc> = modified.into();
    let now = Utc::now();
    let days = now.signed_duration_since(dt).num_days();
    if days < 0 { 0 } else { days as u32 }
}

pub async fn probe() -> LargeFilesSnapshot {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return LargeFilesSnapshot::default(),
    };

    let scope_subdirs = ["Desktop", "Downloads", "Documents", "Movies", "Music", "Pictures"];
    let scopes: Vec<PathBuf> = scope_subdirs.iter().map(|s| home.join(s)).collect();

    let scopes_for_blocking = scopes.clone();
    tokio::task::spawn_blocking(move || probe_blocking(&scopes_for_blocking))
        .await
        .unwrap_or_default()
}

fn probe_blocking(scopes: &[PathBuf]) -> LargeFilesSnapshot {
    let mut files: Vec<LargeFile> = Vec::new();
    let mut scopes_scanned: Vec<String> = Vec::new();
    let mut partial_failures: Vec<String> = Vec::new();

    for scope in scopes {
        if !scope.is_dir() {
            continue;
        }
        scopes_scanned.push(scope.display().to_string());

        let walker = WalkDir::new(scope)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !is_skipped(e));

        for entry in walker {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    if let Some(path) = e.path() {
                        partial_failures.push(path.display().to_string());
                    }
                    continue;
                }
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => {
                    partial_failures.push(entry.path().display().to_string());
                    continue;
                }
            };
            let size = metadata.len();
            if size < SIZE_THRESHOLD_BYTES {
                continue;
            }
            let modified_days = metadata
                .modified()
                .ok()
                .map(modified_days_ago)
                .unwrap_or(0);
            let category = classify_extension(entry.path());
            files.push(LargeFile {
                path: entry.path().display().to_string(),
                size_bytes: size,
                modified_days_ago: modified_days,
                category,
            });
        }
    }

    files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    LargeFilesSnapshot { files, scopes_scanned, partial_failures }
}

// ── Analyzer summary types ────────────────────────────────────────────────────

use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct CategoryStats {
    pub count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DuplicateGroup {
    pub filename: String,
    pub category: FileCategory,
    pub paths: Vec<String>,
    pub size_bytes_each: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FilesStats {
    pub total_count: usize,
    pub total_bytes: u64,
    pub by_category: HashMap<String, CategoryStats>,
    pub scopes_scanned_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FilesSummaryForAnalyzer {
    pub stats: FilesStats,
    pub top_per_category: HashMap<String, Vec<LargeFile>>,
    pub duplicate_groups: Vec<DuplicateGroup>,
    pub stale_large_files: Vec<LargeFile>,
}

const TOP_PER_CATEGORY: usize = 10;
const STALE_DAYS_THRESHOLD: u32 = 180;
const STALE_SIZE_THRESHOLD: u64 = 500_000_000; // 500 MB
const MAX_STALE_FILES: usize = 15;

fn category_label(c: FileCategory) -> &'static str {
    match c {
        FileCategory::Video => "video",
        FileCategory::Archive => "archive",
        FileCategory::Binary => "binary",
        FileCategory::Other => "other",
    }
}

pub fn summarize_for_analyzer(snap: &LargeFilesSnapshot) -> FilesSummaryForAnalyzer {
    if snap.files.is_empty() {
        return FilesSummaryForAnalyzer::default();
    }

    // 1. Stats
    let mut by_category: HashMap<String, CategoryStats> = HashMap::new();
    let mut total_bytes: u64 = 0;
    for f in &snap.files {
        total_bytes += f.size_bytes;
        let label = category_label(f.category).to_string();
        let entry = by_category.entry(label).or_default();
        entry.count += 1;
        entry.total_bytes += f.size_bytes;
    }

    // 2. Top N per category (files are already sorted by size desc)
    let mut top_per_category: HashMap<String, Vec<LargeFile>> = HashMap::new();
    for f in &snap.files {
        let label = category_label(f.category).to_string();
        let bucket = top_per_category.entry(label).or_default();
        if bucket.len() < TOP_PER_CATEGORY {
            bucket.push(f.clone());
        }
    }

    // 3. Duplicate detection: group by filename across paths
    let mut by_filename: HashMap<String, Vec<&LargeFile>> = HashMap::new();
    for f in &snap.files {
        let filename = Path::new(&f.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if !filename.is_empty() {
            by_filename.entry(filename).or_default().push(f);
        }
    }
    let mut duplicate_groups: Vec<DuplicateGroup> = by_filename
        .into_iter()
        .filter(|(_, files)| files.len() >= 2)
        .map(|(filename, files)| {
            let size_each = files[0].size_bytes;
            let total = files.iter().map(|f| f.size_bytes).sum();
            DuplicateGroup {
                filename,
                category: files[0].category,
                paths: files.iter().map(|f| f.path.clone()).collect(),
                size_bytes_each: size_each,
                total_bytes: total,
            }
        })
        .collect();
    duplicate_groups.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
    duplicate_groups.truncate(20);

    // 4. Stale large files: 180+ days unmodified, ≥500 MB
    let mut stale_large_files: Vec<LargeFile> = snap
        .files
        .iter()
        .filter(|f| f.modified_days_ago > STALE_DAYS_THRESHOLD && f.size_bytes >= STALE_SIZE_THRESHOLD)
        .cloned()
        .collect();
    stale_large_files.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    stale_large_files.truncate(MAX_STALE_FILES);

    FilesSummaryForAnalyzer {
        stats: FilesStats {
            total_count: snap.files.len(),
            total_bytes,
            by_category,
            scopes_scanned_count: snap.scopes_scanned.len(),
        },
        top_per_category,
        duplicate_groups,
        stale_large_files,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_video_extensions() {
        assert_eq!(classify_extension(Path::new("foo.mov")), FileCategory::Video);
        assert_eq!(classify_extension(Path::new("foo.MOV")), FileCategory::Video);
        assert_eq!(classify_extension(Path::new("path/to/x.mp4")), FileCategory::Video);
    }

    #[test]
    fn classify_archive_extensions() {
        assert_eq!(classify_extension(Path::new("x.dmg")), FileCategory::Archive);
        assert_eq!(classify_extension(Path::new("x.tar.gz")), FileCategory::Archive); // Path::extension returns "gz"
        assert_eq!(classify_extension(Path::new("x.zip")), FileCategory::Archive);
    }

    #[test]
    fn classify_binary_extensions() {
        assert_eq!(classify_extension(Path::new("model.bin")), FileCategory::Binary);
        assert_eq!(classify_extension(Path::new("model.gguf")), FileCategory::Binary);
        assert_eq!(classify_extension(Path::new("next-swc.darwin-arm64.node")), FileCategory::Binary);
    }

    #[test]
    fn classify_unknown_is_other() {
        assert_eq!(classify_extension(Path::new("x.pdf")), FileCategory::Other);
        assert_eq!(classify_extension(Path::new("README")), FileCategory::Other);
    }

    #[test]
    fn modified_clamps_negative_to_zero() {
        let future = std::time::SystemTime::now() + std::time::Duration::from_secs(3600);
        assert_eq!(modified_days_ago(future), 0);
    }

    #[test]
    fn skip_list_covers_build_artifact_dirs() {
        let dirs_to_skip = ["target", "dist", "build", ".next", ".turbo", "DerivedData", "node_modules", ".git"];
        for d in dirs_to_skip {
            assert!(SKIP_DIRS.contains(&d), "SKIP_DIRS missing {}", d);
        }
    }
}

#[cfg(test)]
mod summarizer_tests {
    use super::*;

    fn mk_file(path: &str, size: u64, days: u32, cat: FileCategory) -> LargeFile {
        LargeFile {
            path: path.to_string(),
            size_bytes: size,
            modified_days_ago: days,
            category: cat,
        }
    }

    #[test]
    fn duplicate_group_detected_across_paths() {
        let snap = LargeFilesSnapshot {
            files: vec![
                mk_file("/a/next-swc.node", 120_000_000, 30, FileCategory::Binary),
                mk_file("/b/next-swc.node", 120_000_000, 30, FileCategory::Binary),
                mk_file("/c/next-swc.node", 120_000_000, 30, FileCategory::Binary),
            ],
            scopes_scanned: vec![],
            partial_failures: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.duplicate_groups.len(), 1);
        assert_eq!(summary.duplicate_groups[0].paths.len(), 3);
        assert_eq!(summary.duplicate_groups[0].total_bytes, 360_000_000);
    }

    #[test]
    fn stale_files_filtered_by_size_and_age() {
        let snap = LargeFilesSnapshot {
            files: vec![
                mk_file("/a/old_big.mov", 2_000_000_000, 365, FileCategory::Video),  // qualifies
                mk_file("/b/old_small.mov", 100_000_000, 365, FileCategory::Video),  // too small
                mk_file("/c/new_big.mov", 2_000_000_000, 30, FileCategory::Video),   // too recent
            ],
            scopes_scanned: vec![],
            partial_failures: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.stale_large_files.len(), 1);
        assert_eq!(summary.stale_large_files[0].path, "/a/old_big.mov");
    }

    #[test]
    fn top_per_category_caps_at_10() {
        let mut files = Vec::new();
        for i in 0..15 {
            files.push(mk_file(&format!("/x/{}.mov", i), 100_000_000, 30, FileCategory::Video));
        }
        let snap = LargeFilesSnapshot { files, scopes_scanned: vec![], partial_failures: vec![] };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.top_per_category.get("video").unwrap().len(), 10);
    }

    #[test]
    fn stats_aggregate_by_category() {
        let snap = LargeFilesSnapshot {
            files: vec![
                mk_file("/a/x.mov", 1_000_000_000, 30, FileCategory::Video),
                mk_file("/b/y.dmg", 500_000_000, 30, FileCategory::Archive),
                mk_file("/c/z.dmg", 300_000_000, 30, FileCategory::Archive),
            ],
            scopes_scanned: vec!["a".into(), "b".into()],
            partial_failures: vec![],
        };
        let summary = summarize_for_analyzer(&snap);
        assert_eq!(summary.stats.total_count, 3);
        assert_eq!(summary.stats.total_bytes, 1_800_000_000);
        assert_eq!(summary.stats.by_category.get("video").unwrap().count, 1);
        assert_eq!(summary.stats.by_category.get("archive").unwrap().count, 2);
        assert_eq!(summary.stats.by_category.get("archive").unwrap().total_bytes, 800_000_000);
    }
}
