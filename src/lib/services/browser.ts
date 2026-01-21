// Browser-mode service implementation
// Orchestrates API key storage, Steam API client, and sync services
// Uses Vite proxy for API calls, SQLite for storage, localStorage for settings

import type {
  SalesService,
  SalesRecord,
  Filters,
  ChangedDatesResult,
  DataProgressCallback,
} from './types';
import type { SyncTask, SyncTaskService } from './sync-tasks';
import { createTaskId } from './sync-tasks';
import { getParsedRecords, deleteParsedRecordsForApiKey } from '$lib/db/parsed-data';
import { markAggregatesDirty, markDisplayDirty } from '$lib/db/data-state';
import { processDataAfterDeletion } from '$lib/db/data-processor';
import { wipeAllData, wipeProcessedData, sql, batch } from '$lib/db/sqlite';
import { deleteRawDataForApiKey } from '$lib/db/raw-data';

// Re-export modules for direct access if needed
export * from './api-key-storage';
export { SyncCancelledError } from './sync-service';

// Import from split modules
import {
  getAllApiKeys,
  getApiKey,
  addApiKey,
  updateApiKeyName,
  deleteApiKey,
  getHighwatermark,
  setHighwatermark,
  clearHighwatermark,
} from './api-key-storage';

import { fetchChangedDates } from './steam-api-client';
import { fetchSalesData } from './sync-service';

export const browserServices: SalesService = {
  // ============================================================================
  // Multi-key API key management (delegated to api-key-storage module)
  // ============================================================================

  getAllApiKeys,
  getApiKey,
  addApiKey,
  updateApiKeyName,
  deleteApiKey,

  // ============================================================================
  // Data operations
  // ============================================================================

  async getChangedDates(apiKey: string, apiKeyId: string): Promise<ChangedDatesResult> {
    const storedHighwatermark = await getHighwatermark(apiKeyId);
    const result = await fetchChangedDates(apiKey, storedHighwatermark);
    return {
      dates: result.dates,
      newHighwatermark: result.newHighwatermark,
    };
  },

  fetchSalesData,

  async getSalesFromDb(filters: Filters): Promise<SalesRecord[]> {
    // Use parsed_sales table with pagination for large datasets
    // For now, get first page - callers should use pagination for large datasets
    const result = await getParsedRecords(1, 10000, filters);
    return result.data;
  },

  async saveSalesData(_data: SalesRecord[], _apiKeyId: string): Promise<void> {
    // Note: This method is deprecated in the new architecture
    // Data should be stored via the raw -> parse -> aggregate pipeline
    // Keeping for backward compatibility but it should not be used
    console.warn('saveSalesData is deprecated - use raw -> parse pipeline instead');
    // Mark aggregates dirty if data is saved this way
    await markAggregatesDirty();
  },

  // ============================================================================
  // Per-key highwatermark management (delegated to api-key-storage module)
  // ============================================================================

  getHighwatermark,
  setHighwatermark,

  // ============================================================================
  // Data management
  // ============================================================================

  async clearAllData(onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Wiping all sales data...', 10);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Wipe all sales data from database (preserves API keys)
    await wipeAllData();

    onProgress?.('Clearing highwatermarks...', 50);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear highwatermarks for all keys (so they can re-sync from the beginning)
    // But preserve the API keys themselves
    const keys = await getAllApiKeys();
    for (const key of keys) {
      await clearHighwatermark(key.id);
    }

    // Mark display cache as dirty so it gets recomputed (will result in empty data)
    await markDisplayDirty();
    await markAggregatesDirty();

    onProgress?.('Complete!', 100);
  },

  async clearProcessedData(onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Wiping processed data (keeping raw)...', 10);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Wipe processed data but keep raw API responses
    await wipeProcessedData();

    onProgress?.('Resetting raw data for reprocessing...', 70);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Mark dirty flags so data gets reprocessed on next refresh
    await markDisplayDirty();
    await markAggregatesDirty();

    onProgress?.('Complete!', 100);
  },

  async clearDataForKey(apiKeyId: string, onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Counting records to delete...', 5);

    // Yield to let UI update
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Delete parsed records for this API key
    onProgress?.('Deleting records...', 10);
    const deletedCount = await deleteParsedRecordsForApiKey(apiKeyId);
    onProgress?.(`Deleted ${deletedCount.toLocaleString()} records`, 20);

    // Delete raw data for this API key
    await deleteRawDataForApiKey(apiKeyId);

    // Reset highwatermark for this key
    await clearHighwatermark(apiKeyId);
    onProgress?.('Cleared highwatermark', 30);

    // Mark aggregates and display cache as dirty
    await markAggregatesDirty();
    await markDisplayDirty();

    // Process data after deletion (recomputes caches or clears them if empty)
    await processDataAfterDeletion({
      onProgress: (message, progress) => {
        // Map progress (0-100) to 35-100 range
        const mappedProgress = 35 + Math.round(progress * 0.65);
        onProgress?.(message, mappedProgress);
      },
    });
  },

  async getExistingDates(apiKeyId: string): Promise<Set<string>> {
    // Get unique dates for this specific API key from parsed_sales using SQL
    const results = (await sql`
      SELECT DISTINCT date FROM parsed_sales WHERE api_key_id = ${apiKeyId}
    `) as { date: string }[];

    return new Set(results.map((r) => r.date));
  },
};

