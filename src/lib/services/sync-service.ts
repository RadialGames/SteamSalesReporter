// Sync service for fetching and processing Steam sales data
// Handles batch processing, progress reporting, and database persistence

import type { SalesRecord, ProgressCallback, FetchParams, FetchResult } from './types';
import { generateUniqueKey } from '$lib/shared/steam-transform';
import { sortDatesByPriority } from '$lib/utils/dates';
import { fetchSalesForDate, fetchChangedDates, SyncCancelledError } from './steam-api-client';
import { getHighwatermark } from './api-key-storage';
import { storeParsedRecords, getParsedRecords } from '$lib/db/parsed-data';

export { SyncCancelledError };

// Number of dates to fetch in parallel (be respectful to Steam's servers)
const PARALLEL_BATCH_SIZE = 10;

/**
 * Save sales records with automatic overwrite support.
 * Records with the same unique key (generated from Steam API identifying fields)
 * will automatically overwrite existing records via bulkPut.
 */
async function saveSalesWithOverwrite(newRecords: SalesRecord[], apiKeyId: string): Promise<void> {
  if (newRecords.length === 0) return;

  // Ensure all records have apiKeyId set and unique key generated
  const taggedRecords = newRecords.map((record) => {
    const r = {
      ...record,
      apiKeyId: record.apiKeyId || apiKeyId,
    };
    // Ensure id (unique key) is set - should already be set by fetchSalesForDate
    if (!r.id) {
      // Fallback: generate unique key if not already set
      r.id = generateUniqueKey(r);
    }
    return r;
  });

  // Use bulkPut - it will automatically overwrite records with matching id (unique key)
  // Note: This function is deprecated - new architecture uses raw -> parse pipeline
  // Keeping for backward compatibility but should not be used
  await storeParsedRecords(taggedRecords as (SalesRecord & { id: string; apiKeyId: string })[]);
}

/**
 * Process dates in parallel batches with incremental database saves.
 * This prevents memory issues when processing thousands of dates.
 */
async function processDatesInBatches(
  apiKey: string,
  apiKeyId: string,
  dates: string[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  onDateProcessed?: (date: string) => void
): Promise<number> {
  let processedCount = 0;
  let totalRecords = 0;

  // Process in batches
  for (let i = 0; i < dates.length; i += PARALLEL_BATCH_SIZE) {
    // Check if cancelled before each batch
    if (signal?.aborted) {
      throw new SyncCancelledError();
    }

    const batch = dates.slice(i, i + PARALLEL_BATCH_SIZE);

    // Fetch all dates in this batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (date) => {
        const sales = await fetchSalesForDate(apiKey, apiKeyId, date, signal);
        return { date, sales };
      })
    );

    // Collect batch sales and save immediately to database
    // This prevents memory accumulation over thousands of dates
    const batchSales: SalesRecord[] = [];
    for (const result of batchResults) {
      batchSales.push(...result.sales);
      totalRecords += result.sales.length;
      processedCount++;
    }

    // Save this batch to database immediately
    // Look up existing records by composite key to ensure overwrites instead of duplicates
    if (batchSales.length > 0) {
      await saveSalesWithOverwrite(batchSales, apiKeyId);
    }

    // Mark dates as processed AFTER successful save
    // This is critical for correct resume behavior
    for (const result of batchResults) {
      onDateProcessed?.(result.date);
    }

    // Get the last date in this batch for display
    const lastDateInBatch = batch[batch.length - 1];

    // Update progress after each batch (not each result) and yield to UI
    onProgress?.({
      phase: 'sales',
      message: `Fetching sales data...`,
      current: processedCount,
      total: dates.length,
      currentDate: lastDateInBatch,
      recordsFetched: totalRecords,
    });

    // Yield to allow UI to update
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Return total count (data is already saved to DB)
  return totalRecords;
}

/**
 * Fetch sales data from Steam API with progress reporting.
 * Supports both fresh starts and resuming interrupted syncs.
 */
