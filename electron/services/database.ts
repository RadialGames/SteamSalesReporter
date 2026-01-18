// SQLite database for Electron production mode using sql.js (WebAssembly)
import { app } from 'electron';
import initSqlJs, { type Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { SalesRecord, Filters } from '../../src/lib/services/types';

let db: Database | null = null;
let dbPath: string;

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'steam-sales.db');
}

export async function initDatabase(): Promise<void> {
  dbPath = getDbPath();
  
  // Initialize sql.js
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  
  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
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
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_app_id ON sales(app_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sales_country ON sales(country_code)`);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  
  // Save to disk
  saveDatabase();
}

function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function getSalesFromDb(filters: Filters): SalesRecord[] {
  if (!db) throw new Error('Database not initialized');
  
  let query = 'SELECT * FROM sales WHERE 1=1';
  const params: (string | number)[] = [];
  
  if (filters.startDate) {
    query += ' AND date >= ?';
    params.push(filters.startDate);
  }
  
  if (filters.endDate) {
    query += ' AND date <= ?';
    params.push(filters.endDate);
  }
  
  if (filters.appId) {
    query += ' AND app_id = ?';
    params.push(filters.appId);
  }
  
  if (filters.countryCode) {
    query += ' AND country_code = ?';
    params.push(filters.countryCode);
  }
  
  query += ' ORDER BY date DESC';
  
  const stmt = db.prepare(query);
  stmt.bind(params);
  
  const results: SalesRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: number;
      date: string;
      app_id: number;
      app_name: string | null;
      package_id: number;
      country_code: string;
      units_sold: number;
      gross_revenue: number;
      net_revenue: number;
      currency: string;
    };
    
    results.push({
      id: row.id,
      date: row.date,
      appId: row.app_id,
      appName: row.app_name || undefined,
      packageId: row.package_id,
      countryCode: row.country_code,
      unitsSold: row.units_sold,
      grossRevenue: row.gross_revenue,
      netRevenue: row.net_revenue,
      currency: row.currency
    });
  }
  stmt.free();
  
  return results;
}

export function saveSalesData(data: SalesRecord[]): void {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sales (date, app_id, app_name, package_id, country_code, units_sold, gross_revenue, net_revenue, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  for (const record of data) {
    stmt.run([
      record.date,
      record.appId,
      record.appName || null,
      record.packageId,
      record.countryCode,
      record.unitsSold,
      record.grossRevenue,
      record.netRevenue,
      record.currency
    ]);
  }
  stmt.free();
  
  // Save to disk after bulk insert
  saveDatabase();
}

export function getHighwatermark(): number {
  if (!db) throw new Error('Database not initialized');
  
  const stmt = db.prepare('SELECT value FROM sync_meta WHERE key = ?');
  stmt.bind(['highwatermark']);
  
  let result = 0;
  if (stmt.step()) {
    const row = stmt.getAsObject() as { value: string };
    result = parseInt(row.value, 10);
  }
  stmt.free();
  
  return result;
}

export function setHighwatermark(value: number): void {
  if (!db) throw new Error('Database not initialized');
  
  db.run('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', ['highwatermark', value.toString()]);
  saveDatabase();
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}
