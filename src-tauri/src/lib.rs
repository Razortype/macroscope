pub mod db;
pub mod error;
pub mod snapshot;

use db::Db;

#[tauri::command]
async fn take_snapshot() -> Result<snapshot::Snapshot, String> {
    Ok(snapshot::take_snapshot().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Db::new().expect("failed to open database");

    tauri::Builder::default()
        .manage(db)
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![take_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
