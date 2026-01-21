/**
 * Centralized Data Processor
 *
 * Single entry point for all data reprocessing operations.
 * Handles the full pipeline: parse unparsed -> compute aggregates -> compute display cache
 *
 * This module should be called from all inflection points where data may need reprocessing:
 * - App startup / crash recovery
 * - After sync completion or pause
 * - After API key changes
 * - After data deletion/wipe
 */

import { parseAllUnparsed, parseRawResponses } from './parser';
import { getUnparsedRawData } from './raw-data';
import { computeAndStoreAggregates, clearAggregates } from './aggregates';
import { computeAllDisplayCache, clearDisplayCache } from './display-cache';
import { sql } from './sqlite';
import {
  areAggregatesDirty,
  clearAggregatesDirty,
  isDisplayDirty,
  clearDisplayDirty,
  markDisplayDirty,
  markAggregatesDirty,
} from './data-state';
import { getParsedRecordsCount } from './parsed-data';

/**
 * Progress callback for data processing operations
 */
export type DataProcessorProgressCallback = (message: string, progress: number) => void;

/**
 * Options for data processing
 */
export interface DataProcessorOptions {
  onProgress?: DataProcessorProgressCallback;
}

/**
 * Result of data processing operations
 */
export interface ProcessingResult {
  /** Number of raw responses that were parsed */
  parsedResponses: number;
  /** Number of individual records parsed */
  parsedRecords: number;
  /** Whether aggregates were recomputed */
  aggregatesComputed: boolean;
  /** Whether display cache was recomputed */
  displayCacheComputed: boolean;
}

/**
 * Check if there is any data that needs processing
 * (unparsed raw data, dirty aggregates, or dirty display cache)
 */
export async function isDataDirty(): Promise<boolean> {
  const [unparsedCount, aggDirty, dispDirty] = await Promise.all([
    getUnparsedRawData().then((records) => records.length),
    areAggregatesDirty(),
    isDisplayDirty(),
  ]);

  return unparsedCount > 0 || aggDirty || dispDirty;
}

/**
 * Get the count of unparsed raw data
 */
export async function getUnparsedRawDataCount(): Promise<number> {
  const result = (await sql`SELECT COUNT(*) as count FROM raw_api_data WHERE status = 'raw'`) as {
    count: number;
  }[];
  return result[0]?.count ?? 0;
}

/**
 * Process remaining unparsed data in the background.
 * This should be called after the main app loads to continue processing.
 *
 * @param batchSize - Number of responses to process per batch (default: 100)
 * @param onProgress - Optional progress callback
 * @returns Promise that resolves when all data is processed
 */
