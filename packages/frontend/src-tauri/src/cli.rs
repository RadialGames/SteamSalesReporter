use crate::database;
use serde::{Deserialize, Serialize};
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

#[derive(Debug, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub database_exists: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VersionCheck {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
}

const CLI_RELEASES_BASE: &str =
    "https://github.com/RadialGames/steam-financial-cli/releases/download";
const CLI_RELEASES_API: &str =
    "https://api.github.com/repos/RadialGames/steam-financial-cli/releases/latest";
const CLI_BINARY_NAME: &str = "steam-financial";

/// Fetches the latest CLI version from GitHub releases.
async fn fetch_latest_cli_version() -> Result<String, String> {
    println!("[fetch_latest_cli_version] Creating HTTP client...");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    println!("[fetch_latest_cli_version] Sending request to {}...", CLI_RELEASES_API);
    let response = client
        .get(CLI_RELEASES_API)
        .header("User-Agent", "steam-sales-analyzer")
        .send()
        .await
        .map_err(|e| {
            println!("[fetch_latest_cli_version] Request failed: {}", e);
            format!("Failed to check for updates: {}", e)
        })?;

    println!("[fetch_latest_cli_version] Got response: HTTP {}", response.status());
    
    if !response.status().is_success() {
        return Err(format!(
            "Failed to check for updates: HTTP {}",
            response.status()
        ));
    }

    println!("[fetch_latest_cli_version] Parsing JSON...");
    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    println!("[fetch_latest_cli_version] Got tag_name: {}", release.tag_name);
    Ok(release.tag_name.trim_start_matches('v').to_string())
}

/// Tauri command to get just the latest version from GitHub (no local version check)
#[tauri::command]
pub async fn get_latest_github_version() -> Result<String, String> {
    fetch_latest_cli_version().await
}

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
        // Run version check in a blocking task with timeout to prevent hangs
        let binary_path_clone = binary_path.clone();
        let version_result = timeout(
            Duration::from_secs(5),
            tokio::task::spawn_blocking(move || {
                Command::new(&binary_path_clone)
                    .arg("--version")
                    .output()
                    .ok()
            })
        )
        .await;

        match version_result {
            Ok(Ok(Some(output))) if output.status.success() => {
                version = Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            _ => {
                // Timeout or error - version check failed, but we still know CLI is installed
                // Just leave version as None
            }
        }
    }

    // Check database in a blocking task to avoid blocking the async runtime
    let database_exists = tokio::task::spawn_blocking(|| {
        database::ensure_database_usable()
    })
    .await
    .unwrap_or(false);

    Ok(CliStatus {
        installed,
        version,
        database_exists,
    })
}

// Extract version number from a string (handles formats like "1.0.0", "v1.0.0", "steam-financial 1.0.0", etc.)
fn extract_version(version_str: &str) -> String {
    let cleaned = version_str.trim_start_matches('v').trim();
    
    // Try to find a version pattern (x.y.z where x, y, z are numbers)
    // Look for the first sequence that matches the pattern
    for word in cleaned.split_whitespace() {
        let parts: Vec<&str> = word.split('.').collect();
        if parts.len() >= 2 && parts.iter().all(|p| p.parse::<u32>().is_ok()) {
            // Found a version-like pattern, return it
            return parts.join(".");
        }
    }
    
    // Fallback: if the whole string looks like a version, use it
    if cleaned.split('.').all(|p| p.parse::<u32>().is_ok()) {
        return cleaned.to_string();
    }
    
    // Last resort: return as-is
    cleaned.to_string()
}

// Compare semantic versions (simple implementation for x.y.z format)
fn compare_versions(current: &str, latest: &str) -> std::cmp::Ordering {
    let parse_version = |v: &str| -> Vec<u32> {
        let clean = extract_version(v);
        clean
            .split('.')
            .map(|s| s.parse::<u32>().unwrap_or(0))
            .collect()
    };

    let current_parts = parse_version(current);
    let latest_parts = parse_version(latest);

    for (c, l) in current_parts.iter().zip(latest_parts.iter()) {
        match c.cmp(l) {
            std::cmp::Ordering::Equal => continue,
            other => return other,
        }
    }

    current_parts.len().cmp(&latest_parts.len())
}

