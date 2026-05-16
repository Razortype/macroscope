use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningPort {
    pub pid: u32,
    pub process: String,
    pub protocol: String,
    pub address: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub pid: u32,
    pub process: String,
    pub protocol: String,
    pub local: String,
    pub remote: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkReport {
    pub listening: Vec<ListeningPort>,
    pub established: Vec<Connection>,
}

pub async fn probe() -> Result<NetworkReport, String> {
    // -F field mode: p=pid, c=command, P=protocol, n=name (addr:port), T=TCP state
    // Each record starts with 'p' (PID), then fields follow until next 'p'
    let out = Command::new("lsof")
        .args(["-i", "-nP", "-F", "pcPnT"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    // lsof exits non-zero when no files found — treat output as valid regardless
    let stdout = String::from_utf8_lossy(&out.stdout);
    parse_lsof_field_output(&stdout)
}

fn parse_lsof_field_output(output: &str) -> Result<NetworkReport, String> {
    // Field-mode output groups by process (p line) then file (f line).
    // Each field is one character prefix + value on its own line.
    // We collect per-file records; a new 'p' resets current process context.

    let mut listening = Vec::new();
    let mut established = Vec::new();

    let mut cur_pid: u32 = 0;
    let mut cur_cmd = String::new();

    // Per-file accumulator
    let mut file_fields: HashMap<char, String> = HashMap::new();

    let flush = |pid: u32,
                 cmd: &str,
                 fields: &HashMap<char, String>,
                 listening: &mut Vec<ListeningPort>,
                 established: &mut Vec<Connection>| {
        let name = fields.get(&'n').cloned().unwrap_or_default();
        let proto = fields.get(&'P').cloned().unwrap_or_default();
        // TCP state comes as "TST=LISTEN" or "TST=ESTABLISHED" etc.
        let state = fields
            .get(&'T')
            .and_then(|v| v.strip_prefix("ST="))
            .unwrap_or("")
            .to_string();

        if name.is_empty() || proto.is_empty() {
            return;
        }

        if state == "LISTEN" {
            // name format: "*:port" or "addr:port"
            if let Some((addr, port_str)) = name.rsplit_once(':') {
                if let Ok(port) = port_str.parse::<u16>() {
                    listening.push(ListeningPort {
                        pid,
                        process: cmd.to_string(),
                        protocol: proto,
                        address: addr.to_string(),
                        port,
                    });
                }
            }
        } else if state == "ESTABLISHED" {
            // name format: "local->remote"
            let (local, remote) = name
                .split_once("->")
                .map(|(l, r)| (l.to_string(), r.to_string()))
                .unwrap_or_else(|| (name.clone(), String::new()));

            established.push(Connection {
                pid,
                process: cmd.to_string(),
                protocol: proto,
                local,
                remote,
                state,
            });
        }
    };

    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let (key, val) = (line.chars().next().unwrap(), &line[1..]);
        match key {
            'p' => {
                // New process block — flush previous file if any
                flush(cur_pid, &cur_cmd, &file_fields, &mut listening, &mut established);
                file_fields.clear();
                cur_pid = val.parse().unwrap_or(0);
                cur_cmd.clear();
            }
            'c' => {
                cur_cmd = val.to_string();
            }
            'f' => {
                // New file descriptor — flush previous file
                flush(cur_pid, &cur_cmd, &file_fields, &mut listening, &mut established);
                file_fields.clear();
            }
            'P' | 'n' => {
                file_fields.insert(key, val.to_string());
            }
            'T' => {
                // May appear multiple times (TST=, TQR=, etc.) — keep state line
                if val.starts_with("ST=") {
                    file_fields.insert(key, val.to_string());
                }
            }
            _ => {}
        }
    }
    // Flush last record
    flush(cur_pid, &cur_cmd, &file_fields, &mut listening, &mut established);

    Ok(NetworkReport { listening, established })
}
