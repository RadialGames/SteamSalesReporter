/**
 * SQLite Database using sqlocal (SQLite WASM)
 *
 * Multi-tier data architecture:
 * 1. Raw API responses (raw_api_data) - Source of truth
 * 2. Parsed sales records (parsed_sales) - Typed, queryable data
 * 3. Aggregates (daily/app/country_aggregates) - Pre-computed summaries
 * 4. Display cache (display_cache) - Pre-computed UI values
 * 5. Data state (data_state) - Processing flags and crash recovery
 *
 * Uses sqlocal for SQLite WASM with OPFS persistence.
 * Works in both browser and Tauri (both use WebView).
 */

import { SQLocal } from 'sqlocal';
import { getSchemaStatements, SCHEMA_VERSION, type DatabaseStats } from './sqlite-schema';

// Re-export types from schema
export type * from './sqlite-schema';
export {
  type RawApiData,
  type ParsedSalesRecord,
  type DailyAggregate,
  type AppAggregate,
  type CountryAggregate,
  type DisplayCache,
  type DataState,
  type ApiKeyMetadata,
  type SyncTask,
  type GlobalUnitMetrics,
} from './sqlite-schema';

// ============================================================================
// Database Instance
// ============================================================================

/**
 * SQLite database instance.
 * Uses OPFS for persistent storage in the browser.
 */
export const db = new SQLocal({
  databasePath: `steam-sales-v${SCHEMA_VERSION}.db`,
  onInit: (sql) => getSchemaStatements(sql),
});

/**
 * SQL tagged template function for queries.
 * Usage: const results = await sql`SELECT * FROM table WHERE id = ${id}`;
 */
export const { sql } = db;

// ============================================================================
// Database Initialization
// ============================================================================

/** Progress callback for database operations */
export type DbProgressCallback = (message: string, progress: number) => void;

/**
 * Ensure performance indexes exist (for existing databases)
 * These covering indexes significantly speed up aggregate computations
 */
