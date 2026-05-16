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
    Snapshot {
        created_at: Utc::now(),
        disk: None,
        processes: None,
        network: None,
        persistence: None,
        users: None,
        kernel: None,
        partial_failures: vec![],
    }
}
