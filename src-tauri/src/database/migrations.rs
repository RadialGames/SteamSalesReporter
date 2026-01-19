// Database schema migrations

use super::{Database, DatabaseError};
use rusqlite::params;

pub fn init_schema(db: &mut Database) -> Result<(), DatabaseError> {
    // Create sync_meta table first (needed for schema versioning)
    db.conn.execute(
        "CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    let current_version = get_schema_version(db);

    if current_version < 1 {
        migrate_to_v1(db)?;
    }

    if current_version < 2 {
        migrate_to_v2(db)?;
    }

    if current_version < 3 {
        migrate_to_v3(db)?;
    }

    Ok(())
}

fn migrate_to_v1(db: &Database) -> Result<(), DatabaseError> {
    // Version 1: Original schema
    db.conn.execute(
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

    create_standard_indexes(db)?;
    set_schema_version(db, 1);
    Ok(())
}

fn migrate_to_v2(db: &Database) -> Result<(), DatabaseError> {
    // Version 2: Multi-API key support
    db.conn.execute(
        "CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            display_name TEXT,
            key_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Check if api_key_id column exists
    let has_api_key_id = column_exists(db, "sales", "api_key_id")?;

    if !has_api_key_id {
        // Add api_key_id column with default value 'legacy' for existing data
        db.conn.execute(
            "ALTER TABLE sales ADD COLUMN api_key_id TEXT NOT NULL DEFAULT 'legacy'",
            [],
        )?;

        // Recreate table with new unique constraint
        db.conn.execute(
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
        db.conn.execute(
            "INSERT INTO sales_new (id, date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id)
             SELECT id, date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id FROM sales",
            [],
        )?;

        // Drop old table and rename new one
        db.conn.execute("DROP TABLE sales", [])?;
        db.conn.execute("ALTER TABLE sales_new RENAME TO sales", [])?;

        // Recreate indexes
        create_standard_indexes(db)?;
        db.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sales_api_key_id ON sales(api_key_id)",
            [],
        )?;
    }

    set_schema_version(db, 2);
    Ok(())
}

fn migrate_to_v3(db: &Database) -> Result<(), DatabaseError> {
    // Version 3: Use unique key hash as primary key instead of auto-increment
    db.conn.execute(
        "CREATE TABLE IF NOT EXISTS sales_v3 (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            app_id INTEGER NOT NULL,
            app_name TEXT,
            package_id INTEGER NOT NULL,
            country_code TEXT NOT NULL,
            units_sold INTEGER NOT NULL,
            gross_revenue REAL NOT NULL,
            net_revenue REAL NOT NULL,
            currency TEXT NOT NULL,
            api_key_id TEXT NOT NULL,
            line_item_type TEXT,
            partnerid INTEGER,
            primary_appid INTEGER,
            bundleid INTEGER,
            appid INTEGER,
            game_item_id INTEGER,
            platform TEXT,
            base_price TEXT,
            sale_price TEXT,
            avg_sale_price_usd TEXT,
            package_sale_type TEXT,
            gross_units_sold INTEGER,
            gross_units_returned INTEGER,
            gross_units_activated INTEGER,
            net_units_sold INTEGER,
            gross_sales_usd REAL,
            gross_returns_usd REAL,
            net_sales_usd REAL,
            net_tax_usd REAL,
            combined_discount_id INTEGER,
            total_discount_percentage REAL,
            additional_revenue_share_tier INTEGER,
            key_request_id INTEGER,
            viw_grant_partnerid INTEGER
        )",
        [],
    )?;

    // Copy data from old table, generating unique keys for existing records
    db.conn.execute(
        "INSERT INTO sales_v3 (id, date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, api_key_id)
         SELECT 
            date || '|' || app_id || '|' || package_id || '|' || country_code || '|' || COALESCE(api_key_id, 'legacy') as id,
            date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency, COALESCE(api_key_id, 'legacy')
         FROM sales",
        [],
    )?;

    // Drop old table and rename new one
    db.conn.execute("DROP TABLE sales", [])?;
    db.conn.execute("ALTER TABLE sales_v3 RENAME TO sales", [])?;

    // Recreate indexes
    create_standard_indexes(db)?;
    db.conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sales_api_key_id ON sales(api_key_id)",
        [],
    )?;

    set_schema_version(db, 3);
    Ok(())
}

/// Create standard indexes on the sales table
fn create_standard_indexes(db: &Database) -> Result<(), DatabaseError> {
    let indexes = [
        "CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)",
        "CREATE INDEX IF NOT EXISTS idx_sales_app_id ON sales(app_id)",
        "CREATE INDEX IF NOT EXISTS idx_sales_country ON sales(country_code)",
    ];

    for sql in indexes {
        db.conn.execute(sql, [])?;
    }

    Ok(())
}

fn column_exists(db: &Database, table: &str, column: &str) -> Result<bool, DatabaseError> {
    let mut stmt = db.conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(columns.contains(&column.to_string()))
}

fn get_schema_version(db: &Database) -> i32 {
    db.conn
        .query_row(
            "SELECT value FROM sync_meta WHERE key = ?",
            ["schema_version"],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn set_schema_version(db: &Database, version: i32) {
    let _ = db.conn.execute(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)",
        params!["schema_version", version.to_string()],
    );
}
