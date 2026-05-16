use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAccount {
    pub username: String,
    pub uid: u32,
    pub home_dir: String,
    pub real_name: Option<String>,
}

pub async fn probe() -> Result<Vec<UserAccount>, String> {
    // dscl . list /Users UniqueID returns "username    uid" tab-separated lines
    let out = Command::new("dscl")
        .args([".", "list", "/Users", "UniqueID"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(format!("dscl exited {}", out.status));
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut candidates: Vec<(String, u32)> = stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let name = parts.next()?.to_string();
            let uid: u32 = parts.next()?.parse().ok()?;
            // Real users have uid >= 501; _* system accounts are below that
            if uid >= 501 {
                Some((name, uid))
            } else {
                None
            }
        })
        .collect();

    candidates.sort_by_key(|(_, uid)| *uid);

    let mut accounts = Vec::new();
    for (username, uid) in candidates {
        let home_dir = read_dscl_field(&username, "NFSHomeDirectory").await;
        let real_name = read_dscl_field(&username, "RealName").await.ok();
        accounts.push(UserAccount {
            username,
            uid,
            home_dir: home_dir.unwrap_or_else(|_| "/var/empty".to_string()),
            real_name,
        });
    }

    Ok(accounts)
}

async fn read_dscl_field(username: &str, field: &str) -> Result<String, String> {
    let out = Command::new("dscl")
        .args([".", "read", &format!("/Users/{username}"), field])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(format!("dscl read {field} failed for {username}"));
    }

    // dscl output has two formats:
    //   Single-line: "NFSHomeDirectory: /Users/razortype\n"
    //   Multi-line:  "RealName:\n Orkun Kurul\n"
    // Find the line with ':', check if the value follows the colon on the same line;
    // if not, collect subsequent non-empty lines (trimmed) and join them.
    let stdout = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = stdout.lines().collect();

    let key_idx = lines
        .iter()
        .position(|l| l.contains(':'))
        .ok_or_else(|| format!("no key line for {field}"))?;

    let after_colon = lines[key_idx]
        .splitn(2, ':')
        .nth(1)
        .unwrap_or("")
        .trim();

    let value = if !after_colon.is_empty() {
        after_colon.to_string()
    } else {
        // Value is on the following lines (e.g. RealName multi-line format)
        lines[key_idx + 1..]
            .iter()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };

    if value.is_empty() {
        return Err(format!("empty value for {field}"));
    }

    Ok(value)
}
