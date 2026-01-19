use crate::types::{ApiKeyInfo, Filters, SalesRecord};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::Path;
use thiserror::Error;

#[allow(dead_code)]
const SCHEMA_VERSION: i32 = 2;

#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Database not initialized")]
    NotInitialized,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(app_data_dir: &Path) -> Result<Self, DatabaseError> {
        let db_path = app_data_dir.join("steam-sales.db");
        let conn = Connection::open(db_path)?;

        let mut db = Database { conn };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&mut self) -> Result<(), DatabaseError> {
        // Create sync_meta table first (needed for schema versioning)
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        let current_version = self.get_schema_version();

        if current_version < 1 {
            // Version 1: Original schema
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS sales (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    app_id INTEGER NOT NULL,
                    app_name TEXT,
                    package_id INTEGER NOT NULL,
                    country_code TEXT NOT NULL,
                    units_sold INTEGER NOT NULL,
                    gross_revenue REAL NOT NULL,
                    net_revenue REAL NOT NULL,
                    currency TEXT NOT NULL,
                    UNIQUE(date, app_id, package_id, country_code)
                )",
                [],
            )?;

            self.conn
                .execute("CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)", [])?;
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sales_app_id ON sales(app_id)",
                [],
            )?;
            self.conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_sales_country ON sales(country_code)",
                [],
            )?;

            self.set_schema_version(1);
        }

        if current_version < 2 {
            // Version 2: Multi-API key support
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS api_keys (
                    id TEXT PRIMARY KEY,
                    display_name TEXT,
                    key_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )",
                [],
            )?;

            // Check if api_key_id column exists
            let has_api_key_id = self.column_exists("sales", "api_key_id")?;

            if !has_api_key_id {
                // Add api_key_id column with default value 'legacy' for existing data
                self.conn.execute(
                    "ALTER TABLE sales ADD COLUMN api_key_id TEXT NOT NULL DEFAULT 'legacy'",
                    [],
                )?;

                // Recreate table with new unique constraint
                self.conn.execute(
                    "CREATE TABLE IF NOT EXISTS sales_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        date TEXT NOT NULL,
                        app_id INTEGER NOT NULL,
                        app_name TEXT,
                        package_id INTEGER NOT NULL,
                        country_code TEXT NOT NULL,
                        units_sold INTEGER NOT NULL,
                        gross_revenue REAL NOT NULL,
                        net_revenue REAL NOT NULL,
                        currency TEXT NOT NULL,
                        api_key_id TEXT NOT NULL DEFAULT 'legacy',
                        UNIQUE(date, app_id, package_id, country_code, api_key_id)
                    )",
                    [],
                )?;

                // Copy data
                self.conn.execute(
                    "INSERT INTO sales_new (id, date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id)
                     SELECT id, date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id FROM sales",
                    [],
                )?;

                // Drop old table and rename new one
                self.conn.execute("DROP TABLE sales", [])?;
                self.conn
                    .execute("ALTER TABLE sales_new RENAME TO sales", [])?;

                // Recreate indexes
                self.conn
                    .execute("CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)", [])?;
                self.conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_sales_app_id ON sales(app_id)",
                    [],
                )?;
                self.conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_sales_country ON sales(country_code)",
                    [],
                )?;
                self.conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_sales_api_key_id ON sales(api_key_id)",
                    [],
                )?;
            }

            self.set_schema_version(2);
        }

        Ok(())
    }

    fn column_exists(&self, table: &str, column: &str) -> Result<bool, DatabaseError> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({})", table))?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(columns.contains(&column.to_string()))
    }

    fn get_schema_version(&self) -> i32 {
        self.conn
            .query_row(
                "SELECT value FROM sync_meta WHERE key = ?",
                ["schema_version"],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    }

    fn set_schema_version(&self, version: i32) {
        let _ = self.conn.execute(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
            params!["schema_version", version.to_string()],
        );
    }

    // API Key management
    pub fn get_all_api_keys(&self) -> Result<Vec<ApiKeyInfo>, DatabaseError> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, display_name, key_hash, created_at FROM api_keys ORDER BY created_at DESC")?;

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

    // Sales data operations
    pub fn get_sales(&self, filters: &Filters) -> Result<Vec<SalesRecord>, DatabaseError> {
        let mut query = String::from(
            "SELECT id, date, app_id, app_name, package_id, country_code, units_sold, 
                    gross_revenue, net_revenue, currency, api_key_id 
             FROM sales WHERE 1=1",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref start_date) = filters.start_date {
            query.push_str(" AND date >= ?");
            params_vec.push(Box::new(start_date.clone()));
        }

        if let Some(ref end_date) = filters.end_date {
            query.push_str(" AND date <= ?");
            params_vec.push(Box::new(end_date.clone()));
        }

        if let Some(app_id) = filters.app_id {
            query.push_str(" AND app_id = ?");
            params_vec.push(Box::new(app_id));
        }

        if let Some(ref country_code) = filters.country_code {
            query.push_str(" AND country_code = ?");
            params_vec.push(Box::new(country_code.clone()));
        }

        if let Some(ref api_key_id) = filters.api_key_id {
            query.push_str(" AND api_key_id = ?");
            params_vec.push(Box::new(api_key_id.clone()));
        }

        query.push_str(" ORDER BY date DESC");

        let mut stmt = self.conn.prepare(&query)?;
        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let records = stmt
            .query_map(params_refs.as_slice(), |row| {
                let app_id: i64 = row.get(2)?;
                let units_sold: i64 = row.get(6)?;

                Ok(SalesRecord {
                    id: Some(row.get(0)?),
                    date: row.get(1)?,
                    app_id,
                    app_name: row.get(3)?,
                    country_code: row.get(5)?,
                    units_sold,
                    gross_sales_usd: Some(row.get(7)?),
                    net_sales_usd: Some(row.get(8)?),
                    currency: Some(row.get(9)?),
                    api_key_id: row.get(10)?,
                    // Set required fields
                    line_item_type: "Package".to_string(),
                    // Optional fields default to None
                    partnerid: None,
                    primary_appid: Some(app_id),
                    packageid: Some(row.get(4)?),
                    bundleid: None,
                    appid: None,
                    game_item_id: None,
                    platform: None,
                    base_price: None,
                    sale_price: None,
                    avg_sale_price_usd: None,
                    package_sale_type: None,
                    gross_units_sold: Some(units_sold),
                    gross_units_returned: None,
                    gross_units_activated: None,
                    net_units_sold: Some(units_sold),
                    gross_returns_usd: None,
                    net_tax_usd: None,
                    combined_discount_id: None,
                    total_discount_percentage: None,
                    additional_revenue_share_tier: None,
                    key_request_id: None,
                    viw_grant_partnerid: None,
                    package_name: None,
                    bundle_name: None,
                    partner_name: None,
                    country_name: None,
                    region: None,
                    game_item_description: None,
                    game_item_category: None,
                    key_request_notes: None,
                    game_code_description: None,
                    combined_discount_name: None,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(records)
    }

    pub fn save_sales(&self, data: &[SalesRecord], api_key_id: &str) -> Result<(), DatabaseError> {
        let tx = self.conn.unchecked_transaction()?;

        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO sales (date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            for record in data {
                stmt.execute(params![
                    record.date,
                    record.app_id,
                    record.app_name,
                    record.packageid.unwrap_or(0),
                    record.country_code,
                    record.units_sold,
                    record.gross_sales_usd.unwrap_or(0.0),
                    record.net_sales_usd.unwrap_or(0.0),
                    record.currency.as_deref().unwrap_or("USD"),
                    api_key_id
                ])?;
            }
        }

        tx.commit()?;
        Ok(())
    }

    // Highwatermark operations
    pub fn get_highwatermark(&self, api_key_id: &str) -> Result<i64, DatabaseError> {
        let key = format!("highwatermark:{}", api_key_id);
        let result = self.conn.query_row(
            "SELECT value FROM sync_meta WHERE key = ?",
            params![key],
            |row| row.get::<_, String>(0),
        );

        match result {
            Ok(value) => Ok(value.parse().unwrap_or(0)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(0),
            Err(e) => Err(DatabaseError::Sqlite(e)),
        }
    }

    pub fn set_highwatermark(&self, api_key_id: &str, value: i64) -> Result<(), DatabaseError> {
        let key = format!("highwatermark:{}", api_key_id);
        self.conn.execute(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
            params![key, value.to_string()],
        )?;
        Ok(())
    }

    // Data management
    pub fn clear_all_data(&self) -> Result<(), DatabaseError> {
        self.conn.execute("DELETE FROM sales", [])?;
        self.conn.execute("DELETE FROM api_keys", [])?;
        self.conn
            .execute("DELETE FROM sync_meta WHERE key LIKE 'highwatermark:%'", [])?;
        Ok(())
    }

    pub fn clear_data_for_key(&self, api_key_id: &str) -> Result<(), DatabaseError> {
        self.conn
            .execute("DELETE FROM sales WHERE api_key_id = ?", params![api_key_id])?;
        let key = format!("highwatermark:{}", api_key_id);
        self.conn
            .execute("DELETE FROM sync_meta WHERE key = ?", params![key])?;
        Ok(())
    }

    pub fn get_existing_dates(&self, api_key_id: &str) -> Result<HashSet<String>, DatabaseError> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT date FROM sales WHERE api_key_id = ?")?;

        let dates: HashSet<String> = stmt
            .query_map(params![api_key_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(dates)
    }
}
