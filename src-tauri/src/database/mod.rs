// Database module - split for better organization
// Main entry point that re-exports all database functionality

mod api_keys;
mod cleanup;
mod migrations;
mod sales;

use rusqlite::Connection;
use std::path::Path;
use thiserror::Error;

// Submodules add impl blocks to Database
// No explicit re-exports needed as methods are on the Database struct

#[allow(dead_code)]
pub const SCHEMA_VERSION: i32 = 3;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Database not initialized")]
    NotInitialized,
}

pub struct Database {
    pub(crate) conn: Connection,
}

impl Database {
    pub fn new(app_data_dir: &Path) -> Result<Self, DatabaseError> {
        let db_path = app_data_dir.join("steam-sales.db");
        let conn = Connection::open(db_path)?;

        let mut db = Database { conn };
        migrations::init_schema(&mut db)?;
        Ok(db)
    }

    /// Initialize and clean up the database.
    /// Should be called on app startup to ensure data integrity.
    /// Returns counts of cleaned records.
    pub fn initialize_and_cleanup(&mut self) -> Result<(usize, usize), DatabaseError> {
        // Ensure schema is up to date
        migrations::init_schema(self)?;

        // Clean up duplicate IDs (shouldn't find any, but check for safety)
        let duplicate_ids_removed = self.cleanup_duplicate_ids()?;

        // Clean up duplicate logical records
        let duplicate_logical_removed = self.cleanup_duplicate_logical_records()?;

        Ok((duplicate_ids_removed, duplicate_logical_removed))
    }
}
