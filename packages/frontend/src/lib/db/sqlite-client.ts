// SQLite client for querying the CLI tool's database
// Uses sql.js (SQLite compiled to WebAssembly)

import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import type { SalesDataRow } from './schema.js';
import { parseUsd as parseUsdHelper, parseIntSafe as parseIntSafeHelper } from './schema.js';

// Bundle WASM with the app (required for Tauri; WebView blocks external CDN fetch)
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

// Initialize sql.js
export async function initSqlite(): Promise<void> {
  if (SQL) return;

  SQL = await initSqlJs({
    locateFile: (file: string) => (file.endsWith('.wasm') ? sqlWasmUrl : file),
  });
}

// Load database from file
export async function loadDatabase(file: File | ArrayBuffer | Uint8Array): Promise<void> {
  await initSqlite();
  if (!SQL) throw new Error('SQL.js not initialized');

  let buffer: Uint8Array;
  
  if (file instanceof File) {
    const arrayBuffer = await file.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
  } else if (file instanceof ArrayBuffer) {
    buffer = new Uint8Array(file);
  } else {
    buffer = file;
  }

  db = new SQL.Database(buffer);
}

// Check if database is loaded
export function isDatabaseLoaded(): boolean {
  return db !== null;
}

// Get database instance (for advanced queries)
export function getDatabase(): Database | null {
  return db;
}

// Execute a query and return results
function query<T = any>(sql: string, params: any[] = []): T[] {
  if (!db) throw new Error('Database not loaded. Please load a database file first.');
  
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  
  return results;
}

// Execute a query that returns a single value
function queryValue<T = any>(sql: string, params: any[] = []): T | null {
  if (!db) throw new Error('Database not loaded. Please load a database file first.');
  
  const stmt = db.prepare(sql);
  if (params.length > 0) {
    stmt.bind(params);
  }
  
  if (stmt.step()) {
    const result = stmt.getAsObject();
    stmt.free();
    // Return the first value from the object
    const values = Object.values(result);
    return (values[0] ?? null) as T;
  }
  
  stmt.free();
  return null;
}

// Get table names in the database
export function getTableNames(): string[] {
  if (!db) throw new Error('Database not loaded. Please load a database file first.');
  
  const tables = query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  );
  return tables.map(t => t.name);
}

// Get column names for a table
export function getColumnNames(tableName: string): string[] {
  if (!db) throw new Error('Database not loaded. Please load a database file first.');
  
  const columns = query<{ name: string }>(
    `PRAGMA table_info(${tableName})`
  );
  return columns.map(c => c.name);
}

// ==================== Sales Data Queries ====================

export interface SalesQueryParams {
  startDate?: string;
  endDate?: string;
  appIds?: number[];
  countryCode?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'date' | 'revenue' | 'units';
  sortOrder?: 'asc' | 'desc';
}

export interface SalesRecord {
  id: number;
  date: string;
  lineItemType: string;
  appId: number | null;
  appName: string | null;
  packageId: number | null;
  packageName: string | null;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  platform: string | null;
  currency: string | null;
  grossUnitsSold: number;
  grossUnitsReturned: number;
  netUnitsSold: number;
  grossSalesUsd: number;
  netSalesUsd: number;
  discountPercentage: number | null;
}

export interface SalesResponse {
  records: SalesRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export function getSales(params: SalesQueryParams = {}): SalesResponse {
  const {
    startDate,
    endDate,
    appIds,
    countryCode,
    limit = 1000,
    offset = 0,
    sortBy = 'date',
    sortOrder = 'desc',
  } = params;

  // Build WHERE clause
  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (startDate) {
    conditions.push(`date >= ?`);
    queryParams.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= ?`);
    queryParams.push(endDate);
  }
  if (appIds && appIds.length > 0) {
    const placeholders = appIds.map(() => '?').join(',');
    conditions.push(`appid IN (${placeholders})`);
    queryParams.push(...appIds);
  }
  if (countryCode) {
    conditions.push(`country_code = ?`);
    queryParams.push(countryCode);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build ORDER BY
  let orderBy: string;
  switch (sortBy) {
    case 'revenue':
      orderBy = `CAST(gross_sales_usd AS REAL) ${sortOrder.toUpperCase()}`;
      break;
    case 'units':
      orderBy = `net_units_sold ${sortOrder.toUpperCase()}`;
      break;
    default:
      orderBy = `date ${sortOrder.toUpperCase()}`;
  }

  // Get total count
  const countResult = queryValue<number>(
    `SELECT COUNT(*) FROM sales_data ${whereClause}`,
    queryParams
  );
  const total = countResult ?? 0;

  // Get records
  const records = query<SalesDataRow>(
    `SELECT * FROM sales_data ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...queryParams, limit, offset]
  );