export async function processRemainingDataInBackground(
  batchSize: number = 100,
  onProgress?: (message: string, remaining: number) => void
): Promise<void> {
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;

  while (true) {
    const remaining = await getUnparsedRawDataCount();
    if (remaining === 0) {
      onProgress?.('All data processed', 0);
      break;
    }

    // Process next batch
    const unparsed = await getUnparsedRawData();
    const toProcess = unparsed.slice(0, batchSize);

    onProgress?.(
      `Processing ${toProcess.length} more responses... (${remaining} remaining)`,
      remaining
    );

    try {
      await parseRawResponses(toProcess, (message: string, progress: number) => {
        // Silent processing - don't spam progress
        if (progress === 100) {
          console.log(`Background processing: ${message}`);
        }
      });

      // Only recompute aggregates if we processed enough data or it's been a while
      // This reduces the frequency of expensive aggregate computations
      if (await areAggregatesDirty()) {
        await computeAndStoreAggregates();
        if (await isDisplayDirty()) {
          await computeAllDisplayCache();
        }
      }

      consecutiveErrors = 0; // Reset error counter on success
    } catch (error) {
      console.error('Background processing error:', error);
      consecutiveErrors++;

      // If we have too many consecutive errors, stop background processing
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(
          `Stopping background processing after ${consecutiveErrors} consecutive errors`
        );
        break;
      }
    }

    // Longer delay to be more respectful to user interactions
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Process a limited amount of data for faster startup.
 * Only processes up to maxResponses raw responses to keep startup fast.
 *
 * @param maxResponses - Maximum number of raw responses to process (default: 50)
 * @param options - Optional progress callback
 * @returns Processing result
 */
export async function processDataIncrementally(
  maxResponses: number = 50,
  options?: DataProcessorOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    parsedResponses: 0,
    parsedRecords: 0,
    aggregatesComputed: false,
    displayCacheComputed: false,
  };

  const onProgress = options?.onProgress;

  // Step 1: Check for and parse limited unparsed raw data
  onProgress?.('Checking for unparsed data...', 0);
  const unparsed = await getUnparsedRawData();

  if (unparsed.length > 0) {
    // Only process up to maxResponses to keep startup fast
    const toProcess = unparsed.slice(0, maxResponses);
    const remaining = unparsed.length - toProcess.length;

    onProgress?.(
      `Parsing ${toProcess.length} raw responses...${remaining > 0 ? ` (${remaining} remaining)` : ''}`,
      5
    );

    const parseResult = await parseRawResponses(toProcess, (message: string, progress: number) => {
      // Map parse progress (0-100) to 5-40 range
      const mappedProgress = 5 + Math.round(progress * 0.35);
      onProgress?.(message, mappedProgress);
    });

    result.parsedResponses = parseResult.parsed;
    result.parsedRecords = parseResult.records;

    // Mark aggregates as dirty if we parsed anything
    if (result.parsedResponses > 0) {
      await markAggregatesDirty();
    }
  }

  // Step 2: Check if aggregates need recomputation
  onProgress?.('Checking aggregates...', 40);
  if (await areAggregatesDirty()) {
    onProgress?.('Computing aggregates...', 45);
    await computeAndStoreAggregates((message, progress) => {
      // Map aggregates progress (0-100) to 45-75 range
      const mappedProgress = 45 + Math.round(progress * 0.3);
      onProgress?.(message, mappedProgress);
    });
    result.aggregatesComputed = true;

    // Clear aggregates dirty flag
    await clearAggregatesDirty();

    // Mark display cache as dirty since aggregates changed
    await markDisplayDirty();
  }

  // Step 3: Check if display cache needs recomputation
  onProgress?.('Checking display cache...', 75);
  if (await isDisplayDirty()) {
    onProgress?.('Computing display cache...', 80);
    await computeAllDisplayCache((message) => {
      onProgress?.(message, 85);
    });
    result.displayCacheComputed = true;

    // Clear display dirty flag
    await clearDisplayDirty();
  }

  onProgress?.('Data processing complete', 100);
  return result;
}

/**
 * Process data if any dirty flags are set.
 * This is the main entry point for conditional data processing.
 *
 * Pipeline:
 * 1. Check for unparsed raw data -> parse if found (marks aggregates dirty)
 * 2. Check if aggregates are dirty -> recompute if dirty (marks display dirty)
 * 3. Check if display cache is dirty -> recompute if dirty
 *
 * @param options - Optional progress callback
 * @returns Processing result indicating what was processed
 */
export async function processDataIfDirty(
  options?: DataProcessorOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    parsedResponses: 0,
    parsedRecords: 0,
    aggregatesComputed: false,
    displayCacheComputed: false,
  };

  const onProgress = options?.onProgress;

  // Step 1: Check for and parse unparsed raw data
  onProgress?.('Checking for unparsed data...', 0);
  const unparsed = await getUnparsedRawData();

  if (unparsed.length > 0) {
    onProgress?.(`Parsing ${unparsed.length} raw responses...`, 5);
    const parseResult = await parseAllUnparsed((message, progress) => {
      // Map parse progress (0-100) to 5-40 range
      const mappedProgress = 5 + Math.round(progress * 0.35);
      onProgress?.(message, mappedProgress);
    });
    result.parsedResponses = parseResult.parsed;
    result.parsedRecords = parseResult.records;
    // Note: parseAllUnparsed marks aggregates as dirty if records were parsed
  }

  // Step 2: Check if aggregates need recomputation
  onProgress?.('Checking aggregates...', 40);
  if (await areAggregatesDirty()) {
    onProgress?.('Computing aggregates...', 45);
    await computeAndStoreAggregates((message, progress) => {
      // Map aggregates progress (0-100) to 45-75 range
      const mappedProgress = 45 + Math.round(progress * 0.3);
      onProgress?.(message, mappedProgress);
    });
    result.aggregatesComputed = true;

    // Clear aggregates dirty flag
    await clearAggregatesDirty();

    // Mark display cache as dirty since aggregates changed
    await markDisplayDirty();
  }

  // Step 3: Check if display cache needs recomputation
  onProgress?.('Checking display cache...', 75);
  if (await isDisplayDirty()) {
    onProgress?.('Computing display cache...', 80);
    await computeAllDisplayCache((message) => {
      onProgress?.(message, 85);
    });
    result.displayCacheComputed = true;

    // Clear display dirty flag
    await clearDisplayDirty();
  }

  onProgress?.('Data processing complete', 100);
  return result;
}

