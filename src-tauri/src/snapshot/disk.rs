use serde::{Deserialize, Serialize};

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
