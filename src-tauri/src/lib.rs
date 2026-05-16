pub mod db;
pub mod error;
pub mod snapshot;

use db::Db;
use snapshot::{Snapshot, SnapshotMeta};
use tauri::State;

#[tauri::command]
async fn take_snapshot() -> Result<Snapshot, String> {
    Ok(snapshot::take_snapshot().await)
}

#[tauri::command]
async fn save_snapshot(
    snapshot: Snapshot,
    db: State<'_, Db>,
) -> Result<i64, String> {
    let created_at = snapshot.created_at.to_rfc3339();
    let payload = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.save_snapshot(&created_at, &payload))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[tauri::command]
async fn list_snapshots(db: State<'_, Db>) -> Result<Vec<SnapshotMeta>, String> {
    let db = db.inner().clone();
    let rows = tokio::task::spawn_blocking(move || db.list_snapshots())
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;

    rows.into_iter()
        .map(|(id, ts)| {
            let created_at = ts
                .parse::<chrono::DateTime<chrono::Utc>>()
                .map_err(|e| e.to_string())?;
            Ok(SnapshotMeta { id, created_at })
        })
        .collect()
}

#[tauri::command]
async fn get_snapshot(id: i64, db: State<'_, Db>) -> Result<Snapshot, String> {
    let db = db.inner().clone();
    let payload = tokio::task::spawn_blocking(move || db.get_snapshot_payload(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::<String>::into)?;
    serde_json::from_str(&payload).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_snapshot(id: i64, db: State<'_, Db>) -> Result<(), String> {
    let db = db.inner().clone();
    tokio::task::spawn_blocking(move || db.delete_snapshot(id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(Into::into)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Db::new().expect("failed to open database");

    tauri::Builder::default()
        .manage(db)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            take_snapshot,
            save_snapshot,
            list_snapshots,
            get_snapshot,
            delete_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