async function ensurePerformanceIndexes(): Promise<void> {
  // Create covering indexes for aggregate queries if they don't exist
  // These indexes include the aggregated columns to avoid table lookups
  await sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_date_covering ON parsed_sales(date, gross_sales_usd, units_sold)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_app_id_covering ON parsed_sales(app_id, gross_sales_usd, units_sold, date, app_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_country_covering ON parsed_sales(country_code, gross_sales_usd, units_sold)`;
}

/**
 * Ensure all required tables exist (for existing databases that might have been created before all tables were added)
 */
async function ensureTablesExist(): Promise<void> {
  // The api_keys table should be created by onInit, but ensure it exists for older databases
  await sql`CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    key_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at)`;
}

/**
 * Initialize the database - should be called on app startup.
 * The database is automatically initialized by sqlocal on first query,
 * but this provides a hook for progress reporting.
 */
export async function initializeDatabase(
  onProgress?: DbProgressCallback
): Promise<{ cleanedRecords: number; databaseWiped: boolean }> {
  onProgress?.('Initializing database...', 0);

  try {
    // Trigger initialization by running a simple query
    await sql`SELECT 1`;
    
    // Ensure all tables exist (for existing databases)
    onProgress?.('Ensuring tables exist...', 40);
    await ensureTablesExist();
    
    // Ensure performance indexes exist (for existing databases)
    onProgress?.('Ensuring indexes exist...', 50);
    await ensurePerformanceIndexes();
    
    onProgress?.('Database ready', 100);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    // Try to recover by deleting and recreating
    onProgress?.('Recreating database...', 50);
    try {
      await db.deleteDatabaseFile();
      await sql`SELECT 1`; // This will recreate via onInit
      onProgress?.('Database recreated', 100);
    } catch (recreateError) {
      console.error('Failed to recreate database:', recreateError);
      throw recreateError;
    }
  }

  return {
    cleanedRecords: 0,
    databaseWiped: false,
  };
}

// ============================================================================
// Wipe All Data
// ============================================================================

/**
 * Wipe all sales data from the database.
 * Preserves API keys - only clears sales data, aggregates, and cache.
 */
export async function wipeAllData(): Promise<void> {
  await sql`DELETE FROM raw_api_data`;
  await sql`DELETE FROM parsed_sales`;
  await sql`DELETE FROM daily_aggregates`;
  await sql`DELETE FROM app_aggregates`;
  await sql`DELETE FROM country_aggregates`;
  await sql`DELETE FROM display_cache`;
  await sql`DELETE FROM data_state`;
  await sql`DELETE FROM sync_tasks`;
  // Note: api_keys table is NOT cleared - API keys are preserved
}

// ============================================================================
// Wipe Processed Data Only (keeps raw data for reprocessing)
// ============================================================================

/**
 * Wipe processed data while keeping raw API responses.
 * This allows reprocessing of data without re-fetching from Steam.
 * Resets raw data status to 'raw' so it will be reprocessed on next refresh.
 */
export async function wipeProcessedData(): Promise<void> {
  // Clear processed data (tiers 2-5) but keep raw (tier 1)
  await sql`DELETE FROM parsed_sales`;
  await sql`DELETE FROM daily_aggregates`;
  await sql`DELETE FROM app_aggregates`;
  await sql`DELETE FROM country_aggregates`;
  await sql`DELETE FROM display_cache`;
  await sql`DELETE FROM data_state`;
  await sql`DELETE FROM sync_tasks`;
  // Reset raw data status to 'raw' for reprocessing
  await sql`UPDATE raw_api_data SET status = 'raw'`;
}

// ============================================================================
// Database Statistics
// ============================================================================

/**
 * Get row counts for all database tables
 */
export async function getDatabaseStats(): Promise<DatabaseStats> {
  const [
    [rawApiData],
    [parsedSales],
    [dailyAggregates],
    [appAggregates],
    [countryAggregates],
    [displayCache],
    [dataState],
    [apiKeys],
    [syncTasks],
  ] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM raw_api_data`,
    sql`SELECT COUNT(*) as count FROM parsed_sales`,
    sql`SELECT COUNT(*) as count FROM daily_aggregates`,
    sql`SELECT COUNT(*) as count FROM app_aggregates`,
    sql`SELECT COUNT(*) as count FROM country_aggregates`,
    sql`SELECT COUNT(*) as count FROM display_cache`,
    sql`SELECT COUNT(*) as count FROM data_state`,
    sql`SELECT COUNT(*) as count FROM api_keys`,
    sql`SELECT COUNT(*) as count FROM sync_tasks`,
  ]);

  const counts = {
    rawApiData: (rawApiData as { count: number }).count,
    parsedSales: (parsedSales as { count: number }).count,
    dailyAggregates: (dailyAggregates as { count: number }).count,
    appAggregates: (appAggregates as { count: number }).count,
    countryAggregates: (countryAggregates as { count: number }).count,
    displayCache: (displayCache as { count: number }).count,
    dataState: (dataState as { count: number }).count,
    apiKeys: (apiKeys as { count: number }).count,
    syncTasks: (syncTasks as { count: number }).count,
  };

  return {
    ...counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Execute multiple statements in a batch (atomic transaction).
 * If any statement fails, all changes are rolled back.
 */
export const { batch } = db;

/**
 * Execute multiple statements in a transaction with custom logic.
 */
export const { transaction } = db;

// ============================================================================
// Database Export (for CLI debugging)
// ============================================================================

/**
 * Export the database file as a File object.
 * This can be used to save the database to the filesystem for CLI debugging.
 */
export async function exportDatabaseToFile(): Promise<File> {
  return await db.getDatabaseFile();
}

/**
 * Trigger a browser download of the database file.
 * Works in both browser and Tauri webview.
 *
 * @param filename - The filename for the downloaded file (default: steam-sales-debug.db)
 */
export async function downloadDatabaseFile(filename = 'steam-sales-debug.db'): Promise<void> {
  const file = await exportDatabaseToFile();
  const url = URL.createObjectURL(file);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}
