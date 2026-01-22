/**
 * Tier 1: Raw API Data Operations
 *
 * Stores complete API responses as JSON strings for reprocessing if needed.
 * This is the source of truth - all other tiers can be rebuilt from this.
 */

import { sql, batch } from './sqlite';
import type { RawApiData } from './sqlite-schema';

// Re-export the type
export type { RawApiData };

/**
 * Store a raw API response
 */
export async function storeRawResponse(
  apiKeyId: string,
  date: string,
  endpoint: 'GetDetailedSales' | 'GetChangedDates',
  responseJson: string
): Promise<void> {
  const id = `${apiKeyId}|${date}|${endpoint}`;
  const fetchedAt = Date.now();

  await sql`
    INSERT OR REPLACE INTO raw_api_data (id, api_key_id, date, endpoint, response_json, fetched_at, status)
    VALUES (${id}, ${apiKeyId}, ${date}, ${endpoint}, ${responseJson}, ${fetchedAt}, 'raw')
  `;
}

/**
 * Get a raw API response
 */
export async function getRawResponse(
  apiKeyId: string,
  date: string,
  endpoint: 'GetDetailedSales' | 'GetChangedDates'
): Promise<string | null> {
  const id = `${apiKeyId}|${date}|${endpoint}`;
  const result = (await sql`
    SELECT response_json FROM raw_api_data WHERE id = ${id}
  `) as { response_json: string }[];

  return result[0]?.response_json ?? null;
}

/**
 * Get all unparsed raw data records
 */
export async function getUnparsedRawData(): Promise<RawApiData[]> {
  return (await sql`
    SELECT id, api_key_id, date, endpoint, response_json, fetched_at, status 
    FROM raw_api_data 
    WHERE status = 'raw'
  `) as RawApiData[];
}

/**
 * Get all raw data records that are currently being parsed (for crash recovery)
 */
export async function getParsingRawData(): Promise<RawApiData[]> {
  return (await sql`
    SELECT id, api_key_id, date, endpoint, response_json, fetched_at, status 
    FROM raw_api_data 
    WHERE status = 'parsing'
  `) as RawApiData[];
}

/**
 * Mark a raw data record as parsing
 */
export async function markRawDataParsing(id: string): Promise<void> {
  await sql`UPDATE raw_api_data SET status = 'parsing' WHERE id = ${id}`;
}

/**
 * Mark a raw data record as parsed
 */
export async function markRawDataParsed(id: string): Promise<void> {
  await sql`UPDATE raw_api_data SET status = 'parsed' WHERE id = ${id}`;
}

/**
 * Mark a raw data record as error
 */
export async function markRawDataError(id: string): Promise<void> {
  await sql`UPDATE raw_api_data SET status = 'error' WHERE id = ${id}`;
}

/**
 * Batch mark multiple raw data records as parsing
 * Uses batch operation with tagged template literals for SQL injection safety
 */
export async function markRawDataBatchParsing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Use batch with individual parameterized updates for safety
  // sqlocal's batch function executes all statements atomically
  await batch((batchSql) =>
    ids.map((id) => batchSql`UPDATE raw_api_data SET status = 'parsing' WHERE id = ${id}`)
  );
}

/**
 * Batch mark multiple raw data records as parsed
 * Uses batch operation with tagged template literals for SQL injection safety
 */
export async function markRawDataBatchParsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Use batch with individual parameterized updates for safety
  await batch((batchSql) =>
    ids.map((id) => batchSql`UPDATE raw_api_data SET status = 'parsed' WHERE id = ${id}`)
  );
}

/**
 * Batch mark multiple raw data records as error
 * Uses batch operation with tagged template literals for SQL injection safety
 */
export async function markRawDataBatchError(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Use batch with individual parameterized updates for safety
  await batch((batchSql) =>
    ids.map((id) => batchSql`UPDATE raw_api_data SET status = 'error' WHERE id = ${id}`)
  );
}

/**
 * Reset parsing records back to raw (for crash recovery)
 */
export async function resetParsingRecords(): Promise<number> {
  // Get count first
  const countResult = (await sql`
    SELECT COUNT(*) as count FROM raw_api_data WHERE status = 'parsing'
  `) as { count: number }[];
  const count = countResult[0]?.count ?? 0;

  // Update status
  await sql`UPDATE raw_api_data SET status = 'raw' WHERE status = 'parsing'`;

  return count;
}

/**
 * Get raw data for a specific API key and date
 */
export async function getRawDataForDate(
  apiKeyId: string,
  date: string
): Promise<RawApiData | null> {
  const id = `${apiKeyId}|${date}|GetDetailedSales`;
  const result = (await sql`
    SELECT id, api_key_id, date, endpoint, response_json, fetched_at, status 
    FROM raw_api_data 
    WHERE id = ${id}
  `) as RawApiData[];

  return result[0] ?? null;
}

/**
 * Check if raw data exists for a date
 */
export async function hasRawDataForDate(apiKeyId: string, date: string): Promise<boolean> {
  const id = `${apiKeyId}|${date}|GetDetailedSales`;
  const result = (await sql`
    SELECT status FROM raw_api_data WHERE id = ${id}
  `) as { status: string }[];

  return result[0]?.status === 'parsed';
}

/**
 * Delete raw data for a specific API key
 */
export async function deleteRawDataForApiKey(apiKeyId: string): Promise<number> {
  const countResult = (await sql`
    SELECT COUNT(*) as count FROM raw_api_data WHERE api_key_id = ${apiKeyId}
  `) as { count: number }[];
  const count = countResult[0]?.count ?? 0;

  await sql`DELETE FROM raw_api_data WHERE api_key_id = ${apiKeyId}`;

  return count;
}
