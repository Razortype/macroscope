pub mod apps;
pub mod disk;
pub mod kernel;
pub mod large_files;
pub mod network;
pub mod persistence;
pub mod processes;
pub mod users;

use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use self::apps::AppsSnapshot;
use self::disk::DiskReport;
use self::kernel::KernelReport;
use self::large_files::LargeFilesSnapshot;
use self::network::NetworkReport;
use self::persistence::PersistenceReport;
use self::processes::ProcessInfo;
use self::users::UserAccount;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    pub id: i64,
    pub created_at: DateTime<Utc>,
}

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
    pub apps: Option<AppsSnapshot>,
    pub large_files: Option<LargeFilesSnapshot>,
    pub partial_failures: Vec<ProbeFailure>,
    #[serde(default)]
    pub executed_paths: Vec<String>,
    #[serde(default)]
    pub partial_paths: Vec<String>,
}

async fn probe_timed<T>(
    app: &AppHandle,
    name: &str,
    fut: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let _ = app.emit(
        "snapshot:probe",
        serde_json::json!({ "probe": name, "status": "starting", "duration_ms": 0u64 }),
    );
    let start = Instant::now();
    let res = fut.await;
    let duration_ms = start.elapsed().as_millis() as u64;
    let _ = match &res {
        Ok(_) => app.emit(
            "snapshot:probe",
            serde_json::json!({ "probe": name, "status": "complete", "duration_ms": duration_ms }),
        ),
        Err(e) => app.emit(
            "snapshot:probe",
            serde_json::json!({ "probe": name, "status": "failed", "duration_ms": duration_ms, "error": e }),
        ),
    };
    res
}

async fn probe_timed_infallible<T>(
    app: &AppHandle,
    name: &str,
    fut: impl std::future::Future<Output = T>,
) -> T {
    let _ = app.emit(
        "snapshot:probe",
        serde_json::json!({ "probe": name, "status": "starting", "duration_ms": 0u64 }),
    );
    let start = Instant::now();
    let result = fut.await;
    let duration_ms = start.elapsed().as_millis() as u64;
    let _ = app.emit(
        "snapshot:probe",
        serde_json::json!({ "probe": name, "status": "complete", "duration_ms": duration_ms }),
    );
    result
}

pub async fn take_snapshot(app: &AppHandle) -> Snapshot {
    let mut partial_failures = Vec::new();

    let (disk_res, procs_res, net_res, persist_res, users_res, kernel_res, apps_res, large_files_snap) =
        tokio::join!(
            probe_timed(app, "disk", disk::probe()),
            probe_timed(app, "processes", processes::probe()),
            probe_timed(app, "network", network::probe()),
            probe_timed(app, "persistence", persistence::probe()),
            probe_timed(app, "users", users::probe()),
            probe_timed(app, "kernel", kernel::probe()),
            probe_timed(app, "apps", apps::probe()),
            probe_timed_infallible(app, "large_files", large_files::probe()),
        );

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
    let apps = unwrap_probe!(apps_res, "apps");

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
        apps,
        large_files: Some(large_files_snap),
        partial_failures,
        executed_paths: Vec::new(),
        partial_paths: Vec::new(),
    }
}
