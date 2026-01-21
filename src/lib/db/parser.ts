/**
 * Parser Module
 *
 * Parses raw API JSON responses into typed sales records.
 * This bridges Tier 1 (raw_api_data) and Tier 2 (parsed_sales).
 */

import type { SteamDetailedSalesResponse, SalesRecord } from '$lib/services/types';
import { transformSteamResponse } from '$lib/shared/steam-transform';
import { storeParsedRecords } from './parsed-data';
import {
  getUnparsedRawData,
  markRawDataParsing,
  markRawDataParsed,
  markRawDataError,
  markRawDataBatchParsing,
  markRawDataBatchParsed,
  markRawDataBatchError,
  type RawApiData,
} from './raw-data';
import { markParsingInProgress, clearParsingInProgress } from './data-state';
import type { DbProgressCallback } from './sqlite';

/**
 * Parse a single raw API response (internal function without marking)
 * Used by parseAllUnparsed for batch processing
 */
async function parseRawResponseWithoutMarking(rawData: RawApiData): Promise<number> {
  const { api_key_id: _api_key_id, response_json: _response_json } = rawData;

  // Parse JSON
  const response: SteamDetailedSalesResponse = JSON.parse(_response_json);

  // Transform to sales records
  const salesRecords = transformSteamResponse(response, _api_key_id);

  // Ensure all records have required fields
  const parsedRecords: (SalesRecord & { id: string; apiKeyId: string })[] = salesRecords.map(
    (record, index) => {
      if (!record.id) {
        throw new Error(
          `Record ${index} missing id after transformation: ${JSON.stringify(record)}`
        );
      }
      if (!record.date) {
        throw new Error(`Record ${index} missing date: ${JSON.stringify(record)}`);
      }
      if (!record.apiKeyId) {
        throw new Error(`Record ${index} missing apiKeyId: ${JSON.stringify(record)}`);
      }

      return {
        ...record,
        id: record.id as string,
        apiKeyId: _api_key_id,
        date: record.date,
      };
    }
  );

  // Store parsed records
  if (parsedRecords.length > 0) {
    await storeParsedRecords(parsedRecords);
  }

  return parsedRecords.length;
}

/**
 * Parse a single raw API response
 * This is the public API that includes marking operations
 */
export async function parseRawResponse(
  rawData: RawApiData,
  onProgress?: (message: string) => void
): Promise<number> {
  const { id, api_key_id: _api_key_id, response_json: _response_json, date } = rawData;

  onProgress?.(`Parsing ${date}...`);

  try {
    // Mark as parsing
    await markRawDataParsing(id);

    const recordCount = await parseRawResponseWithoutMarking(rawData);

    // Mark as parsed
    await markRawDataParsed(id);

    // Note: markAggregatesDirty is NOT called here per-task anymore.
    // It's called once at the end of sync by processDataForcefully.
    // This eliminates redundant DB operations (was being called N times for N tasks).

    return recordCount;
  } catch (error) {
    console.error(`Error parsing raw response ${id}:`, error);
    await markRawDataError(id);
    throw error;
  }
}

/**
 * Parse all unparsed raw responses
 */
export async function parseAllUnparsed(
  onProgress?: DbProgressCallback
): Promise<{ parsed: number; records: number; errors: number }> {
  const unparsed = await getUnparsedRawData();
  return parseRawResponses(unparsed, onProgress);
}

/**
 * Parse a specific set of raw responses
 */
export async function parseRawResponses(
  responses: RawApiData[],
  onProgress?: DbProgressCallback
): Promise<{ parsed: number; records: number; errors: number }> {
  if (responses.length === 0) {
    return { parsed: 0, records: 0, errors: 0 };
  }

  // Mark parsing as in progress
  await markParsingInProgress();

  try {
    onProgress?.(`Processing ${responses.length} responses...`, 0);

    let totalRecords = 0;
    let errors = 0;
    const BATCH_SIZE = 50; // Parse 50 responses at a time (5x larger)
    const YIELD_INTERVAL = 200; // Yield to UI every 200 responses processed (not every batch)
    const PROGRESS_UPDATE_INTERVAL = 100; // Update progress every 100 responses processed
    let lastProgressUpdate = 0;
    let responsesProcessedSinceYield = 0;

    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const batch = responses.slice(i, i + BATCH_SIZE);
      const batchIds = batch.map((item) => item.id);

      // Mark entire batch as parsing at once (batch operation)
      await markRawDataBatchParsing(batchIds);

      // Parse batch in parallel - this is the heavy computation
      // Use a modified parsing function that doesn't do individual marking
      const parsePromises = batch.map(
        async (
          rawData
        ): Promise<
          | { success: true; records: number; id: string }
          | { success: false; error: unknown; id: string }
        > => {
          try {
            const records = await parseRawResponseWithoutMarking(rawData);
            return { success: true as const, records, id: rawData.id };
          } catch (error) {
            return { success: false as const, error, id: rawData.id };
          }
        }
      );

      const results = await Promise.allSettled(parsePromises);

      // Separate successful and failed results
      const successfulIds: string[] = [];
      const errorIds: string[] = [];

      // Count successes and errors
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.success) {
          totalRecords += result.value.records;
          successfulIds.push(result.value.id);
        } else {
          errors++;
          if (result.status === 'fulfilled') {
            errorIds.push(result.value.id);
          } else {
            // Promise was rejected - this shouldn't happen with our error handling
            console.error('Unexpected parsing error:', result.reason);
          }
        }
      }

      // Batch mark successful responses as parsed
      if (successfulIds.length > 0) {
        await markRawDataBatchParsed(successfulIds);
      }

      // Batch mark failed responses as error
      if (errorIds.length > 0) {
        await markRawDataBatchError(errorIds);
      }

      const responsesProcessed = i + batch.length;
      responsesProcessedSinceYield += batch.length;

      // Update progress at intervals to reduce message frequency
      if (
        responsesProcessed - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL ||
        responsesProcessed >= responses.length
      ) {
        const progress = Math.round((responsesProcessed / responses.length) * 100);
        onProgress?.(
          `Parsed ${responsesProcessed} / ${responses.length} responses (${totalRecords.toLocaleString()} records)`,
          progress
        );
        lastProgressUpdate = responsesProcessed;
      }

      // Yield to UI less frequently - only after processing enough responses
      // This allows longer processing bursts while still keeping the UI responsive
      if (responsesProcessedSinceYield >= YIELD_INTERVAL && responsesProcessed < responses.length) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        responsesProcessedSinceYield = 0;
      }
    }

    // Final yield to ensure UI updates
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      parsed: responses.length - errors,
      records: totalRecords,
      errors,
    };
  } finally {
    // Clear parsing in progress flag
    await clearParsingInProgress();
  }
}
