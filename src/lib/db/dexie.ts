/**
 * IndexedDB Database using Dexie.js
 * 
 * This module provides persistent storage for sales data and pre-computed aggregates.
 * 
 * ## Pre-computed Aggregates
 * 
 * For large datasets, we pre-compute aggregates after data sync to enable instant
 * reads without iterating through all records. This is part of the three-tier
 * aggregation strategy:
 * 
 * 1. **Real-time stores** (sales.ts): For small datasets with active filtering
 * 2. **Web Workers** (workers/): For large datasets during UI interaction
 * 3. **Pre-computed tables** (this file): For initial load and dashboard stats
 * 
 * ### When to Recompute Aggregates
 * 
 * Call `computeAndStoreAggregates()` after:
 * - Data sync completes (new records added)
 * - Data is cleared or deleted
 * - App determines aggregates are stale via `aggregatesNeedUpdate()`
 * 
 * ### Aggregate Tables
 * 
 * - `dailyAggregates`: Revenue and units per date
 * - `appAggregates`: Revenue and units per app, with date range
 * - `countryAggregates`: Revenue and units per country
 * - `aggregatesMeta`: Tracks when aggregates were last updated
 * 
 * @see src/lib/workers/index.ts for the aggregation strategy documentation
 */

import Dexie, { type EntityTable } from 'dexie';
import type { SalesRecord, SyncMeta, Filters } from '$lib/services/types';

// ============================================================================
// Pre-computed aggregate types
// ============================================================================

export interface DailyAggregate {
  date: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export interface AppAggregate {
  appId: number;
  appName: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  firstSaleDate: string;
  lastSaleDate: string;
}

export interface CountryAggregate {
  countryCode: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export interface AggregatesMeta {
  key: string; // 'lastUpdated', 'totalRecords', etc.
  value: string;
}

// Extend Dexie with our tables
class SteamSalesDB extends Dexie {
  sales!: EntityTable<SalesRecord, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'key'>;
  dailyAggregates!: EntityTable<DailyAggregate, 'date'>;
  appAggregates!: EntityTable<AppAggregate, 'appId'>;
  countryAggregates!: EntityTable<CountryAggregate, 'countryCode'>;
  aggregatesMeta!: EntityTable<AggregatesMeta, 'key'>;