  // Transform to SalesRecord format
  const transformedRecords: SalesRecord[] = records.map((row, index) => ({
    id: offset + index + 1, // Generate ID since CLI DB may not have one
    date: row.date,
    lineItemType: row.line_item_type || '',
    appId: row.appid ?? null,
    appName: null, // CLI tool may not have app names in sales_data
    packageId: row.packageid ?? null,
    packageName: null,
    countryCode: row.country_code ?? null,
    countryName: null,
    region: null,
    platform: row.platform ?? null,
    currency: row.currency ?? null,
    grossUnitsSold: parseIntSafeHelper(row.gross_units_sold),
    grossUnitsReturned: parseIntSafeHelper(row.gross_units_returned),
    netUnitsSold: parseIntSafeHelper(row.net_units_sold),
    grossSalesUsd: parseUsdHelper(row.gross_sales_usd),
    netSalesUsd: parseUsdHelper(row.net_sales_usd),
    discountPercentage: row.total_discount_percentage ?? null,
  }));

  return {
    records: transformedRecords,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + transformedRecords.length < total,
    },
  };
}

// ==================== Stats ====================

export interface DashboardStats {
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  appCount: number;
  countryCount: number;
  dateRange: { min: string; max: string } | null;
}

export function getStats(params: SalesQueryParams = {}): DashboardStats {
  const { startDate, endDate } = params;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (startDate) {
    conditions.push(`date >= ?`);
    queryParams.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= ?`);
    queryParams.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const stats = query<{
    totalRevenue: number;
    totalUnits: number;
    recordCount: number;
    appCount: number;
    countryCount: number;
    minDate: string;
    maxDate: string;
  }>(
    `SELECT 
      COALESCE(SUM(CAST(gross_sales_usd AS REAL)), 0) as totalRevenue,
      COALESCE(SUM(net_units_sold), 0) as totalUnits,
      COUNT(*) as recordCount,
      COUNT(DISTINCT appid) as appCount,
      COUNT(DISTINCT country_code) as countryCount,
      MIN(date) as minDate,
      MAX(date) as maxDate
    FROM sales_data ${whereClause}`,
    queryParams
  )[0];

  return {
    totalRevenue: stats?.totalRevenue ?? 0,
    totalUnits: stats?.totalUnits ?? 0,
    recordCount: stats?.recordCount ?? 0,
    appCount: stats?.appCount ?? 0,
    countryCount: stats?.countryCount ?? 0,
    dateRange: stats?.minDate && stats?.maxDate
      ? { min: stats.minDate, max: stats.maxDate }
      : null,
  };
}

// ==================== Summaries ====================

export interface DailySummary {
  date: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export function getDailySummaries(params: SalesQueryParams = {}): DailySummary[] {
  const { startDate, endDate, limit = 1000 } = params;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (startDate) {
    conditions.push(`date >= ?`);
    queryParams.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= ?`);
    queryParams.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const summaries = query<DailySummary>(
    `SELECT 
      date,
      SUM(CAST(gross_sales_usd AS REAL)) as totalRevenue,
      SUM(net_units_sold) as totalUnits,
      COUNT(*) as recordCount
    FROM sales_data ${whereClause}
    GROUP BY date
    ORDER BY date
    LIMIT ?`,
    [...queryParams, limit]
  );

  return summaries.map(s => ({
    date: s.date,
    totalRevenue: parseUsdHelper(s.totalRevenue?.toString()),
    totalUnits: parseIntSafeHelper(s.totalUnits),
    recordCount: parseIntSafeHelper(s.recordCount),
  }));
}

