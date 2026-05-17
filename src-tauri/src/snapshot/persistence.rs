use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tokio::process::Command;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlistEntry {
    pub path: String,
    pub filename: String,
    pub modified_at: Option<DateTime<Utc>>,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceKind {
    UserAgent,
    UserDaemon,
    SystemDaemon,
    SystemAgent,
    LoginItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceEntry {
    pub label: String,
    pub path: String,
    pub kind: PersistenceKind,
    pub program: Option<String>,
    pub disabled: bool,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceReport {
    pub launch_agents_user: Vec<PlistEntry>,
    pub launch_agents_system: Vec<PlistEntry>,
    pub launch_daemons: Vec<PlistEntry>,
    /// Err variant carries a user-displayable permission message, not a
    /// hard failure. The orchestrator does NOT add this to partial_failures.
    pub login_items: Result<Vec<String>, String>,
    /// Enriched entries for the Security tab UI. Populated on every probe;
    /// empty array when deserializing snapshots taken before this field existed.
    #[serde(default)]
    pub entries: Vec<PersistenceEntry>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

pub fn service_target(entry: &PersistenceEntry) -> String {
    let uid = unsafe { libc::getuid() };
    match entry.kind {
        PersistenceKind::UserAgent | PersistenceKind::LoginItem => {
            format!("gui/{}/{}", uid, entry.label)
        }
        PersistenceKind::SystemDaemon | PersistenceKind::SystemAgent => {
            format!("system/{}", entry.label)
        }
        PersistenceKind::UserDaemon => {
            format!("user/{}/{}", uid, entry.label)
        }
    }
}

pub fn requires_sudo(entry: &PersistenceEntry) -> bool {
    matches!(entry.kind, PersistenceKind::SystemDaemon | PersistenceKind::SystemAgent)
}

// ── Probe ─────────────────────────────────────────────────────────────────────

pub async fn probe() -> Result<PersistenceReport, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;

    let user_agents = read_plist_dir(&home.join("Library/LaunchAgents"));
    let sys_agents = read_plist_dir(Path::new("/Library/LaunchAgents"));
    let daemons = read_plist_dir(Path::new("/Library/LaunchDaemons"));
    let login_items = query_login_items().await;
    let disabled_labels = fetch_disabled_labels().await;

    let mut entries: Vec<PersistenceEntry> = Vec::new();

    for plist in &user_agents {
        let label = plist.filename.trim_end_matches(".plist").to_string();
        let disabled = disabled_labels.contains(&label);
        entries.push(PersistenceEntry {
            label,
            path: plist.path.clone(),
            kind: PersistenceKind::UserAgent,
            program: None,
            disabled,
            source: None,
        });
    }
    for plist in &sys_agents {
        let label = plist.filename.trim_end_matches(".plist").to_string();
        let disabled = disabled_labels.contains(&label);
        entries.push(PersistenceEntry {
            label,
            path: plist.path.clone(),
            kind: PersistenceKind::SystemAgent,
            program: None,
            disabled,
            source: None,
        });
    }
    for plist in &daemons {
        let label = plist.filename.trim_end_matches(".plist").to_string();
        let disabled = disabled_labels.contains(&label);
        entries.push(PersistenceEntry {
            label,
            path: plist.path.clone(),
            kind: PersistenceKind::SystemDaemon,
            program: None,
            disabled,
            source: None,
        });
    }
    if let Ok(ref items) = login_items {
        for item in items {
            entries.push(PersistenceEntry {
                label: item.clone(),
                path: String::new(),
                kind: PersistenceKind::LoginItem,
                program: None,
                disabled: false,
                source: None,
            });
        }
    }

    Ok(PersistenceReport {
        launch_agents_user: user_agents,
        launch_agents_system: sys_agents,
        launch_daemons: daemons,
        login_items,
        entries,
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

    let items: Vec<String> = trimmed
        .split(", ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    Ok(items)
}

async fn fetch_disabled_labels() -> HashSet<String> {
    let uid = unsafe { libc::getuid() };
    let domains = [
        format!("gui/{}", uid),
        format!("user/{}", uid),
        "system".to_string(),
    ];
    let mut disabled = HashSet::new();
    for domain in &domains {
        let Ok(out) = Command::new("/bin/launchctl")
            .args(["print-disabled", domain])
            .output()
            .await
        else {
            continue;
        };
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            let line = line.trim();
            if line.ends_with("=> true") || line.ends_with("=> disabled") {
                if let Some(eq_idx) = line.find("=>") {
                    let label = line[..eq_idx].trim().trim_matches('"');
                    disabled.insert(label.to_string());
                }
            }
        }
    }
    disabled
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_target_format_user_agent() {
        let entry = PersistenceEntry {
            label: "com.perplexity.comet".into(),
            path: "/Users/x/Library/LaunchAgents/com.perplexity.comet.plist".into(),
            kind: PersistenceKind::UserAgent,
            program: None,
            disabled: false,
            source: None,
        };
        let target = service_target(&entry);
        assert!(target.starts_with("gui/"), "expected gui/ prefix, got: {target}");
        assert!(target.ends_with("/com.perplexity.comet"), "expected label suffix, got: {target}");
    }

    #[test]
    fn service_target_format_system_daemon() {
        let entry = PersistenceEntry {
            label: "com.tailscale.tailscaled".into(),
            path: "/Library/LaunchDaemons/com.tailscale.tailscaled.plist".into(),
            kind: PersistenceKind::SystemDaemon,
            program: None,
            disabled: false,
            source: None,
        };
        assert_eq!(service_target(&entry), "system/com.tailscale.tailscaled");
    }

    #[test]
    fn sudo_required_for_system_daemons() {
        let entry = PersistenceEntry {
            label: "x".into(),
            path: "x".into(),
            kind: PersistenceKind::SystemDaemon,
            program: None,
            disabled: false,
            source: None,
        };
        assert!(requires_sudo(&entry));
    }

    #[test]
    fn sudo_not_required_for_user_agents() {
        let entry = PersistenceEntry {
            label: "x".into(),
            path: "x".into(),
            kind: PersistenceKind::UserAgent,
            program: None,
            disabled: false,
            source: None,
        };
        assert!(!requires_sudo(&entry));
    }
}