#[tauri::command]
pub async fn check_cli_update() -> Result<VersionCheck, String> {
    println!("[check_cli_update] Starting...");
    
    // Get current installed version via `steam-financial --version`
    // Run in spawn_blocking with timeout to avoid blocking async runtime
    let binary_path = get_cli_binary_path();
    println!("[check_cli_update] Binary path: {:?}, exists: {}", binary_path, binary_path.exists());
    
    let mut current_version = None;
    if binary_path.exists() {
        println!("[check_cli_update] Running --version check with 5s timeout...");
        let binary_path_clone = binary_path.clone();
        let version_result = timeout(
            Duration::from_secs(5),
            tokio::task::spawn_blocking(move || {
                Command::new(&binary_path_clone)
                    .arg("--version")
                    .output()
                    .ok()
            })
        )
        .await;

        match &version_result {
            Ok(Ok(Some(output))) if output.status.success() => {
                let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                println!("[check_cli_update] Got version: {}", version_str);
                current_version = Some(version_str);
            }
            Ok(Ok(Some(output))) => {
                println!("[check_cli_update] Version command failed with status: {:?}", output.status);
            }
            Ok(Ok(None)) => {
                println!("[check_cli_update] Version command returned None");
            }
            Ok(Err(e)) => {
                println!("[check_cli_update] spawn_blocking error: {:?}", e);
            }
            Err(_) => {
                println!("[check_cli_update] Version check timed out after 5s");
            }
        }
    }

    // Fetch latest version from GitHub releases
    println!("[check_cli_update] Fetching latest version from GitHub...");
    let latest_version = fetch_latest_cli_version().await?;
    println!("[check_cli_update] Got latest version: {}", latest_version);

    let update_available = match &current_version {
        None => true, // Not installed; offer to install latest
        Some(current) => {
            compare_versions(current, &latest_version) == std::cmp::Ordering::Less
        }
    };

    Ok(VersionCheck {
        current_version,
        latest_version,
        update_available,
    })
}

#[tauri::command]
pub async fn download_cli(app: AppHandle, version: Option<String>) -> Result<String, String> {
    let binary_path = get_cli_binary_path();
    let version_to_download = match version {
        Some(v) => v.clone(),
        None => fetch_latest_cli_version().await?,
    };

    // Emit progress: Starting download
    let _ = app.emit("download-progress", format!("Downloading CLI tool v{}...", version_to_download));

    let cli_dir = get_cli_dir();
    fs::create_dir_all(&cli_dir).map_err(|e| format!("Failed to create directory: {}", e))?;

    let zip_name = get_binary_name();
    let download_url = format!("{}/v{}/{}", CLI_RELEASES_BASE, version_to_download, zip_name);
    let zip_path = cli_dir.join(&zip_name);

    // Emit progress: Connecting to download server
    let _ = app.emit("download-progress", format!("Connecting to {}...", download_url));

    // Download the zip file (async)
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    // Emit progress: Downloading file
    if let Some(content_length) = response.content_length() {
        let _ = app.emit("download-progress", format!("Downloading {} bytes...", content_length));
    } else {
        let _ = app.emit("download-progress", "Downloading file...");
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Emit progress: Download complete, extracting
    let _ = app.emit("download-progress", format!("Download complete ({} bytes). Extracting...", bytes.len()));

    // Write file and extract zip (blocking operations, run in spawn_blocking)
    let zip_path_clone = zip_path.clone();
    let cli_dir_clone = cli_dir.clone();
    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        // Delete entire cli directory (binary, zip, README, any cruft) then recreate fresh
        let _ = app_handle.emit("download-progress", "Preparing install directory...");
        if cli_dir_clone.exists() {
            fs::remove_dir_all(&cli_dir_clone)
                .map_err(|e| format!("Failed to remove existing CLI directory: {}", e))?;
        }
        fs::create_dir_all(&cli_dir_clone)
            .map_err(|e| format!("Failed to create CLI directory: {}", e))?;

        // Emit progress: Saving file
        let _ = app_handle.emit("download-progress", "Saving downloaded file...");
        
        fs::write(&zip_path_clone, bytes).map_err(|e| format!("Failed to save zip: {}", e))?;

        // Emit progress: Extracting
        let _ = app_handle.emit("download-progress", "Extracting archive...");

        // Extract zip file (blocking operation)
        let file = std::fs::File::open(&zip_path_clone)
            .map_err(|e| format!("Failed to open zip: {}", e))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read zip: {}", e))?;

        archive
            .extract(&cli_dir_clone)
            .map_err(|e| format!("Failed to extract zip: {}", e))?;

        // Clean up zip file
        let _ = app_handle.emit("download-progress", "Cleaning up temporary files...");
        let _ = fs::remove_file(&zip_path_clone);

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e)?;

    // Make binary executable and remove macOS quarantine (Unix only)
    #[cfg(unix)]
    {
        let _ = app.emit("download-progress", "Setting executable permissions and removing quarantine...");
        
        // Remove macOS quarantine attribute (prevents "zsh: killed" from Gatekeeper)
        #[cfg(target_os = "macos")]
        {
            let binary_path_str = binary_path.to_string_lossy().to_string();
            let output = Command::new("xattr")
                .args(&["-d", "com.apple.quarantine", &binary_path_str])
                .output();
            if let Err(e) = output {
                println!("Warning: Failed to remove quarantine attribute: {:?}", e);
                // Continue anyway - might not have quarantine attribute
            } else if let Ok(output) = output {
                if !output.status.success() {
                    println!("Warning: xattr command failed (might not have quarantine): {:?}", output.status);
                    // Continue anyway - file might not have quarantine attribute
                }
            }
        }
        
        // Set executable permissions
        let mut perms = fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Emit completion event
    let _ = app.emit("download-complete", ());

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
