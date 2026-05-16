use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelExtension {
    pub bundle_id: String,
    pub version: String,
    pub refs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelReport {
    pub extensions: Vec<KernelExtension>,
}

pub async fn probe() -> Result<KernelReport, String> {
    let out = Command::new("kmutil")
        .args(["showloaded", "--variant-suffix", "release"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // kmutil exits 0 even when no third-party extensions are loaded
    let stdout = String::from_utf8_lossy(&out.stdout);
    let extensions = parse_kmutil_output(&stdout);
    Ok(KernelReport { extensions })
}

fn parse_kmutil_output(output: &str) -> Vec<KernelExtension> {
    // Output columns (space-separated, variable widths):
    // Index  Refs  Address  Size  Wired  Name (Version)  UUID  Linked Against
    // Example line:
    //   1  8  0xffffff8000000000  0x...  0x...  com.apple.kpi.bsd (21.6.0)  ...
    // We skip Apple-signed extensions (com.apple.*) — not actionable for Macroscope.

    output
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            // Need at least: index refs addr size wired name(ver)
            if cols.len() < 6 {
                return None;
            }

            // The first numeric-looking token that isn't the index is refs
            let refs: u32 = cols.get(1)?.parse().ok()?;

            // Find the bundle_id column — first token that contains a '.'
            // and looks like a reverse-DNS identifier (not a hex address)
            let name_col = cols.iter().position(|c| {
                c.contains('.') && !c.starts_with("0x") && !c.contains('/')
            })?;

            let raw_name = cols[name_col];
            // Name may be "com.foo.bar" or "com.foo.bar (1.2.3)" — strip version
            let bundle_id = raw_name
                .split_whitespace()
                .next()
                .unwrap_or(raw_name)
                .to_string();

            // Skip Apple-signed extensions
            if bundle_id.starts_with("com.apple.") {
                return None;
            }

            // Version comes in the token after name if it matches "(x.y.z)"
            let version = cols
                .get(name_col + 1)
                .map(|v| v.trim_matches(|c| c == '(' || c == ')').to_string())
                .unwrap_or_else(|| "unknown".to_string());

            Some(KernelExtension { bundle_id, version, refs })
        })
        .collect()
}
