pub mod error;
pub mod snapshot;

#[tauri::command]
async fn take_snapshot() -> Result<snapshot::Snapshot, String> {
    Ok(snapshot::take_snapshot().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![take_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
