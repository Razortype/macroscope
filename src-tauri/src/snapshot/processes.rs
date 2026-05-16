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

    // split_whitespace() collapses runs of spaces, unlike splitn(n, char::is_whitespace)
    // which splits on every individual space character and produces empty tokens from
    // the leading padding that ps adds to right-justify numeric columns.
    let tokens: Vec<&str> = line.split_whitespace().collect();

    // Minimum viable line: pid ppid user rss command etime = 6 tokens
    if tokens.len() < 6 {
        return None;
    }

    let pid: u32 = tokens[0].parse().ok()?;
    let ppid: u32 = tokens[1].parse().ok()?;
    let user = tokens[2].to_string();
    let rss_kb: u64 = tokens[3].parse().ok()?;

    // tokens[4..] = command parts (0 or more) + etime (always last)
    let remaining = &tokens[4..];

    // etime is always the final token and has a known character-class shape.
    // Validate it before trusting the split — malformed lines are silently dropped.
    let etime_tok = *remaining.last()?;
    if !is_etime(etime_tok) {
        return None;
    }

    // Everything before the last token is the command (handles paths with spaces,
    // e.g. "/Applications/Visual Studio Code.app/...")
    let command = remaining[..remaining.len() - 1].join(" ");

    Some(ProcessInfo {
        pid,
        ppid,
        user,
        rss_bytes: rss_kb * 1024, // ps rss is in KB on macOS
        command,
        etime: etime_tok.to_string(),
    })
}

// etime format (from ps(1) man page): [[DD-]HH:]MM:SS
// Accepts: "MM:SS", "HH:MM:SS", "D-HH:MM:SS", "DD-HH:MM:SS", etc.
// All tokens are ASCII digits; the only non-digit chars allowed are ':' and
// a single '-' separating an optional leading day count.
fn is_etime(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    // Strip optional leading "D-" day prefix (one or more digits then '-')
    let time_part = match s.find('-') {
        Some(i) if i > 0 && s[..i].chars().all(|c| c.is_ascii_digit()) => &s[i + 1..],
        None => s,
        _ => return false,
    };
    let parts: Vec<&str> = time_part.split(':').collect();
    (2..=3).contains(&parts.len())
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}
