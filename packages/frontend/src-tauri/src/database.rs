use std::path::PathBuf;

pub fn get_database_path() -> PathBuf {
    let home = dirs::home_dir().expect("Failed to get home directory");
    home.join(".steamsales").join("steam-financial.db")
}

/// Returns true if the database file exists and has the expected schema (sales_data table).
/// If the file exists but is invalid, it is deleted.
pub fn ensure_database_usable() -> bool {
    let db_path = get_database_path();
    if !db_path.exists() {
        return false;
    }
    let conn = match rusqlite::Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => {
            let _ = std::fs::remove_file(&db_path);
            return false;
        }
    };
    let usable = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_data' LIMIT 1",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !usable {
        drop(conn);
        let _ = std::fs::remove_file(&db_path);
        // Also clean up WAL and SHM files
        let db_filename = db_path.file_name().unwrap().to_string_lossy();
        let wal = db_path
            .parent()
            .unwrap()
            .join(format!("{}-wal", db_filename));
        let shm = db_path
            .parent()
            .unwrap()
            .join(format!("{}-shm", db_filename));
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);
        return false;
    }
    true
}

#[tauri::command]
pub async fn get_database_path_str() -> Result<String, String> {
    let path = get_database_path();
    if !path.exists() {
        return Err("Database file not found".to_string());
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn database_exists() -> Result<bool, String> {
    Ok(get_database_path().exists())
}

#[tauri::command]
pub async fn delete_database() -> Result<(), String> {
    let db_path = get_database_path();

    // Close any open connections first by ensuring the path is correct
    // SQLite may have the database locked if there are open connections

    // Delete main database file
    if db_path.exists() {
        std::fs::remove_file(&db_path)
            .map_err(|e| format!("Failed to delete database file: {}", e))?;
    }

    // Delete SQLite WAL file (Write-Ahead Log)
    // SQLite creates this as <dbname>-wal, e.g., steam-financial.db-wal
    let db_filename = db_path.file_name().unwrap().to_string_lossy();
    let wal_path = db_path
        .parent()
        .unwrap()
        .join(format!("{}-wal", db_filename));
    if wal_path.exists() {
        if let Err(e) = std::fs::remove_file(&wal_path) {
            eprintln!(
                "Warning: Failed to delete WAL file {}: {}",
                wal_path.display(),
                e
            );
        }
    }

    // Delete SQLite SHM file (Shared Memory)
    // SQLite creates this as <dbname>-shm, e.g., steam-financial.db-shm
    let shm_path = db_path
        .parent()
        .unwrap()
        .join(format!("{}-shm", db_filename));
    if shm_path.exists() {
        if let Err(e) = std::fs::remove_file(&shm_path) {
            eprintln!(
                "Warning: Failed to delete SHM file {}: {}",
                shm_path.display(),
                e
            );
        }
    }

    // Verify the main database file is actually gone
    if db_path.exists() {
        return Err("Database file still exists after deletion attempt".to_string());
    }

    Ok(())
}