  constructor() {
    // Changed database name in version 5 to force fresh start due to primary key type change
    super('SteamSalesDB_v2');
    
    // Version 1: Original schema
    this.version(1).stores({
      sales: '++id, date, appId, packageId, countryCode, [date+appId+packageId+countryCode]',
      syncMeta: 'key'
    });
    
    // Version 2: Add pre-computed aggregate tables
    this.version(2).stores({
      sales: '++id, date, appId, packageId, countryCode, [date+appId+packageId+countryCode]',
      syncMeta: 'key',
      dailyAggregates: 'date',
      appAggregates: 'appId',
      countryAggregates: 'countryCode',
      aggregatesMeta: 'key'
    });
    
    // Version 3: Add apiKeyId index for multi-key support
    this.version(3).stores({
      sales: '++id, date, appId, packageId, countryCode, apiKeyId, [date+appId+packageId+countryCode]',
      syncMeta: 'key',
      dailyAggregates: 'date',
      appAggregates: 'appId',
      countryAggregates: 'countryCode',
      aggregatesMeta: 'key'
    });
    
    // Version 4: Add unique constraint on id and update composite unique key to include apiKeyId
    this.version(4).stores({
      sales: '++id, date, appId, packageId, countryCode, apiKeyId, [date+appId+packageId+countryCode+apiKeyId]',
      syncMeta: 'key',
      dailyAggregates: 'date',
      appAggregates: 'appId',
      countryAggregates: 'countryCode',
      aggregatesMeta: 'key'
    });
    
    // Version 5: Delete sales table to prepare for schema change
    // Dexie doesn't support changing primary key type, so we must delete and recreate
    this.version(5).stores({
      // Remove sales table (this deletes it)
      syncMeta: 'key',
      dailyAggregates: 'date',
      appAggregates: 'appId',
      countryAggregates: 'countryCode',
      aggregatesMeta: 'key'
    });
    
    // Version 6: Recreate sales table with unique key hash as primary key
    // This ensures records with the same Steam API identifying fields automatically overwrite
    this.version(6).stores({
      sales: 'id, date, appId, packageId, countryCode, apiKeyId, [date+appId+packageId+countryCode+apiKeyId]',
      syncMeta: 'key',
      dailyAggregates: 'date',
      appAggregates: 'appId',
      countryAggregates: 'countryCode',
      aggregatesMeta: 'key'
    });
  }
}

export const db = new SteamSalesDB();

// ============================================================================
// Database Initialization & Cleanup
// ============================================================================

/** Progress callback for database operations */
export type DbProgressCallback = (message: string, progress: number) => void;

/**
 * Clean up duplicate IDs in the database.
 * In IndexedDB, primary keys should be unique, but this function ensures
 * that if any duplicates exist (due to data corruption or migration issues),
 * we keep only the first occurrence of each ID.
 * Returns the number of duplicate records removed.
 */
export async function cleanupDuplicateIds(
  onProgress?: DbProgressCallback
): Promise<number> {
  onProgress?.('Checking for duplicate IDs...', 0);
  
  const totalCount = await db.sales.count();
  
  if (totalCount === 0) {
    onProgress?.('No duplicates found', 100);
    return 0;
  }
  
  onProgress?.(`Scanning ${totalCount.toLocaleString()} records for duplicate IDs...`, 5);
  
  // In IndexedDB, primary keys are automatically unique, so we shouldn't find duplicates.
  // However, we'll scan to be safe and also check for duplicate logical records.
  const SCAN_BATCH_SIZE = 10000;
  const seenIds = new Set<string | number>();
  const duplicateIds: (string | number)[] = [];
  let offset = 0;
  
  while (offset < totalCount) {
    const batch = await db.sales.offset(offset).limit(SCAN_BATCH_SIZE).toArray();
    
    for (const record of batch) {
      if (record.id !== undefined) {
        if (seenIds.has(record.id)) {
          // Found a duplicate ID (shouldn't happen, but handle it)
          duplicateIds.push(record.id);
        } else {
          seenIds.add(record.id);
        }
      }
    }
    
    offset += batch.length;
    const scanProgress = 5 + Math.round((offset / totalCount) * 15);
    onProgress?.(`Scanning... ${offset.toLocaleString()} / ${totalCount.toLocaleString()}`, scanProgress);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    if (batch.length < SCAN_BATCH_SIZE) break;
  }
  
  if (duplicateIds.length > 0) {
    console.warn(`Found ${duplicateIds.length} duplicate IDs (this shouldn't happen with IndexedDB primary keys)`);
    // Delete duplicates, keeping the first occurrence
    // Since IndexedDB enforces uniqueness, we'll delete all but one
    const idsToDelete = duplicateIds.slice(1); // Keep first, delete rest
    // bulkDelete accepts string | number
    await db.sales.bulkDelete(idsToDelete as any);
    onProgress?.('Removed duplicate IDs', 100);
    return idsToDelete.length;
  }
  
  onProgress?.('No duplicate IDs found', 100);
  return 0;
}

/**
 * Clean up duplicate logical records (same business key).
 * Finds records with the same date+appId+packageId+countryCode+apiKeyId
 * and keeps only one (the first occurrence).
 * Returns the number of duplicate records removed.
 */
export async function cleanupDuplicateLogicalRecords(
  onProgress?: DbProgressCallback
): Promise<number> {
  onProgress?.('Checking for duplicate logical records...', 0);
  
  const totalCount = await db.sales.count();
  
  if (totalCount === 0) {
    onProgress?.('No duplicates found', 100);
    return 0;
  }
  
  onProgress?.(`Scanning ${totalCount.toLocaleString()} records for duplicates...`, 5);
  
  const SCAN_BATCH_SIZE = 10000;
  const seenKeys = new Map<string, string | number>(); // business key -> first record ID
  const duplicateIds: (string | number)[] = [];
  let offset = 0;
  
  while (offset < totalCount) {
    const batch = await db.sales.offset(offset).limit(SCAN_BATCH_SIZE).toArray();
    
    for (const record of batch) {
      if (record.id === undefined) continue;
      
      // Create business key: date+appId+packageId+countryCode+apiKeyId
      const businessKey = `${record.date}|${record.appId}|${record.packageid ?? 0}|${record.countryCode}|${record.apiKeyId || ''}`;
      
      const existingId = seenKeys.get(businessKey);
      if (existingId !== undefined) {
        // Found a duplicate logical record - mark this one for deletion
        duplicateIds.push(record.id);
      } else {
        // First occurrence - keep it
        seenKeys.set(businessKey, record.id);
      }
    }
    
    offset += batch.length;
    const scanProgress = 5 + Math.round((offset / totalCount) * 40);
    onProgress?.(`Scanning... ${offset.toLocaleString()} / ${totalCount.toLocaleString()}`, scanProgress);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    if (batch.length < SCAN_BATCH_SIZE) break;
  }
  
  if (duplicateIds.length > 0) {
    console.log(`Found ${duplicateIds.length} duplicate logical records`);
    
    // Delete duplicates in batches
    const DELETE_BATCH_SIZE = 5000;
    let deleted = 0;
    
    for (let i = 0; i < duplicateIds.length; i += DELETE_BATCH_SIZE) {
      const batch = duplicateIds.slice(i, i + DELETE_BATCH_SIZE);
      await db.sales.bulkDelete(batch);
      deleted += batch.length;
      
      const deleteProgress = 45 + Math.round((deleted / duplicateIds.length) * 10);
      onProgress?.(`Removing duplicates... ${deleted.toLocaleString()} / ${duplicateIds.length.toLocaleString()}`, deleteProgress);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    console.log(`Cleaned up ${duplicateIds.length} duplicate logical records`);
    onProgress?.('Duplicate cleanup complete', 100);
    return duplicateIds.length;
  }
  
  onProgress?.('No duplicate logical records found', 100);
  return 0;
}

/**
 * Clean up invalid records on startup.
 * Deletes any sales records that don't have a valid apiKeyId.
 * Returns the number of records deleted.
 */
export async function cleanupInvalidRecords(
  onProgress?: DbProgressCallback
): Promise<number> {
  onProgress?.('Counting records...', 5);
  
  // First get total count for context
  const totalCount = await db.sales.count();
  
  if (totalCount === 0) {
    onProgress?.('Database ready', 100);
    return 0;
  }
  
  onProgress?.(`Scanning ${totalCount.toLocaleString()} records...`, 10);
  
  // Yield to let UI update
  await new Promise(resolve => setTimeout(resolve, 0));
  
  // Find invalid records by scanning in batches for progress feedback
  // We use pagination to allow yielding to the event loop for UI updates
  const SCAN_BATCH_SIZE = 10000;
  const invalidIds: (string | number)[] = [];
  let offset = 0;
  
  while (offset < totalCount) {
    const batch = await db.sales.offset(offset).limit(SCAN_BATCH_SIZE).toArray();
    
    for (const record of batch) {
      if (!record.apiKeyId || record.apiKeyId.trim() === '') {
        if (record.id !== undefined) {
          invalidIds.push(record.id);
        }
      }
    }
    
    offset += batch.length;
    
    // Update progress and yield to event loop
    const scanProgress = 10 + Math.round((offset / totalCount) * 20);
    onProgress?.(`Scanning... ${offset.toLocaleString()} / ${totalCount.toLocaleString()}`, scanProgress);
    await new Promise(resolve => setTimeout(resolve, 0));
    
    if (batch.length < SCAN_BATCH_SIZE) break;
  }
  
  onProgress?.('Scan complete', 30);
  
  if (invalidIds.length > 0) {
    console.log(`Found ${invalidIds.length} invalid records (missing apiKeyId)`);
    
    // Delete in batches with progress
    const DELETE_BATCH_SIZE = 5000;
    let deleted = 0;
    
    for (let i = 0; i < invalidIds.length; i += DELETE_BATCH_SIZE) {
      const batch = invalidIds.slice(i, i + DELETE_BATCH_SIZE);
      await db.sales.bulkDelete(batch as any); // bulkDelete accepts string | number
      deleted += batch.length;
      
      const deleteProgress = 30 + Math.round((deleted / invalidIds.length) * 15);
      onProgress?.(`Cleaning up... ${deleted.toLocaleString()} / ${invalidIds.length.toLocaleString()}`, deleteProgress);
      
      // Yield to let UI update
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    console.log(`Cleaned up ${invalidIds.length} invalid records`);
    
    // Recompute aggregates after cleanup
    const remainingCount = await db.sales.count();
    if (remainingCount > 0) {
      onProgress?.('Recomputing aggregates...', 50);
      await computeAndStoreAggregates((msg, prog) => {
        // Map aggregate progress (0-100) to our range (50-95)
        const mappedProgress = 50 + Math.round(prog * 0.45);
        onProgress?.(msg, mappedProgress);
      });
    } else {
      await clearAggregates();
    }
  }
  
  onProgress?.('Database ready', 100);
  return invalidIds.length;
}

/**
 * Initialize the database - should be called on app startup.
 * Performs cleanup of duplicate IDs, duplicate logical records, and invalid records.
 */
export async function initializeDatabase(
  onProgress?: DbProgressCallback
): Promise<{ cleanedRecords: number; duplicateIdsRemoved: number; duplicateLogicalRecordsRemoved: number }> {
  onProgress?.('Opening database...', 0);
  
  // Try to open the database, handle primary key change errors
  try {
    await db.open();
  } catch (error: any) {
    // If we get an UpgradeError about changing primary key, delete and recreate the database
    if (error?.name === 'UpgradeError' && error?.message?.includes('changing primary key')) {
      console.warn('Primary key change detected. Deleting and recreating database...');
      onProgress?.('Recreating database with new schema...', 5);
      
      // Close the database
      db.close();
      
      // Delete the database
      await db.delete();
      
      // Recreate it
      await db.open();
      
      onProgress?.('Database recreated successfully', 10);
    } else {
      // Re-throw other errors
      throw error;
    }
  }
  
  onProgress?.('Checking for duplicate IDs...', 2);
  const duplicateIdsRemoved = await cleanupDuplicateIds((msg, prog) => {
    // Map progress 0-100 to 2-15
    const mappedProgress = 2 + Math.round(prog * 0.13);
    onProgress?.(msg, mappedProgress);
  });
  
  onProgress?.('Checking for duplicate logical records...', 15);
  const duplicateLogicalRecordsRemoved = await cleanupDuplicateLogicalRecords((msg, prog) => {
    // Map progress 0-100 to 15-40
    const mappedProgress = 15 + Math.round(prog * 0.25);
    onProgress?.(msg, mappedProgress);
  });
  
  onProgress?.('Checking database integrity...', 40);
  const cleanedRecords = await cleanupInvalidRecords((msg, prog) => {
    // Map progress 0-100 to 40-100
    const mappedProgress = 40 + Math.round(prog * 0.60);
    onProgress?.(msg, mappedProgress);
  });
  
  return { 
    cleanedRecords, 
    duplicateIdsRemoved, 
    duplicateLogicalRecordsRemoved 
  };
}

// ============================================================================
// Basic Operations
// ============================================================================

export async function clearAllData(): Promise<void> {
  await db.sales.clear();
  await db.syncMeta.clear();
}

/**
 * Get the total count of sales records
 */
export async function getTotalCount(): Promise<number> {
  return db.sales.count();
}

// ============================================================================
// Paginated Queries
// ============================================================================

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Get paginated sales records with optional filters
 * Uses indexed queries for efficient pagination
 */
export async function getSalesPaginated(
  page: number = 1,
  pageSize: number = 1000,
  filters?: Filters
): Promise<PaginatedResult<SalesRecord>> {
  const offset = (page - 1) * pageSize;
  
  // Start with base collection
  let collection = db.sales.toCollection();
  
  // Apply indexed filters where possible
  if (filters?.appIds && filters.appIds.length === 1) {
    // Single app filter can use index
    collection = db.sales.where('appId').equals(filters.appIds[0]);
  } else if (filters?.startDate && filters?.endDate) {
    collection = db.sales.where('date').between(filters.startDate, filters.endDate, true, true);
  } else if (filters?.startDate) {
    collection = db.sales.where('date').aboveOrEqual(filters.startDate);
  } else if (filters?.endDate) {
    collection = db.sales.where('date').belowOrEqual(filters.endDate);
  }
  
  // Get total count for this filter (for pagination info)
  let total = await collection.count();
  
  // Get paginated results
  let results = await collection
    .offset(offset)
    .limit(pageSize)
    .toArray();
  
  // Apply non-indexed filters in memory
  if (filters) {
    if (filters.countryCode) {
      results = results.filter(r => r.countryCode === filters.countryCode);
    }
    // App filter (multi-select)
    if (filters.appIds && filters.appIds.length > 1) {
      const appIdSet = new Set(filters.appIds);
      results = results.filter(r => appIdSet.has(r.appId));
    }
    // API key filter (multi-select)
    if (filters.apiKeyIds && filters.apiKeyIds.length > 0) {
      const apiKeyIdSet = new Set(filters.apiKeyIds);
      results = results.filter(r => apiKeyIdSet.has(r.apiKeyId));
    }
    // Date filters if not already applied via index
    if (filters.startDate && !(filters.appIds && filters.appIds.length === 1)) {
      results = results.filter(r => r.date >= filters.startDate!);
    }
    if (filters.endDate && !(filters.appIds && filters.appIds.length === 1)) {
      results = results.filter(r => r.date <= filters.endDate!);
    }
    if (filters.appIds && filters.appIds.length === 1 && (filters.startDate || filters.endDate)) {
      // If we filtered by single appId via index, still need to apply date filters
      if (filters.startDate) {
        results = results.filter(r => r.date >= filters.startDate!);
      }
      if (filters.endDate) {
        results = results.filter(r => r.date <= filters.endDate!);
      }
    }
  }
  
  return {
    data: results,
    total,
    page,
    pageSize,
    hasMore: offset + results.length < total
  };
}

/**
 * Stream sales records in batches, calling callback for each batch
 * Useful for processing large datasets without loading all into memory
 */
export async function streamSalesInBatches(
  batchSize: number,
  callback: (batch: SalesRecord[], progress: { processed: number; total: number }) => Promise<void> | void,
  filters?: Filters
): Promise<void> {
  const total = await getTotalCount();
  let processed = 0;
  let offset = 0;
  
  while (offset < total) {
    const result = await getSalesPaginated(Math.floor(offset / batchSize) + 1, batchSize, filters);
    
    if (result.data.length === 0) break;
    
    processed += result.data.length;
    await callback(result.data, { processed, total });
    
    offset += batchSize;
    
    // Yield to allow UI updates
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

// ============================================================================
// Optimized Metadata Queries (using indexed queries where possible)
// ============================================================================

/**
 * Get unique apps - optimized to use cursor for streaming
 */
export async function getUniqueApps(): Promise<{ appId: number; appName: string }[]> {
  const uniqueApps = new Map<number, string>();
  
  // Use cursor to stream through data without loading all into memory
  await db.sales.orderBy('appId').eachUniqueKey(async (appId) => {
    if (typeof appId === 'number') {
      // Get one record to get the app name
      const record = await db.sales.where('appId').equals(appId).first();
      if (record) {
        uniqueApps.set(appId, record.appName || `App ${appId}`);
      }
    }
  });
  
  return Array.from(uniqueApps.entries()).map(([appId, appName]) => ({
    appId,
    appName
  }));
}

/**
 * Get unique countries - optimized to use cursor
 */
export async function getUniqueCountries(): Promise<string[]> {
  const countries = new Set<string>();
  
  // Use cursor to stream through unique country codes
  await db.sales.orderBy('countryCode').eachUniqueKey((code) => {
    if (typeof code === 'string') {
      countries.add(code);
    }
  });
  
  return Array.from(countries).sort();
}

/**
 * Get date range - optimized to only fetch first and last records
 */
export async function getDateRange(): Promise<{ min: string; max: string } | null> {
  // Get first record by date (ascending)
  const first = await db.sales.orderBy('date').first();
  
  if (!first) {
    return null;
  }
  
  // Get last record by date (descending)
  const last = await db.sales.orderBy('date').last();
  
  return {
    min: first.date,
    max: last?.date || first.date
  };
}

// ============================================================================
// Aggregation Queries (computed at DB level where possible)
// ============================================================================

/**
 * Get record count by app ID
 */
export async function getCountByApp(): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  
  await db.sales.orderBy('appId').eachUniqueKey(async (appId) => {
    if (typeof appId === 'number') {
      const count = await db.sales.where('appId').equals(appId).count();
      counts.set(appId, count);
    }
  });
  
  return counts;
}

/**
 * Get record count by date
 */
export async function getCountByDate(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  
  await db.sales.orderBy('date').eachUniqueKey(async (date) => {
    if (typeof date === 'string') {
      const count = await db.sales.where('date').equals(date).count();
      counts.set(date, count);
    }
  });
  
  return counts;
}

/**
 * Get sales for a specific app ID (paginated)
 */
export async function getSalesForApp(
  appId: number,
  page: number = 1,
  pageSize: number = 1000
): Promise<PaginatedResult<SalesRecord>> {
  const offset = (page - 1) * pageSize;
  
  const collection = db.sales.where('appId').equals(appId);
  const total = await collection.count();
  const data = await collection.offset(offset).limit(pageSize).toArray();
  
  return {
    data,
    total,
    page,
    pageSize,
    hasMore: offset + data.length < total
  };
}

/**
 * Get sales for a specific date range (paginated)
 */
export async function getSalesForDateRange(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 1000
): Promise<PaginatedResult<SalesRecord>> {
  const offset = (page - 1) * pageSize;
  
  const collection = db.sales.where('date').between(startDate, endDate, true, true);
  const total = await collection.count();
  const data = await collection.offset(offset).limit(pageSize).toArray();
  
  return {
    data,
    total,
    page,
    pageSize,
    hasMore: offset + data.length < total
  };
}

// ============================================================================
// Pre-computed Aggregates
// ============================================================================

/**
 * Check if aggregates need to be recomputed
 */
export async function aggregatesNeedUpdate(): Promise<boolean> {
  const meta = await db.aggregatesMeta.get('lastUpdated');
  if (!meta) return true;
  
  const totalRecordsMeta = await db.aggregatesMeta.get('totalRecords');
  const currentCount = await db.sales.count();
  
  if (!totalRecordsMeta || parseInt(totalRecordsMeta.value) !== currentCount) {
    return true;
  }
  
  return false;
}

/**
 * Compute and store all aggregates
 * Call this after data sync to pre-compute summaries
 */
export async function computeAndStoreAggregates(
  onProgress?: (message: string, progress: number) => void
): Promise<void> {
  const totalRecords = await db.sales.count();
  if (totalRecords === 0) {
    // Clear existing aggregates
    await db.dailyAggregates.clear();
    await db.appAggregates.clear();
    await db.countryAggregates.clear();
    await db.aggregatesMeta.clear();
    return;
  }
  
  onProgress?.('Computing daily aggregates...', 10);
  
  // Compute daily aggregates
  const dailyMap = new Map<string, DailyAggregate>();
  const appMap = new Map<number, AppAggregate>();
  const countryMap = new Map<string, CountryAggregate>();
  
  const BATCH_SIZE = 50000;
  let processed = 0;
  
  // Stream through all sales in batches
  await streamSalesInBatches(BATCH_SIZE, async (batch, { processed: p, total }) => {
    for (const sale of batch) {
      // Daily aggregate
      const daily = dailyMap.get(sale.date) || {
        date: sale.date,
        totalRevenue: 0,
        totalUnits: 0,
        recordCount: 0
      };
      daily.totalRevenue += sale.netSalesUsd ?? 0;
      daily.totalUnits += sale.unitsSold ?? 0;
      daily.recordCount++;
      dailyMap.set(sale.date, daily);
      
      // App aggregate
      const app = appMap.get(sale.appId) || {
        appId: sale.appId,
        appName: sale.appName || `App ${sale.appId}`,
        totalRevenue: 0,
        totalUnits: 0,
        recordCount: 0,
        firstSaleDate: sale.date,
        lastSaleDate: sale.date
      };
      app.totalRevenue += sale.netSalesUsd ?? 0;
      app.totalUnits += sale.unitsSold ?? 0;
      app.recordCount++;
      if (sale.appName) app.appName = sale.appName;
      if (sale.date < app.firstSaleDate) app.firstSaleDate = sale.date;
      if (sale.date > app.lastSaleDate) app.lastSaleDate = sale.date;
      appMap.set(sale.appId, app);
      
      // Country aggregate
      const country = countryMap.get(sale.countryCode) || {
        countryCode: sale.countryCode,
        totalRevenue: 0,
        totalUnits: 0,
        recordCount: 0
      };
      country.totalRevenue += sale.netSalesUsd ?? 0;
      country.totalUnits += sale.unitsSold ?? 0;
      country.recordCount++;
      countryMap.set(sale.countryCode, country);
    }
    
    processed = p;
    const progress = Math.round((p / total) * 70) + 10;
    onProgress?.(`Processing records... ${p.toLocaleString()} / ${total.toLocaleString()}`, progress);
  });
  
  // Store aggregates in database
  onProgress?.('Storing daily aggregates...', 80);
  await db.dailyAggregates.clear();
  await db.dailyAggregates.bulkPut(Array.from(dailyMap.values()));
  
  onProgress?.('Storing app aggregates...', 85);
  await db.appAggregates.clear();
  await db.appAggregates.bulkPut(Array.from(appMap.values()));
  
  onProgress?.('Storing country aggregates...', 90);
  await db.countryAggregates.clear();
  await db.countryAggregates.bulkPut(Array.from(countryMap.values()));
  
  // Update metadata
  onProgress?.('Finalizing...', 95);
  await db.aggregatesMeta.bulkPut([
    { key: 'lastUpdated', value: new Date().toISOString() },
    { key: 'totalRecords', value: totalRecords.toString() }
  ]);
  
  onProgress?.('Complete!', 100);
}

/**
 * Get pre-computed daily aggregates
 * Falls back to computing on-the-fly if not available
 */
export async function getDailyAggregates(): Promise<DailyAggregate[]> {
  const aggregates = await db.dailyAggregates.orderBy('date').toArray();
  
  if (aggregates.length > 0) {
    return aggregates;
  }
  
  // Fall back to on-the-fly computation for small datasets
  const count = await db.sales.count();
  if (count === 0) return [];
  
  // For larger datasets, trigger background computation
  if (count > 10000) {
    console.warn('Daily aggregates not pre-computed. Consider calling computeAndStoreAggregates()');
  }
  
  return aggregates;
}

/**
 * Get pre-computed app aggregates
 */
export async function getAppAggregates(): Promise<AppAggregate[]> {
  const aggregates = await db.appAggregates.toArray();
  return aggregates.sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/**
 * Get pre-computed country aggregates
 */
export async function getCountryAggregates(): Promise<CountryAggregate[]> {
  const aggregates = await db.countryAggregates.toArray();
  return aggregates.sort((a, b) => b.totalRevenue - a.totalRevenue);
}

/**
 * Get aggregate statistics
 */
export async function getAggregateStats(): Promise<{
  totalRevenue: number;
  totalUnits: number;
  totalRecords: number;
  uniqueApps: number;
  uniqueCountries: number;
  dateRange: { min: string; max: string } | null;
}> {
  const [appAggregates, countryAggregates, dailyAggregates] = await Promise.all([
    db.appAggregates.toArray(),
    db.countryAggregates.toArray(),
    db.dailyAggregates.orderBy('date').toArray()
  ]);
  
  const totalRevenue = appAggregates.reduce((sum, a) => sum + a.totalRevenue, 0);
  const totalUnits = appAggregates.reduce((sum, a) => sum + a.totalUnits, 0);
  const totalRecords = appAggregates.reduce((sum, a) => sum + a.recordCount, 0);
  
  return {
    totalRevenue,
    totalUnits,
    totalRecords,
    uniqueApps: appAggregates.length,
    uniqueCountries: countryAggregates.length,
    dateRange: dailyAggregates.length > 0 
      ? { min: dailyAggregates[0].date, max: dailyAggregates[dailyAggregates.length - 1].date }
      : null
  };
}

/**
 * Clear all aggregates (call when data is wiped)
 */
export async function clearAggregates(): Promise<void> {
  await db.dailyAggregates.clear();
  await db.appAggregates.clear();
  await db.countryAggregates.clear();
  await db.aggregatesMeta.clear();
}
