/**
 * SQLite Schema Definitions
 *
 * Multi-tier data architecture:
 * 1. Raw API responses (raw_api_data) - Source of truth
 * 2. Parsed sales records (parsed_sales) - Typed, queryable data
 * 3. Aggregates (daily/app/country_aggregates) - Pre-computed summaries
 * 4. Display cache (display_cache) - Pre-computed UI values
 * 5. Data state (data_state) - Processing flags and crash recovery
 */

/**
 * Schema version - increment to force database rebuild
 */
export const SCHEMA_VERSION = 1;

// Statement type for sqlocal's onInit callback
interface Statement {
  sql: string;
  params: unknown[];
}

// Type for the sql tagged template function from sqlocal's onInit
type OnInitSqlFunction = (queryTemplate: TemplateStringsArray, ...params: unknown[]) => Statement;

/**
 * Initialize all database tables.
 * Called via sqlocal's onInit - returns array of SQL statements (not promises).
 */
export function getSchemaStatements(sql: OnInitSqlFunction): Statement[] {
  return [
    // Schema version tracking
    sql`CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )`,

    // =========================================================================
    // Tier 1: Raw API Data
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS raw_api_data (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      date TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      response_json TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('raw', 'parsing', 'parsed', 'error'))
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_raw_api_data_api_key_id ON raw_api_data(api_key_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_raw_api_data_date ON raw_api_data(date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_raw_api_data_status ON raw_api_data(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_raw_api_data_api_key_date ON raw_api_data(api_key_id, date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_raw_api_data_api_key_status ON raw_api_data(api_key_id, status)`,

    // =========================================================================
    // Tier 2: Parsed Sales Records
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS parsed_sales (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      date TEXT NOT NULL,
      
      -- Core identifiers
      line_item_type TEXT,
      partnerid INTEGER,
      primary_appid INTEGER,
      packageid INTEGER,
      bundleid INTEGER,
      appid INTEGER,
      game_item_id INTEGER,
      
      -- Location & platform
      country_code TEXT NOT NULL,
      platform TEXT,
      currency TEXT,
      
      -- Pricing
      base_price TEXT,
      sale_price TEXT,
      avg_sale_price_usd TEXT,
      package_sale_type TEXT,
      
      -- Units
      gross_units_sold INTEGER DEFAULT 0,
      gross_units_returned INTEGER DEFAULT 0,
      gross_units_activated INTEGER DEFAULT 0,
      net_units_sold INTEGER DEFAULT 0,
      
      -- Revenue (USD)
      gross_sales_usd REAL DEFAULT 0,
      gross_returns_usd REAL DEFAULT 0,
      net_sales_usd REAL DEFAULT 0,
      net_tax_usd REAL DEFAULT 0,
      
      -- Discounts & revenue share
      combined_discount_id INTEGER,
      total_discount_percentage REAL,
      additional_revenue_share_tier INTEGER,
      key_request_id INTEGER,
      viw_grant_partnerid INTEGER,
      
      -- Lookup data (denormalized for query performance)
      app_name TEXT,
      package_name TEXT,
      bundle_name TEXT,
      partner_name TEXT,
      country_name TEXT,
      region TEXT,
      game_item_description TEXT,
      game_item_category TEXT,
      key_request_notes TEXT,
      game_code_description TEXT,
      combined_discount_name TEXT,
      
      -- Legacy computed fields
      app_id INTEGER NOT NULL,
      units_sold INTEGER DEFAULT 0
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_date ON parsed_sales(date)`,
    sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_app_id ON parsed_sales(app_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_country_code ON parsed_sales(country_code)`,
    sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_api_key_id ON parsed_sales(api_key_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_parsed_sales_packageid ON parsed_sales(packageid)`,

    // =========================================================================
    // Tier 3: Aggregates
    // =========================================================================

    // Daily aggregates
    sql`CREATE TABLE IF NOT EXISTS daily_aggregates (
      date TEXT PRIMARY KEY,
      total_revenue REAL NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0
    )`,

    // App aggregates
    sql`CREATE TABLE IF NOT EXISTS app_aggregates (
      app_id INTEGER PRIMARY KEY,
      app_name TEXT NOT NULL,
      total_revenue REAL NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0,
      first_sale_date TEXT,
      last_sale_date TEXT
    )`,

    // Country aggregates
    sql`CREATE TABLE IF NOT EXISTS country_aggregates (
      country_code TEXT PRIMARY KEY,
      total_revenue REAL NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      record_count INTEGER NOT NULL DEFAULT 0
    )`,

    // =========================================================================
    // Tier 4: Display Cache
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS display_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      computed_at INTEGER NOT NULL
    )`,

    // =========================================================================
    // Tier 5: Data State
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS data_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    // =========================================================================
    // API Key Metadata
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      key_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_api_keys_created_at ON api_keys(created_at)`,

    // =========================================================================
    // Sync Task Queue
    // =========================================================================
    sql`CREATE TABLE IF NOT EXISTS sync_tasks (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )`,
    sql`CREATE INDEX IF NOT EXISTS idx_sync_tasks_api_key_id ON sync_tasks(api_key_id)`,
    sql`CREATE INDEX IF NOT EXISTS idx_sync_tasks_status ON sync_tasks(status)`,
    sql`CREATE INDEX IF NOT EXISTS idx_sync_tasks_api_key_status ON sync_tasks(api_key_id, status)`,
  ];
}

// ============================================================================
// TypeScript Interfaces (matching SQL schema)
// ============================================================================

export interface RawApiData {
  id: string;
  api_key_id: string;
  date: string;
  endpoint: string;
  response_json: string;
  fetched_at: number;
  status: 'raw' | 'parsing' | 'parsed' | 'error';
}

export interface ParsedSalesRecord {
  id: string;
  api_key_id: string;
  date: string;
  line_item_type?: string;
  partnerid?: number;
  primary_appid?: number;
  packageid?: number;
  bundleid?: number;
  appid?: number;
  game_item_id?: number;
  country_code: string;
  platform?: string;
  currency?: string;
  base_price?: string;
  sale_price?: string;
  avg_sale_price_usd?: string;
  package_sale_type?: string;
  gross_units_sold: number;
  gross_units_returned: number;
  gross_units_activated: number;
  net_units_sold: number;
  gross_sales_usd: number;
  gross_returns_usd: number;
  net_sales_usd: number;
  net_tax_usd: number;
  combined_discount_id?: number;
  total_discount_percentage?: number;
  additional_revenue_share_tier?: number;
  key_request_id?: number;
  viw_grant_partnerid?: number;
  app_name?: string;
  package_name?: string;
  bundle_name?: string;
  partner_name?: string;
  country_name?: string;
  region?: string;
  game_item_description?: string;
  game_item_category?: string;
  key_request_notes?: string;
  game_code_description?: string;
  combined_discount_name?: string;
  app_id: number;
  units_sold: number;
}

export interface DailyAggregate {
  date: string;
  total_revenue: number;
  total_units: number;
  record_count: number;
}

export interface AppAggregate {
  app_id: number;
  app_name: string;
  total_revenue: number;
  total_units: number;
  record_count: number;
  first_sale_date?: string;
  last_sale_date?: string;
}

export interface CountryAggregate {
  country_code: string;
  total_revenue: number;
  total_units: number;
  record_count: number;
}

export interface DisplayCache {
  key: string;
  value: string;
  computed_at: number;
}

export interface DataState {
  key: string;
  value: string;
}

export interface ApiKeyMetadata {
  id: string;
  display_name?: string;
  key_hash: string;
  created_at: number;
}

export interface SyncTask {
  id: string;
  api_key_id: string;
  date: string;
  status: 'todo' | 'in_progress' | 'done';
  created_at: number;
  completed_at?: number;
}

// ============================================================================
// Database Statistics
// ============================================================================

export interface DatabaseStats {
  rawApiData: number;
  parsedSales: number;
  dailyAggregates: number;
  appAggregates: number;
  countryAggregates: number;
  displayCache: number;
  dataState: number;
  apiKeys: number;
  syncTasks: number;
  totalRows: number;
}

// ============================================================================
// Global Unit Metrics
// ============================================================================

export interface GlobalUnitMetrics {
  grossSold: number;
  grossReturned: number;
  grossActivated: number;
  grandTotal: number;
  totalRecords: number;
  computedAt: number;
}
