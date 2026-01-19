mod commands;
mod database;
mod secure_storage;
mod steam_api;
mod types;

use database::Database;
use secure_storage::SecureStorage;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Database>>,
    pub storage: Arc<Mutex<SecureStorage>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Create data directory if it doesn't exist
            std::fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");

            // Initialize database and run cleanup
            let mut db = Database::new(&app_data_dir).expect("Failed to initialize database");
            let (duplicate_ids, duplicate_logical) = db
                .initialize_and_cleanup()
                .expect("Failed to clean up database");
            if duplicate_ids > 0 {
                eprintln!("Database cleanup: removed {} duplicate IDs", duplicate_ids);
            }
            if duplicate_logical > 0 {
                eprintln!("Database cleanup: removed {} duplicate logical records", duplicate_logical);
            }

            // Initialize secure storage
            let storage =
                SecureStorage::new(&app_data_dir).expect("Failed to initialize secure storage");

            // Store state
            app.manage(AppState {
                db: Arc::new(Mutex::new(db)),
                storage: Arc::new(Mutex::new(storage)),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_api_keys,
            commands::get_api_key,
            commands::add_api_key,
            commands::update_api_key_name,
            commands::delete_api_key,
            commands::fetch_sales_data,
            commands::get_sales_from_db,
            commands::save_sales_data,
            commands::get_highwatermark,
            commands::set_highwatermark,
            commands::clear_all_data,
            commands::clear_data_for_key,
            commands::get_existing_dates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
