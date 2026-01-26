// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli;
mod database;
mod queries;

use cli::*;
use database::*;
use queries::*;
use serde_json::json;
use std::fs;
use std::time::Duration;
use tauri::{async_runtime, Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;
use tokio::time::sleep;

// Helper function to manually save window state with outer_size
fn save_window_state_with_outer_size(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get outer_size and position
    let outer_size = window.outer_size()?;
    let outer_position = window.outer_position()?;

    // Get app data directory
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;

    // Construct state file path (plugin uses "window-state.json" by default)
    let state_file = app_data_dir.join("window-state.json");

    // Read existing state or create new
    let mut state: serde_json::Value = if state_file.exists() {
        let content = fs::read_to_string(&state_file)?;
        serde_json::from_str(&content).unwrap_or(json!({}))
    } else {
        json!({})
    };

    // Get window label
    let window_label = window.label();

    // Update state for this window with outer_size
    state[window_label] = json!({
        "width": outer_size.width,
        "height": outer_size.height,
        "x": outer_position.x,
        "y": outer_position.y,
    });

    // Write state file
    fs::write(&state_file, serde_json::to_string_pretty(&state)?)?;

    Ok(())
}

// Helper function to manually restore window state with outer_size
fn restore_window_state_with_outer_size(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get app data directory
    let app_data_dir = app.path().app_data_dir()?;
    let state_file = app_data_dir.join("window-state.json");

    // Read state file
    if !state_file.exists() {
        return Ok(()); // No saved state
    }

    let content = fs::read_to_string(&state_file)?;
    let state: serde_json::Value = serde_json::from_str(&content)?;

    // Get window label
    let window_label = window.label();

    // Get saved state for this window
    if let Some(window_state) = state.get(window_label) {
        if let (Some(width), Some(height), Some(x), Some(y)) = (
            window_state
                .get("width")
                .and_then(|v| v.as_u64().map(|n| n as u32)),
            window_state
                .get("height")
                .and_then(|v| v.as_u64().map(|n| n as u32)),
            window_state
                .get("x")
                .and_then(|v| v.as_i64().map(|n| n as i32)),
            window_state
                .get("y")
                .and_then(|v| v.as_i64().map(|n| n as i32)),
        ) {
            // Restore window size and position using outer_size values (physical pixels)
            use tauri::PhysicalSize;
            window.set_size(PhysicalSize::new(width, height))?;
            use tauri::PhysicalPosition;
            window.set_position(PhysicalPosition::new(x, y))?;
        }
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_cli_status,
            check_cli_update,
            get_latest_github_version,
            download_cli,
            init_cli,
            fetch_data,
            get_database_path_str,
            database_exists,
            delete_database,
            query_stats,
            query_sales,
            query_daily_summaries,
            query_app_summaries,
            query_country_summaries,
            query_apps_lookup,
            query_countries_lookup,
            query_dates_list,
            query_raw_data_by_date,
            query_packages_lookup,
            query_packages_by_app,
            query_product_stats,
            query_launch_comparison
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // The plugin will restore the window state automatically, but it uses inner_size
                // So we need to manually restore with outer_size after the plugin does its thing
                // We'll do this after a short delay to ensure the plugin has finished restoring
                let app_handle = app.handle().clone();
                let window_handle = window.clone();

                // Restore window state manually with outer_size after plugin restoration
                // The plugin restores with inner_size, so we override it with outer_size
                async_runtime::spawn(async move {
                    // Wait longer for plugin to finish restoring and window to be fully initialized
                    sleep(Duration::from_millis(300)).await;
                    // Now manually restore with the correct outer_size from our saved state
                    if let Err(e) =
                        restore_window_state_with_outer_size(&app_handle, &window_handle)
                    {
                        eprintln!("Failed to manually restore window state: {:?}", e);
                    }
                });

                // Restore window state (plugin handles this automatically, but we ensure it's visible)
                window.show().unwrap_or_default();

                // Only open devtools if DEBUG_DEVTOOLS environment variable is set
                #[cfg(debug_assertions)]
                {
                    if std::env::var("DEBUG_DEVTOOLS").is_ok() {
                        window.open_devtools();
                    }
                }

                // Save window state using outer_size to include devtools
                let app_handle = app.handle().clone();
                let window_handle = window.clone();

                window.on_window_event(move |event| {
                    match event {
                        WindowEvent::Resized(_) => {
                            let handle = app_handle.clone();
                            let win = window_handle.clone();
                            // Use async_runtime to save after a delay, ensuring we capture outer_size
                            async_runtime::spawn(async move {
                                // Wait longer to ensure window has finished resizing (including devtools)
                                // Devtools can take time to render and affect the window layout
                                sleep(Duration::from_millis(500)).await;
                                // Manually save with outer_size (bypassing plugin's inner_size issue)
                                if let Err(e) = save_window_state_with_outer_size(&handle, &win) {
                                    eprintln!("Failed to manually save window state: {:?}", e);
                                }
                            });
                        }
                        WindowEvent::CloseRequested { .. } => {
                            // Save state immediately when app is closing to capture final size
                            // Manually save with outer_size to ensure we capture the total window bounds including devtools
                            if let Err(e) =
                                save_window_state_with_outer_size(&app_handle, &window_handle)
                            {
                                eprintln!("Failed to save window state on close: {:?}", e);
                            }
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