export interface AppSummary {
  appId: number;
  appName: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  firstSale: string;
  lastSale: string;
}

export function getAppSummaries(params: SalesQueryParams = {}): AppSummary[] {
  const { startDate, endDate, limit = 100 } = params;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (startDate) {
    conditions.push(`date >= ?`);
    queryParams.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= ?`);
    queryParams.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const summaries = query<AppSummary & { totalRevenue: string; totalUnits: string; recordCount: string }>(
    `SELECT 
      appid as appId,
      NULL as appName,
      SUM(CAST(gross_sales_usd AS REAL)) as totalRevenue,
      SUM(net_units_sold) as totalUnits,
      COUNT(*) as recordCount,
      MIN(date) as firstSale,
      MAX(date) as lastSale
    FROM sales_data ${whereClause}
    GROUP BY appid
    ORDER BY totalRevenue DESC
    LIMIT ?`,
    [...queryParams, limit]
  );

  return summaries
    .filter(s => s.appId !== null)
    .map(s => ({
      appId: s.appId!,
      appName: null,
      totalRevenue: parseUsdHelper(s.totalRevenue),
      totalUnits: parseIntSafeHelper(s.totalUnits),
      recordCount: parseIntSafeHelper(s.recordCount),
      firstSale: s.firstSale,
      lastSale: s.lastSale,
    }));
}

export interface CountrySummary {
  countryCode: string;
  countryName: string | null;
  region: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export function getCountrySummaries(params: SalesQueryParams = {}): CountrySummary[] {
  const { startDate, endDate, limit = 250 } = params;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (startDate) {
    conditions.push(`date >= ?`);
    queryParams.push(startDate);
  }
  if (endDate) {
    conditions.push(`date <= ?`);
    queryParams.push(endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const summaries = query<CountrySummary & { totalRevenue: string; totalUnits: string; recordCount: string }>(
    `SELECT 
      country_code as countryCode,
      NULL as countryName,
      NULL as region,
      SUM(CAST(gross_sales_usd AS REAL)) as totalRevenue,
      SUM(net_units_sold) as totalUnits,
      COUNT(*) as recordCount
    FROM sales_data ${whereClause}
    GROUP BY country_code
    ORDER BY totalRevenue DESC
    LIMIT ?`,
    [...queryParams, limit]
  );

  return summaries
    .filter(s => s.countryCode !== null)
    .map(s => ({
      countryCode: s.countryCode!,
      countryName: null,
      region: null,
      totalRevenue: parseUsdHelper(s.totalRevenue),
      totalUnits: parseIntSafeHelper(s.totalUnits),
      recordCount: parseIntSafeHelper(s.recordCount),
    }));
}

// ==================== Lookups ====================

export interface AppLookup {
  appId: number;
  appName: string;
}

export function getAppsLookup(): AppLookup[] {
  // CLI tool may not have a separate apps table, so we'll get distinct appids from sales_data
  const apps = query<{ appId: number }>(
    `SELECT DISTINCT appid as appId FROM sales_data WHERE appid IS NOT NULL ORDER BY appId`
  );

  return apps.map(a => ({
    appId: a.appId,
    appName: `App ${a.appId}`, // CLI tool may not store app names
  }));
}

export interface CountryLookup {
  countryCode: string;
  countryName: string;
  region: string | null;
}

export function getCountriesLookup(): CountryLookup[] {
  // CLI tool may not have a separate countries table
  const countries = query<{ countryCode: string }>(
    `SELECT DISTINCT country_code as countryCode FROM sales_data WHERE country_code IS NOT NULL ORDER BY country_code`
  );

  return countries.map(c => ({
    countryCode: c.countryCode,
    countryName: c.countryCode, // Use code as name if not available
    region: null,
  }));
}

// Clean up database
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
