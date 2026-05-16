use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

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
    /// Err variant carries a user-displayable permission message, not a
    /// hard failure. The orchestrator does NOT add this to partial_failures.
    pub login_items: Result<Vec<String>, String>,
}

pub async fn probe() -> Result<PersistenceReport, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;

    let user_agents = read_plist_dir(&home.join("Library/LaunchAgents"));
    let sys_agents = read_plist_dir(Path::new("/Library/LaunchAgents"));
    let daemons = read_plist_dir(Path::new("/Library/LaunchDaemons"));
    let login_items = query_login_items().await;

    Ok(PersistenceReport {
        launch_agents_user: user_agents,
        launch_agents_system: sys_agents,
        launch_daemons: daemons,
        login_items,
    })
}

fn read_plist_dir(dir: &Path) -> Vec<PlistEntry> {
    let mut entries = Vec::new();
    let Ok(iter) = std::fs::read_dir(dir) else {
        return entries;
    };
    for entry in iter.flatten() {
        let path = entry.path();
        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Only plists
        if !filename.ends_with(".plist") {
            continue;
        }

        let meta = entry.metadata().ok();
        let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified_at = meta
            .and_then(|m| m.modified().ok())
            .map(|t| DateTime::<Utc>::from(t));

        entries.push(PlistEntry {
            path: path.display().to_string(),
            filename,
            modified_at,
            size_bytes,
        });
    }
    entries.sort_by(|a, b| a.filename.cmp(&b.filename));
    entries
}

async fn query_login_items() -> Result<Vec<String>, String> {
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get the name of every login item",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        // TCC denial surfaces in stderr; surface a friendly message
        if stderr.contains("Not authorized") || stderr.contains("not allowed") {
            return Err(
                "Automation permission required for System Events — grant in \
                 System Settings → Privacy & Security → Automation"
                    .to_string(),
            );
        }
        return Err(stderr);
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    // osascript returns a comma-separated list: "item1, item2, item3"
    let items: Vec<String> = trimmed
        .split(", ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(items)
}
