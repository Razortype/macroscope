use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub user: String,
    pub rss_bytes: u64,
    pub command: String,
    pub etime: String,
}

// Only surface processes using more than 10 MB RSS to cut noise.
const RSS_THRESHOLD_KB: u64 = 10_000;

pub async fn probe() -> Result<Vec<ProcessInfo>, String> {
    // Use = suffix on each field name to suppress header output from ps
    let out = Command::new("ps")
        .args(["-axo", "pid=,ppid=,user=,rss=,command=,etime="])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(format!("ps exited {}", out.status));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut procs: Vec<ProcessInfo> = stdout
        .lines()
        .filter_map(|line| parse_ps_line(line.trim()))
        .filter(|p| p.rss_bytes >= RSS_THRESHOLD_KB * 1024)
        .collect();

    procs.sort_by(|a, b| b.rss_bytes.cmp(&a.rss_bytes));
    Ok(procs)
}

fn parse_ps_line(line: &str) -> Option<ProcessInfo> {
    if line.is_empty() {
        return None;
    }

    // Fields: pid ppid user rss command... etime
    // "command" can contain spaces, and etime is the LAST field.
    // Strategy: split on whitespace, take first 4 fixed fields,
    // take the last field as etime, everything in between is command.
    let cols: Vec<&str> = line.splitn(5, char::is_whitespace).collect();
    // After splitn(5, ...) we have at most: [pid, ppid, user, rss, "command... etime"]
    if cols.len() < 5 {
        return None;
    }

    let pid: u32 = cols[0].trim().parse().ok()?;
    let ppid: u32 = cols[1].trim().parse().ok()?;
    let user = cols[2].trim().to_string();
    let rss_kb: u64 = cols[3].trim().parse().ok()?;
    let rest = cols[4].trim();

    // The last whitespace-separated token in rest is etime, everything before is command
    let last_space = rest.rfind(char::is_whitespace)?;
    let command = rest[..last_space].trim().to_string();
    let etime = rest[last_space..].trim().to_string();

    Some(ProcessInfo {
        pid,
        ppid,
        user,
        rss_bytes: rss_kb * 1024, // ps rss is in KB on macOS
        command,
        etime,
    })
}
