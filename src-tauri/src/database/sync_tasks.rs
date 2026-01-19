// Sync tasks database operations

use super::{Database, DatabaseError};
use crate::types::SyncTask;
use rusqlite::params;
use std::time::{SystemTime, UNIX_EPOCH};

/// Create sync task ID from api_key_id and date
pub fn create_task_id(api_key_id: &str, date: &str) -> String {
    format!("{}|{}", api_key_id, date)
}

/// Get current timestamp in milliseconds
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

impl Database {
    /// Create TODO entries for changed dates.
    /// Deletes existing sales data for these dates and replaces any existing sync tasks.
    pub fn create_sync_tasks(&self, api_key_id: &str, dates: &[String]) -> Result<(), DatabaseError> {
        let now = now_ms();

        for date in dates {
            let task_id = create_task_id(api_key_id, date);

            // Delete existing sales data for this date and api key
            self.conn.execute(
                "DELETE FROM sales WHERE api_key_id = ? AND date = ?",
                params![api_key_id, date],
            )?;

            // Insert or replace sync task as 'todo'
            self.conn.execute(
                "INSERT OR REPLACE INTO sync_tasks (id, api_key_id, date, status, created_at, completed_at)
                 VALUES (?, ?, ?, 'todo', ?, NULL)",
                params![task_id, api_key_id, date, now],
            )?;
        }

        Ok(())
    }

    /// Get all pending tasks (status = 'todo' or 'in_progress')
    pub fn get_pending_tasks(&self) -> Result<Vec<SyncTask>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, api_key_id, date, status, created_at, completed_at
             FROM sync_tasks
             WHERE status IN ('todo', 'in_progress')
             ORDER BY date ASC",
        )?;

        let tasks = stmt
            .query_map([], |row| {
                Ok(SyncTask {
                    id: row.get(0)?,
                    api_key_id: row.get(1)?,
                    date: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    completed_at: row.get(5).ok(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(tasks)
    }

    /// Get pending tasks for a specific API key
    pub fn get_pending_tasks_for_key(&self, api_key_id: &str) -> Result<Vec<SyncTask>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, api_key_id, date, status, created_at, completed_at
             FROM sync_tasks
             WHERE api_key_id = ? AND status IN ('todo', 'in_progress')
             ORDER BY date ASC",
        )?;

        let tasks = stmt
            .query_map([api_key_id], |row| {
                Ok(SyncTask {
                    id: row.get(0)?,
                    api_key_id: row.get(1)?,
                    date: row.get(2)?,
                    status: row.get(3)?,
                    created_at: row.get(4)?,
                    completed_at: row.get(5).ok(),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(tasks)
    }

    /// Mark a task as in_progress (for crash recovery tracking)
    pub fn mark_task_in_progress(&self, task_id: &str) -> Result<(), DatabaseError> {
        self.conn.execute(
            "UPDATE sync_tasks SET status = 'in_progress' WHERE id = ?",
            params![task_id],
        )?;
        Ok(())
    }

    /// Mark a task as done
    pub fn mark_task_done(&self, task_id: &str) -> Result<(), DatabaseError> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE sync_tasks SET status = 'done', completed_at = ? WHERE id = ?",
            params![now, task_id],
        )?;
        Ok(())
    }

    /// Count pending tasks per API key
    pub fn count_pending_tasks(&self) -> Result<Vec<(String, i64)>, DatabaseError> {
        let mut stmt = self.conn.prepare(
            "SELECT api_key_id, COUNT(*) as count
             FROM sync_tasks
             WHERE status IN ('todo', 'in_progress')
             GROUP BY api_key_id",
        )?;

        let counts = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(counts)
    }

    /// Get total count of pending tasks
    pub fn count_all_pending_tasks(&self) -> Result<i64, DatabaseError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sync_tasks WHERE status IN ('todo', 'in_progress')",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Reset all in_progress tasks to todo (for crash recovery)
    pub fn reset_in_progress_tasks(&self) -> Result<i64, DatabaseError> {
        let count = self.conn.execute(
            "UPDATE sync_tasks SET status = 'todo' WHERE status = 'in_progress'",
            [],
        )?;
        Ok(count as i64)
    }

    /// Clear all completed tasks (cleanup)
    pub fn clear_completed_tasks(&self) -> Result<(), DatabaseError> {
        self.conn.execute(
            "DELETE FROM sync_tasks WHERE status = 'done'",
            [],
        )?;
        Ok(())
    }

    /// Delete all sync tasks for a specific API key
    pub fn delete_sync_tasks_for_key(&self, api_key_id: &str) -> Result<(), DatabaseError> {
        self.conn.execute(
            "DELETE FROM sync_tasks WHERE api_key_id = ?",
            params![api_key_id],
        )?;
        Ok(())
    }

    /// Clear sales data for a specific date and API key
    pub fn clear_sales_for_date(&self, api_key_id: &str, date: &str) -> Result<(), DatabaseError> {
        self.conn.execute(
            "DELETE FROM sales WHERE api_key_id = ? AND date = ?",
            params![api_key_id, date],
        )?;
        Ok(())
    }
}