export async function fetchSalesData(params: FetchParams): Promise<FetchResult> {
  const { apiKey, apiKeyId, onProgress, signal, datesToFetch, onDateProcessed } = params;

  // Check if already cancelled
  if (signal?.aborted) {
    throw new SyncCancelledError();
  }

  let datesToProcess: string[];
  let newHighwatermark: number;

  if (datesToFetch && datesToFetch.length > 0) {
    // RESUME MODE: Use pre-sorted dates provided by caller
    // Skip fetching changed dates from API - just process the provided list
    datesToProcess = datesToFetch;
    // Highwatermark is managed by the caller in resume mode
    newHighwatermark = await getHighwatermark(apiKeyId);

    onProgress?.({
      phase: 'sales',
      message: `Resuming: ${datesToProcess.length} date${datesToProcess.length === 1 ? '' : 's'} remaining...`,
      current: 0,
      total: datesToProcess.length,
      recordsFetched: 0,
    });
  } else {
    // FRESH START MODE: Fetch changed dates from Steam API

    // Phase 1: Initialize
    onProgress?.({
      phase: 'init',
      message: 'Connecting to Steam Partner API...',
      current: 0,
      total: 100,
      recordsFetched: 0,
    });

    // Get current highwatermark (stored from previous successful sync)
    const storedHighwatermark = await getHighwatermark(apiKeyId);

    // Phase 2: Get changed dates since our last sync
    onProgress?.({
      phase: 'dates',
      message:
        storedHighwatermark > 0
          ? 'Checking for updates since last sync...'
          : 'First sync - fetching all historical data...',
      current: 0,
      total: 1,
      recordsFetched: 0,
    });

    const changedDatesResult = await fetchChangedDates(apiKey, storedHighwatermark, signal);
    const dates = changedDatesResult.dates;
    newHighwatermark = changedDatesResult.newHighwatermark;

    // Sort dates: new dates first, then existing dates (both in chronological order)
    // This ensures new data is processed before re-processing existing data
    const existingDates = await getExistingDatesForKey(apiKeyId);
    datesToProcess = sortDatesByPriority(dates, existingDates);

    onProgress?.({
      phase: 'dates',
      message:
        datesToProcess.length > 0
          ? `Found ${datesToProcess.length} date${datesToProcess.length === 1 ? '' : 's'} with new/updated data`
          : 'Checking complete',
      current: 1,
      total: 1,
      recordsFetched: 0,
    });
  }

  // If no dates to process, we're already up to date
  if (datesToProcess.length === 0) {
    onProgress?.({
      phase: 'complete',
      message: 'Already up to date! No new sales data found.',
      current: 0,
      total: 0,
      recordsFetched: 0,
    });
    // Return empty result but still provide the highwatermark for saving
    return { sales: [], newHighwatermark };
  }

  // Phase 3: Fetch sales data in parallel batches
  // Data is saved incrementally to the database to prevent memory issues
  const totalRecordsSaved = await processDatesInBatches(
    apiKey,
    apiKeyId,
    datesToProcess,
    onProgress,
    signal,
    onDateProcessed
  );

  // NOTE: Aggregate computation has been moved to sync-orchestrator.ts
  // to run only ONCE at the end of the entire sync (not after each key/phase)
  // This prevents the 30-60 second delays between key/phase transitions

  // Phase 4: Data is already saved - just report completion
  // NOTE: We do NOT save the highwatermark here!
  // The caller must save it AFTER this function returns successfully.

  // Return empty array since data is already in DB, but include count for reporting
  return { sales: [], newHighwatermark, recordCount: totalRecordsSaved };
}

/**
 * Get unique dates for a specific API key from the database
 */
async function getExistingDatesForKey(apiKeyId: string): Promise<Set<string>> {
  const dates = new Set<string>();
  // Note: This function is deprecated - use parsed-data module instead
  const result = await getParsedRecords(1, 100000, { apiKeyIds: [apiKeyId] });
  const records = result.data;
  for (const record of records) {
    dates.add(record.date);
  }
  return dates;
}

export { saveSalesWithOverwrite };
