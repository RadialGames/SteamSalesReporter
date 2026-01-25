use crate::database;
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;

#[derive(Debug, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub database_exists: bool,
}

const CLI_VERSION: &str = "1.0.0";
const CLI_RELEASES_BASE: &str =
    "https://github.com/RadialGames/steam-financial-cli/releases/download";
const CLI_BINARY_NAME: &str = "steam-financial";

fn get_cli_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    home.join(".steamsales").join("cli")
}

fn get_cli_binary_path() -> PathBuf {
    let mut path = get_cli_dir();
    #[cfg(windows)]
    path.push(format!("{}.exe", CLI_BINARY_NAME));
    #[cfg(not(windows))]
    path.push(CLI_BINARY_NAME);
    path
}

fn get_binary_name() -> String {
    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        return "steam-financial-macos-arm64.zip".to_string();
        #[cfg(not(target_arch = "aarch64"))]
        return "steam-financial-macos-x86_64.zip".to_string();
    }
    #[cfg(target_os = "linux")]
    return "steam-financial-linux-x86_64.zip".to_string();
    #[cfg(target_os = "windows")]
    return "steam-financial-windows-x86_64.zip".to_string();
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    panic!("Unsupported platform");
}

#[tauri::command]
pub async fn get_cli_status() -> Result<CliStatus, String> {
    let binary_path = get_cli_binary_path();
    let installed = binary_path.exists();

    let mut version = None;
    if installed {
        let output = Command::new(&binary_path).arg("--version").output().ok();
        if let Some(output) = output {
            if output.status.success() {
                version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }

    let database_exists = database::ensure_database_usable();

    Ok(CliStatus {
        installed,
        version,
        database_exists,
    })
}

#[tauri::command]
pub async fn download_cli() -> Result<String, String> {
    let binary_path = get_cli_binary_path();

    if binary_path.exists() {
        return Ok(binary_path.to_string_lossy().to_string());
    }

    let cli_dir = get_cli_dir();
    fs::create_dir_all(&cli_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let zip_name = get_binary_name();
    let download_url = format!("{}/v{}/{}", CLI_RELEASES_BASE, CLI_VERSION, zip_name);
    let zip_path = cli_dir.join(&zip_name);

    // Download the zip file (async)
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Write file and extract zip (blocking operations, run in spawn_blocking)
    let zip_path_clone = zip_path.clone();
    let cli_dir_clone = cli_dir.clone();
    tokio::task::spawn_blocking(move || {
        fs::write(&zip_path_clone, bytes).map_err(|e| format!("Failed to save zip: {}", e))?;

        // Extract zip file (blocking operation)
        let file = std::fs::File::open(&zip_path_clone)
            .map_err(|e| format!("Failed to open zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

        archive
            .extract(&cli_dir_clone)
            .map_err(|e| format!("Failed to extract zip: {}", e))?;

        // Clean up zip file
        let _ = fs::remove_file(&zip_path_clone);

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e)?;

    // Make binary executable (Unix only)
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(binary_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn init_cli(api_key: String) -> Result<(), String> {
    let binary_path = get_cli_binary_path();

    if !binary_path.exists() {
        return Err("CLI tool not installed. Please download it first.".to_string());
    }

    let db_path = database::get_database_path();
    let db_path_str = db_path.to_string_lossy().to_string();

    let output = Command::new(&binary_path)
        .args(&["--db", &db_path_str, "--color", "never", "init", &api_key])
        .output()
        .map_err(|e| format!("Failed to execute CLI: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("CLI init failed: {}", error));
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_data(app: AppHandle, force: Option<bool>) -> Result<(), String> {
    let binary_path = get_cli_binary_path();

    if !binary_path.exists() {
        return Err("CLI tool not installed. Please download it first.".to_string());
    }

    let db_path = database::get_database_path();
    let db_path_str = db_path.to_string_lossy().to_string();

    let mut args = vec!["--db", &db_path_str, "--color", "never", "fetch"];
    if force.unwrap_or(false) {
        args.push("--force");
    }

    // Spawn process with piped stdout/stderr to capture progress
    let mut child = TokioCommand::new(&binary_path)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute CLI: {}", e))?;

    // Read stdout line by line and emit progress events
    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let app_handle = app.clone();
    let stdout_handle: tokio::task::JoinHandle<()> = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        // Emit progress event with the line
                        let _ = app_handle.emit("fetch-progress", trimmed);
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });

    // Read stderr for errors
    let app_handle_err = app.clone();
    let stderr_handle: tokio::task::JoinHandle<Vec<String>> = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut error_lines = Vec::new();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        error_lines.push(trimmed.to_string());
                        // Also emit as progress so user can see errors in real-time
                        let _ = app_handle_err.emit("fetch-progress", trimmed);
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        error_lines
    });

    // Wait for process to complete
    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for CLI: {}", e))?;

    // Wait for readers to finish
    let _ = stdout_handle.await;
    let error_lines = stderr_handle
        .await
        .map_err(|e| format!("Failed to read stderr: {}", e))?;

    if !status.success() {
        let error = if error_lines.is_empty() {
            "CLI fetch failed with unknown error".to_string()
        } else {
            error_lines.join("\n")
        };
        return Err(format!("CLI fetch failed: {}", error));
    }

    // Emit completion event
    let _ = app.emit("fetch-complete", ());

    Ok(())
}
