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

    // Output: "FieldName: value\n" — strip the "FieldName: " prefix
    let stdout = String::from_utf8_lossy(&out.stdout);
    let value = stdout
        .lines()
        .find(|l| l.contains(':'))
        .and_then(|l| l.splitn(2, ':').nth(1))
        .map(|v| v.trim().to_string())
        .ok_or_else(|| format!("no value for {field}"))?;

    Ok(value)
}
