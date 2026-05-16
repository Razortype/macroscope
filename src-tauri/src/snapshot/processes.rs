use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

const RSS_THRESHOLD_KB: u64 = 10_000;

pub async fn probe() -> Result<Vec<ProcessInfo>, String> {
    // Two-pass approach to avoid ps column truncation:
    //
    // macOS ps distributes terminal width across all requested columns.
    // With 6 fields (pid ppid user rss command etime), command gets ~16 chars.
    // Pass 1: 5 fields with NO command column — etime gets its own full column.
    // Pass 2: 2 fields (pid + comm) — comm gets almost all the width, giving
    //         full executable paths even for long system framework paths and
    //         paths containing spaces (e.g. "/Applications/Brave Browser.app/…").
    //
    // Both calls run in parallel; results are joined on pid.

    let (meta_out, comm_out) = tokio::join!(
        Command::new("ps").args(["-axo", "pid=,ppid=,user=,rss=,etime="]).output(),
        Command::new("ps").args(["-axo", "pid=,comm="]).output(),
    );

    let meta_raw = meta_out.map_err(|e| e.to_string())?;
    let comm_raw = comm_out.map_err(|e| e.to_string())?;

    // Parse pass 1: pid → (ppid, user, rss_kb, etime)
    let meta: HashMap<u32, (u32, String, u64, String)> = {
        let stdout = String::from_utf8_lossy(&meta_raw.stdout);
        stdout
            .lines()
            .filter_map(|line| parse_meta_line(line.trim()))
            .collect()
    };

    // Parse pass 2: pid → command (full path, may contain spaces)
    let commands: HashMap<u32, String> = {
        let stdout = String::from_utf8_lossy(&comm_raw.stdout);
        stdout
            .lines()
            .filter_map(|line| parse_comm_line(line.trim()))
            .collect()
    };

    let mut procs: Vec<ProcessInfo> = meta
        .into_iter()
        .filter(|(_, (_, _, rss_kb, _))| *rss_kb >= RSS_THRESHOLD_KB)
        .filter_map(|(pid, (ppid, user, rss_kb, etime))| {
            let command = commands.get(&pid).cloned().unwrap_or_default();
            if command.is_empty() {
                return None;
            }
            Some(ProcessInfo {
                pid,
                ppid,
                user,
                rss_bytes: rss_kb * 1024,
                command,
                etime,
            })
        })
        .collect();

    procs.sort_by(|a, b| b.rss_bytes.cmp(&a.rss_bytes));
    Ok(procs)
}

// Pass 1: "pid ppid user rss etime" — 5 fixed tokens, no command column
fn parse_meta_line(line: &str) -> Option<(u32, (u32, String, u64, String))> {
    if line.is_empty() {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    if tokens.len() < 5 {
        return None;
    }
    let pid: u32 = tokens[0].parse().ok()?;
    let ppid: u32 = tokens[1].parse().ok()?;
    let user = tokens[2].to_string();
    let rss_kb: u64 = tokens[3].parse().ok()?;
    let etime = tokens[4].to_string();
    Some((pid, (ppid, user, rss_kb, etime)))
}

// Pass 2: "pid <full command path>" — pid is purely numeric, rest is the path
// (which may contain spaces, e.g. "/Applications/Brave Browser.app/...")
fn parse_comm_line(line: &str) -> Option<(u32, String)> {
    if line.is_empty() {
        return None;
    }
    // split_once on first whitespace: left side is pid (no spaces), right side is path
    let (pid_str, comm) = line.split_once(char::is_whitespace)?;
    let pid: u32 = pid_str.parse().ok()?;
    let comm = comm.trim().to_string();
    if comm.is_empty() {
        return None;
    }
    Some((pid, comm))
}
