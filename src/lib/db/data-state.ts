/**
 * Tier 5: Data State Operations
 *
 * Tracks processing state for crash recovery and dirty flagging.
 * Flags indicate when data needs to be reprocessed.
 */

import { sql } from './sqlite';
import type { DataState } from './sqlite-schema';

// Re-export the type
export type { DataState };

// State keys
export const STATE_PARSING_IN_PROGRESS = 'parsing_in_progress';
export const STATE_AGGREGATES_DIRTY = 'aggregates_dirty';
export const STATE_DISPLAY_DIRTY = 'display_dirty';
export const STATE_LAST_SYNC_COMPLETED = 'last_sync_completed';

/**
 * Set a state value
 */
export async function setState(key: string, value: string): Promise<void> {
  await sql`
    INSERT OR REPLACE INTO data_state (key, value)
    VALUES (${key}, ${value})
  `;
}

/**
 * Get a state value
 */
export async function getState(key: string): Promise<string | null> {
  const result = (await sql`
    SELECT value FROM data_state WHERE key = ${key}
  `) as { value: string }[];

  return result[0]?.value ?? null;
}

/**
 * Check if a boolean state is true
 */
export async function isStateTrue(key: string): Promise<boolean> {
  const value = await getState(key);
  return value === 'true';
}

/**
 * Set a boolean state
 */
export async function setStateBoolean(key: string, value: boolean): Promise<void> {
  await setState(key, value ? 'true' : 'false');
}

/**
 * Mark aggregates as dirty (needs recomputation)
 */
export async function markAggregatesDirty(): Promise<void> {
  await setStateBoolean(STATE_AGGREGATES_DIRTY, true);
}

/**
 * Check if aggregates are dirty
 */
export async function areAggregatesDirty(): Promise<boolean> {
  return isStateTrue(STATE_AGGREGATES_DIRTY);
}

/**
 * Clear aggregates dirty flag
 */
export async function clearAggregatesDirty(): Promise<void> {
  await setStateBoolean(STATE_AGGREGATES_DIRTY, false);
}

/**
 * Mark display cache as dirty (needs recomputation)
 */
export async function markDisplayDirty(): Promise<void> {
  await setStateBoolean(STATE_DISPLAY_DIRTY, true);
}

/**
 * Check if display cache is dirty
 */
export async function isDisplayDirty(): Promise<boolean> {
  return isStateTrue(STATE_DISPLAY_DIRTY);
}

/**
 * Clear display dirty flag
 */
export async function clearDisplayDirty(): Promise<void> {
  await setStateBoolean(STATE_DISPLAY_DIRTY, false);
}

/**
 * Mark parsing as in progress
 */
export async function markParsingInProgress(): Promise<void> {
  await setStateBoolean(STATE_PARSING_IN_PROGRESS, true);
}

/**
 * Check if parsing is in progress
 */
export async function isParsingInProgress(): Promise<boolean> {
  return isStateTrue(STATE_PARSING_IN_PROGRESS);
}

/**
 * Clear parsing in progress flag
 */
export async function clearParsingInProgress(): Promise<void> {
  await setStateBoolean(STATE_PARSING_IN_PROGRESS, false);
}

/**
 * Set last sync completed timestamp
 */
export async function setLastSyncCompleted(timestamp: number): Promise<void> {
  await setState(STATE_LAST_SYNC_COMPLETED, timestamp.toString());
}

/**
 * Get last sync completed timestamp
 */
export async function getLastSyncCompleted(): Promise<number | null> {
  const value = await getState(STATE_LAST_SYNC_COMPLETED);
  return value ? parseInt(value, 10) : null;
}

/**
 * Delete a state key
 */
export async function deleteState(key: string): Promise<void> {
  await sql`DELETE FROM data_state WHERE key = ${key}`;
}

/**
 * Clear all state
 */
export async function clearAllState(): Promise<void> {
  await sql`DELETE FROM data_state`;
}
