// API key database operations

use super::{Database, DatabaseError};
use crate::types::ApiKeyInfo;
use rusqlite::params;

impl Database {
    pub fn get_all_api_keys(&self) -> Result<Vec<ApiKeyInfo>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, display_name, key_hash, created_at FROM api_keys ORDER BY created_at DESC",
        )?;

        let keys = stmt
            .query_map([], |row| {
                Ok(ApiKeyInfo {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    key_hash: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(keys)
    }

    pub fn add_api_key_info(&self, info: &ApiKeyInfo) -> Result<(), DatabaseError> {
        self.conn.execute(
            "INSERT INTO api_keys (id, display_name, key_hash, created_at) VALUES (?, ?, ?, ?)",
            params![info.id, info.display_name, info.key_hash, info.created_at],
        )?;
        Ok(())
    }

    pub fn update_api_key_name(&self, id: &str, display_name: &str) -> Result<(), DatabaseError> {
        self.conn.execute(
            "UPDATE api_keys SET display_name = ? WHERE id = ?",
            params![display_name, id],
        )?;
        Ok(())
    }

    pub fn delete_api_key_info(&self, id: &str) -> Result<(), DatabaseError> {
        self.conn
            .execute("DELETE FROM api_keys WHERE id = ?", params![id])?;
        Ok(())
    }
}
