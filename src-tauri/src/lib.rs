mod commands;
mod secure_storage;
mod types;

use secure_storage::SecureStorage;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<Mutex<SecureStorage>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Create data directory if it doesn't exist
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

            // Initialize secure storage (for API key values only)
            // All other data is stored in Dexie/IndexedDB
            let storage =
                SecureStorage::new(&app_data_dir).expect("Failed to initialize secure storage");

            // Store state
            app.manage(AppState {
                storage: Arc::new(Mutex::new(storage)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_api_key,
            commands::add_api_key,
            commands::delete_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
