use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlistEntry {
    pub path: String,
    pub filename: String,
    pub modified_at: Option<DateTime<Utc>>,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceReport {
    pub launch_agents_user: Vec<PlistEntry>,
    pub launch_agents_system: Vec<PlistEntry>,
    pub launch_daemons: Vec<PlistEntry>,
    pub login_items: Result<Vec<String>, String>,
}
