use crate::types::ApiKeyInfo;
use crate::AppState;
use tauri::State;
use uuid::Uuid;

// Multi-key API management
// Note: API key metadata is now stored in Dexie (IndexedDB), not in Rust database
// Only the actual key values are stored in secure storage (Tauri) or localStorage (browser)

#[tauri::command]
pub fn get_api_key(state: State<'_, AppState>, id: String) -> Result<Option<String>, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.get_api_key(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_api_key(
    state: State<'_, AppState>,
    key: String,
    display_name: Option<String>,
) -> Result<ApiKeyInfo, String> {
    let id = Uuid::new_v4().to_string();
    let key_hash = if key.len() >= 4 {
        key[key.len() - 4..].to_string()
    } else {
        key.clone()
    };
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let info = ApiKeyInfo {
        id: id.clone(),
        display_name,
        key_hash,
        created_at,
    };

    // Store the encrypted key in secure storage
    // Note: Metadata (info) should be stored in Dexie by the frontend
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.add_api_key(&id, &key).map_err(|e| e.to_string())?;

    Ok(info)
}

#[tauri::command]
pub fn delete_api_key(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Delete the key from secure storage
    // Note: Metadata deletion should be handled in Dexie by the frontend
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    storage.delete_api_key(&id).map_err(|e| e.to_string())?;

    Ok(())
}
