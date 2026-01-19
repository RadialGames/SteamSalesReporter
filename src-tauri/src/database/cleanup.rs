// Database cleanup and data management operations

use super::{Database, DatabaseError};
use rusqlite::params;

impl Database {
    /// Clear all data from the database
    pub fn clear_all_data(&self) -> Result<(), DatabaseError> {
        self.conn.execute("DELETE FROM sales", [])?;
        self.conn.execute("DELETE FROM api_keys", [])?;
        self.conn
            .execute("DELETE FROM sync_meta WHERE key LIKE 'highwatermark:%'", [])?;
        Ok(())
    }

    /// Clear data for a specific API key
    pub fn clear_data_for_key(&self, api_key_id: &str) -> Result<(), DatabaseError> {
        self.conn
            .execute("DELETE FROM sales WHERE api_key_id = ?", params![api_key_id])?;
        let key = format!("highwatermark:{}", api_key_id);
        self.conn
            .execute("DELETE FROM sync_meta WHERE key = ?", params![key])?;
        Ok(())
    }

    /// Clean up duplicate IDs in the database.
    /// In SQLite, PRIMARY KEY should be unique, but this function ensures
    /// that if any duplicates exist, we keep only the first occurrence of each ID.
    /// Returns the number of duplicate records removed.
    pub fn cleanup_duplicate_ids(&self) -> Result<usize, DatabaseError> {
        // Find duplicate IDs (shouldn't happen with PRIMARY KEY, but check anyway)
        let mut stmt = self.conn.prepare(
            "SELECT id, COUNT(*) as cnt 
             FROM sales 
             GROUP BY id 
             HAVING cnt > 1",
        )?;

        let duplicate_ids: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();

        if duplicate_ids.is_empty() {
            return Ok(0);
        }

        // For each duplicate ID, keep the first one (lowest rowid) and delete the rest
        let mut deleted_count = 0;
        for id in duplicate_ids {
            // Delete all but the first occurrence (lowest rowid)
            let deleted = self.conn.execute(
                "DELETE FROM sales 
                 WHERE id = ? 
                 AND rowid NOT IN (
                     SELECT MIN(rowid) FROM sales WHERE id = ?
                 )",
                params![id, id],
            )?;
            deleted_count += deleted;
        }

        Ok(deleted_count)
    }

    /// Clean up duplicate logical records (same business key).
    /// Finds records with the same date+app_id+package_id+country_code+api_key_id
    /// and keeps only one (the first occurrence by rowid).
    /// Returns the number of duplicate records removed.
    pub fn cleanup_duplicate_logical_records(&self) -> Result<usize, DatabaseError> {
        // Find duplicate logical records
        // Keep the one with the lowest rowid (first inserted)
        let deleted = self.conn.execute(
            "DELETE FROM sales 
             WHERE rowid NOT IN (
                 SELECT MIN(rowid) 
                 FROM sales 
                 GROUP BY date, app_id, package_id, country_code, api_key_id
             )",
            [],
        )?;

        Ok(deleted)
    }
}