/**
 * Force full data processing regardless of dirty flags.
 * Use this after sync operations where we know data has changed.
 *
 * If there are no records at all, clears all caches instead.
 *
 * @param options - Optional progress callback
 * @returns Processing result indicating what was processed
 */
export async function processDataForcefully(
  options?: DataProcessorOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    parsedResponses: 0,
    parsedRecords: 0,
    aggregatesComputed: false,
    displayCacheComputed: false,
  };

  const onProgress = options?.onProgress;

  // Step 1: Parse any unparsed raw data
  onProgress?.('Checking for unparsed data...', 0);
  const unparsed = await getUnparsedRawData();

  if (unparsed.length > 0) {
    onProgress?.(`Parsing ${unparsed.length} raw responses...`, 5);
    const parseResult = await parseAllUnparsed((message, progress) => {
      const mappedProgress = 5 + Math.round(progress * 0.25);
      onProgress?.(message, mappedProgress);
    });
    result.parsedResponses = parseResult.parsed;
    result.parsedRecords = parseResult.records;
  }

  // Check if we have any data to process
  const totalRecords = await getParsedRecordsCount();

  if (totalRecords === 0) {
    // No data - clear all caches and flags
    onProgress?.('No data found, clearing caches...', 50);
    await clearAggregates();
    await clearDisplayCache();
    await clearAggregatesDirty();
    await clearDisplayDirty();
    onProgress?.('Data processing complete', 100);
    return result;
  }

  // Step 2: Always compute aggregates
  onProgress?.('Computing aggregates...', 30);
  await computeAndStoreAggregates((message, progress) => {
    const mappedProgress = 30 + Math.round(progress * 0.4);
    onProgress?.(message, mappedProgress);
  });
  result.aggregatesComputed = true;
  await clearAggregatesDirty();

  // Step 3: Always compute display cache
  onProgress?.('Computing display cache...', 70);
  await computeAllDisplayCache((message) => {
    onProgress?.(message, 85);
  });
  result.displayCacheComputed = true;
  await clearDisplayDirty();

  onProgress?.('Data processing complete', 100);
  return result;
}

/**
 * Process data after deletion - handles the case where data may be empty.
 * If data remains, recomputes caches. If empty, clears all caches.
 *
 * @param options - Optional progress callback
 * @returns Processing result
 */
export async function processDataAfterDeletion(
  options?: DataProcessorOptions
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    parsedResponses: 0,
    parsedRecords: 0,
    aggregatesComputed: false,
    displayCacheComputed: false,
  };

  const onProgress = options?.onProgress;

  // Check remaining data count
  const remainingCount = await getParsedRecordsCount();

  if (remainingCount === 0) {
    // No data left - clear all caches
    onProgress?.('Clearing caches (no data remaining)...', 50);
    await clearAggregates();
    await clearDisplayCache();
    await clearAggregatesDirty();
    await clearDisplayDirty();
    onProgress?.('Complete', 100);
    return result;
  }

  // Data remains - recompute caches
  onProgress?.('Recomputing aggregates...', 20);
  await computeAndStoreAggregates((message, progress) => {
    const mappedProgress = 20 + Math.round(progress * 0.5);
    onProgress?.(message, mappedProgress);
  });
  result.aggregatesComputed = true;
  await clearAggregatesDirty();

  onProgress?.('Recomputing display cache...', 70);
  await computeAllDisplayCache((message) => {
    onProgress?.(message, 85);
  });
  result.displayCacheComputed = true;
  await clearDisplayDirty();

  onProgress?.('Complete', 100);
  return result;
}
