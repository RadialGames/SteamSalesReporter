use crate::steam_api::SteamApi;
use crate::types::{ApiKeyInfo, FetchResult, Filters, SalesRecord, SyncTask};
use crate::AppState;
use tauri::State;
use uuid::Uuid;

// Multi-key API management

#[tauri::command]
pub fn get_all_api_keys(state: State<'_, AppState>) -> Result<Vec<ApiKeyInfo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_api_keys().map_err(|e| e.to_string())
}

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

    // Store the encrypted key
    {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.add_api_key(&id, &key).map_err(|e| e.to_string())?;
    }

    // Store the metadata in database
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.add_api_key_info(&info).map_err(|e| e.to_string())?;
    }

    Ok(info)
}

#[tauri::command]
pub fn update_api_key_name(
    state: State<'_, AppState>,
    id: String,
    display_name: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_api_key_name(&id, &display_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_api_key(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // First clear data for this key
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.clear_data_for_key(&id).map_err(|e| e.to_string())?;
        db.delete_api_key_info(&id).map_err(|e| e.to_string())?;
    }

    // Then delete the key itself
    {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.delete_api_key(&id).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// Data operations

#[tauri::command]
pub async fn fetch_sales_data(
    state: State<'_, AppState>,
    api_key_id: String,
) -> Result<FetchResult, String> {
    // Get the API key
    let api_key = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage
            .get_api_key(&api_key_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "API key not found".to_string())?
    };

    // Get stored highwatermark and existing dates
    let (stored_highwatermark, existing_dates) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let hwm = db.get_highwatermark(&api_key_id).map_err(|e| e.to_string())?;
        let dates = db.get_existing_dates(&api_key_id).map_err(|e| e.to_string())?;
        (hwm, dates)
    };

    // Create Steam API client and fetch data
    let steam_api = SteamApi::new();
    
    // We need to clone state for the closure
    let state_clone = state.inner().clone();
    let api_key_id_clone = api_key_id.clone();
    
    let result = steam_api
        .fetch_sales_data(
            &api_key,
            &api_key_id,
            stored_highwatermark,
            &existing_dates,
            |batch| {
                let db = state_clone.db.lock().map_err(|e| e.to_string())?;
                db.save_sales(batch, &api_key_id_clone)
                    .map_err(|e| e.to_string())
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(result)
}

#[tauri::command]
pub fn get_sales_from_db(
    state: State<'_, AppState>,
    filters: Filters,
) -> Result<Vec<SalesRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_sales(&filters).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_sales_data(
    state: State<'_, AppState>,
    data: Vec<SalesRecord>,
    api_key_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.save_sales(&data, &api_key_id).map_err(|e| e.to_string())
}

// Per-key highwatermark

#[tauri::command]
pub fn get_highwatermark(state: State<'_, AppState>, api_key_id: String) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_highwatermark(&api_key_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_highwatermark(
    state: State<'_, AppState>,
    api_key_id: String,
    value: i64,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_highwatermark(&api_key_id, value)
        .map_err(|e| e.to_string())
}

// Data management

#[tauri::command]
pub fn clear_all_data(state: State<'_, AppState>) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.clear_all_data().map_err(|e| e.to_string())?;
    }

    {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.delete_all_keys().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn clear_data_for_key(state: State<'_, AppState>, api_key_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_data_for_key(&api_key_id).map_err(|e| e.to_string())
}

// Helper

#[tauri::command]
pub fn get_existing_dates(
    state: State<'_, AppState>,
    api_key_id: String,
) -> Result<Vec<String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let dates = db.get_existing_dates(&api_key_id).map_err(|e| e.to_string())?;
    Ok(dates.into_iter().collect())
}

// ============================================================================
// Sync Task Queue commands
// ============================================================================

#[tauri::command]
pub fn create_sync_tasks(
    state: State<'_, AppState>,
    api_key_id: String,
    dates: Vec<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_sync_tasks(&api_key_id, &dates)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pending_tasks(state: State<'_, AppState>) -> Result<Vec<SyncTask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_pending_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_pending_tasks_for_key(
    state: State<'_, AppState>,
    api_key_id: String,
) -> Result<Vec<SyncTask>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_pending_tasks_for_key(&api_key_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_task_in_progress(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.mark_task_in_progress(&task_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_task_done(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.mark_task_done(&task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_pending_tasks(state: State<'_, AppState>) -> Result<Vec<(String, i64)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.count_pending_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_all_pending_tasks(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.count_all_pending_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_in_progress_tasks(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reset_in_progress_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_completed_tasks(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_completed_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_sync_tasks_for_key(
    state: State<'_, AppState>,
    api_key_id: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_sync_tasks_for_key(&api_key_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_sales_for_date(
    state: State<'_, AppState>,
    api_key_id: String,
    date: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_sales_for_date(&api_key_id, &date)
        .map_err(|e| e.to_string())
}