// ============================================================================
// Sync Task Service (Browser/SQLite implementation)
// ============================================================================

export const browserSyncTaskService: SyncTaskService = {
  async createSyncTasks(apiKeyId: string, dates: string[]): Promise<void> {
    const now = Date.now();

    // Delete existing parsed sales for these dates and insert sync tasks in batch
    if (dates.length > 0) {
      await batch((batchSql) => [
        // Delete existing parsed sales for these dates
        ...dates.map(
          (date) => batchSql`
          DELETE FROM parsed_sales WHERE api_key_id = ${apiKeyId} AND date = ${date}
        `
        ),
        // Insert sync tasks
        ...dates.map((date) => {
          const id = createTaskId(apiKeyId, date);
          return batchSql`
            INSERT OR REPLACE INTO sync_tasks (id, api_key_id, date, status, created_at)
            VALUES (${id}, ${apiKeyId}, ${date}, 'todo', ${now})
          `;
        }),
      ]);

      // Mark aggregates dirty after deletion
      await markAggregatesDirty();
    }
  },

  async getPendingTasks(): Promise<SyncTask[]> {
    const results = (await sql`
      SELECT id, api_key_id, date, status, created_at, completed_at 
      FROM sync_tasks 
      WHERE status IN ('todo', 'in_progress')
      ORDER BY date
    `) as {
      id: string;
      api_key_id: string;
      date: string;
      status: 'todo' | 'in_progress' | 'done';
      created_at: number;
      completed_at?: number;
    }[];

    return results.map((r) => ({
      id: r.id,
      apiKeyId: r.api_key_id,
      date: r.date,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  },

  async getPendingTasksForKey(apiKeyId: string): Promise<SyncTask[]> {
    const results = (await sql`
      SELECT id, api_key_id, date, status, created_at, completed_at 
      FROM sync_tasks 
      WHERE api_key_id = ${apiKeyId} AND status IN ('todo', 'in_progress')
      ORDER BY date
    `) as {
      id: string;
      api_key_id: string;
      date: string;
      status: 'todo' | 'in_progress' | 'done';
      created_at: number;
      completed_at?: number;
    }[];

    return results.map((r) => ({
      id: r.id,
      apiKeyId: r.api_key_id,
      date: r.date,
      status: r.status,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));
  },

  async markTaskInProgress(taskId: string): Promise<void> {
    await sql`UPDATE sync_tasks SET status = 'in_progress' WHERE id = ${taskId}`;
  },

  async markTaskDone(taskId: string): Promise<void> {
    const now = Date.now();
    await sql`UPDATE sync_tasks SET status = 'done', completed_at = ${now} WHERE id = ${taskId}`;
  },

  async countPendingTasks(): Promise<Map<string, number>> {
    const results = (await sql`
      SELECT api_key_id, COUNT(*) as count 
      FROM sync_tasks 
      WHERE status IN ('todo', 'in_progress')
      GROUP BY api_key_id
    `) as { api_key_id: string; count: number }[];

    const counts = new Map<string, number>();
    for (const r of results) {
      counts.set(r.api_key_id, r.count);
    }
    return counts;
  },

  async countAllPendingTasks(): Promise<number> {
    const result = (await sql`
      SELECT COUNT(*) as count FROM sync_tasks WHERE status IN ('todo', 'in_progress')
    `) as { count: number }[];
    return result[0]?.count ?? 0;
  },

  async resetInProgressTasks(): Promise<number> {
    // Get count first
    const countResult = (await sql`
      SELECT COUNT(*) as count FROM sync_tasks WHERE status = 'in_progress'
    `) as { count: number }[];
    const count = countResult[0]?.count ?? 0;

    // Reset status
    await sql`UPDATE sync_tasks SET status = 'todo' WHERE status = 'in_progress'`;

    return count;
  },

  async clearCompletedTasks(): Promise<void> {
    await sql`DELETE FROM sync_tasks WHERE status = 'done'`;
  },

  async clearAllSyncTasks(): Promise<void> {
    await sql`DELETE FROM sync_tasks`;
  },

  async deleteSyncTasksForKey(apiKeyId: string): Promise<void> {
    await sql`DELETE FROM sync_tasks WHERE api_key_id = ${apiKeyId}`;
  },

  async clearSalesForDate(apiKeyId: string, date: string): Promise<void> {
    await sql`DELETE FROM parsed_sales WHERE api_key_id = ${apiKeyId} AND date = ${date}`;
    // Mark aggregates dirty after deletion
    await markAggregatesDirty();
  },
};
