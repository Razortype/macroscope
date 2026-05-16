pub mod disk;
pub mod kernel;
pub mod network;
pub mod persistence;
pub mod processes;
pub mod users;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use self::disk::DiskReport;
use self::kernel::KernelReport;
use self::network::NetworkReport;
use self::persistence::PersistenceReport;
use self::processes::ProcessInfo;
use self::users::UserAccount;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeFailure {
    pub probe: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub created_at: DateTime<Utc>,
    pub disk: Option<DiskReport>,
    pub processes: Option<Vec<ProcessInfo>>,
    pub network: Option<NetworkReport>,
    pub persistence: Option<PersistenceReport>,
    pub users: Option<Vec<UserAccount>>,
    pub kernel: Option<KernelReport>,
    pub partial_failures: Vec<ProbeFailure>,
}

pub async fn take_snapshot() -> Snapshot {
    let (disk_res, procs_res, net_res, persist_res, users_res, kernel_res) = tokio::join!(
        disk::probe(),
        processes::probe(),
        network::probe(),
        persistence::probe(),
        users::probe(),
        kernel::probe(),
    );

    let mut partial_failures = Vec::new();

    macro_rules! unwrap_probe {
        ($result:expr, $name:literal) => {
            match $result {
                Ok(v) => Some(v),
                Err(e) => {
                    partial_failures.push(ProbeFailure {
                        probe: $name.to_string(),
                        message: e,
                    });
                    None
                }
            }
        };
    }

    let disk = unwrap_probe!(disk_res, "disk");
    let processes = unwrap_probe!(procs_res, "processes");
    let network = unwrap_probe!(net_res, "network");
    let persistence = unwrap_probe!(persist_res, "persistence");
    let users = unwrap_probe!(users_res, "users");
    let kernel = unwrap_probe!(kernel_res, "kernel");

    // Note: persistence.login_items errors are NOT added to partial_failures —
    // they serialize as Err(message) inside PersistenceReport and the frontend
    // renders them as a targeted "grant permission" affordance.

    Snapshot {
        created_at: Utc::now(),
        disk,
        processes,
        network,
        persistence,
        users,
        kernel,
        partial_failures,
    }
}
