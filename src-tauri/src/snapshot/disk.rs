use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeStats {
    pub mount: String,
    pub size_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub capacity_pct: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathSize {
    pub path: String,
    pub size_bytes: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskReport {
    pub volume: VolumeStats,
    pub watched_paths: Vec<PathSize>,
}

pub async fn probe() -> Result<DiskReport, String> {
    let volume = probe_volume().await?;
    let watched = probe_watched_paths().await;
    Ok(DiskReport { volume, watched_paths: watched })
}

async fn probe_volume() -> Result<VolumeStats, String> {
    // df -k reports 1024-byte blocks on macOS (not 512 per POSIX)
    let out = Command::new("df")
        .args(["-k", "/"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    // Skip header line, parse second line
    let line = stdout
        .lines()
        .nth(1)
        .ok_or_else(|| "df produced no data line".to_string())?;

    parse_df_line(line)
}

fn parse_df_line(line: &str) -> Result<VolumeStats, String> {
    // macOS df -k columns: Filesystem 1K-blocks Used Available Capacity iused ifree %iused Mounted
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 6 {
        return Err(format!("unexpected df output: {line}"));
    }

    // macOS df -k: col 1 = 1024-byte blocks total, col 2 = used, col 3 = available
    // col 4 = capacity like "22%"
    let blocks_total: u64 = cols[1].parse().map_err(|_| "parse df total".to_string())?;
    let blocks_used: u64 = cols[2].parse().map_err(|_| "parse df used".to_string())?;
    let blocks_avail: u64 = cols[3].parse().map_err(|_| "parse df avail".to_string())?;
    let cap_str = cols[4].trim_end_matches('%');
    let capacity_pct: u8 = cap_str.parse().unwrap_or(0);
    let mount = cols.last().unwrap_or(&"/").to_string();

    Ok(VolumeStats {
        mount,
        size_bytes: blocks_total * 1024,
        used_bytes: blocks_used * 1024,
        available_bytes: blocks_avail * 1024,
        capacity_pct,
    })
}

async fn probe_watched_paths() -> Vec<PathSize> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let targets: Vec<PathBuf> = vec![
        home.join("Library/Caches"),
        home.join("Library/Application Support/Notion"),
        home.join(".cache"),
        home.join(".npm"),
        home.join("Library/Containers/com.docker.docker"),
        home.join("Library/Developer/Xcode/DerivedData"),
        home.join("Desktop"),
        home.join("Downloads"),
    ];

    // Run du for each path in parallel via spawn_blocking
    let handles: Vec<_> = targets
        .into_iter()
        .map(|path| {
            tokio::task::spawn_blocking(move || du_path(path))
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(ps) => results.push(ps),
            Err(_) => {} // task panicked — skip
        }
    }
    results
}

fn du_path(path: PathBuf) -> PathSize {
    let path_str = path.display().to_string();

    if !path.exists() {
        return PathSize { path: path_str, size_bytes: 0, exists: false };
    }

    // du -sk: kilobytes, single path, no recursion header
    let out = std::process::Command::new("du")
        .args(["-sk", &path_str])
        .output();

    match out {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let kb: u64 = stdout
                .split_whitespace()
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            PathSize { path: path_str, size_bytes: kb * 1024, exists: true }
        }
        Err(_) => PathSize { path: path_str, size_bytes: 0, exists: true },
    }
}
