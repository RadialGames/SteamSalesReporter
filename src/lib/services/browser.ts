// Browser-mode service implementation
// Orchestrates API key storage, Steam API client, and sync services
// Uses Vite proxy for API calls, IndexedDB for storage, localStorage for settings

import type {
  SalesService,
  SalesRecord,
  Filters,
  ChangedDatesResult,
  DataProgressCallback,
} from './types';
import type { SyncTask, SyncTaskService } from './sync-tasks';
import { createTaskId } from './sync-tasks';
import { db, computeAndStoreAggregates, clearAggregates } from '$lib/db/dexie';

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
  clearAllApiKeyStorage,
  API_KEY_VALUES_PREFIX,
} from './api-key-storage';

import { fetchChangedDates } from './steam-api-client';
import { fetchSalesData, saveSalesWithOverwrite } from './sync-service';

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
    // For unfiltered queries on large datasets, consider using pagination
    // This method still loads all data but uses more efficient queries
    let collection = db.sales.toCollection();

    // Use indexed queries where possible
    if (filters.appIds && filters.appIds.length === 1) {
      // Single app - use index
      collection = db.sales.where('appId').equals(filters.appIds[0]);
    } else if (filters.startDate && filters.endDate) {
      collection = db.sales.where('date').between(filters.startDate, filters.endDate, true, true);
    } else if (filters.startDate) {
      collection = db.sales.where('date').aboveOrEqual(filters.startDate);
    } else if (filters.endDate) {
      collection = db.sales.where('date').belowOrEqual(filters.endDate);
    }

    let results = await collection.toArray();

    // Apply remaining filters in memory
    if (filters.countryCode) {
      results = results.filter((r) => r.countryCode === filters.countryCode);
    }
    // Multi-select app filter (if we didn't use index or have multiple apps)
    if (filters.appIds && filters.appIds.length > 1) {
      const appIdSet = new Set(filters.appIds);
      results = results.filter((r) => appIdSet.has(r.appId));
    }
    // Date filters if we used appIds index instead
    if (filters.appIds && filters.appIds.length === 1) {
      if (filters.startDate) {
        results = results.filter((r) => r.date >= filters.startDate!);
      }
      if (filters.endDate) {
        results = results.filter((r) => r.date <= filters.endDate!);
      }
    }

    return results;
  },

  async saveSalesData(data: SalesRecord[], apiKeyId: string): Promise<void> {
    // Tag all records with the API key ID
    const taggedData = data.map((record) => ({ ...record, apiKeyId }));
    // Look up existing records by composite key to ensure overwrites instead of duplicates
    await saveSalesWithOverwrite(taggedData, apiKeyId);
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
    onProgress?.('Clearing sales records...', 10);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear all sales records
    await db.sales.clear();

    onProgress?.('Clearing sync metadata...', 30);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear sync metadata
    await db.syncMeta.clear();

    onProgress?.('Clearing aggregates...', 50);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear pre-computed aggregates
    await clearAggregates();

    onProgress?.('Clearing API keys...', 70);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Clear all API keys and their data from localStorage
    const keys = await getAllApiKeys();
    for (const key of keys) {
      localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${key.id}`);
      clearHighwatermark(key.id);
    }
    clearAllApiKeyStorage();

    onProgress?.('Complete!', 100);
  },

  async clearDataForKey(apiKeyId: string, onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Counting records to delete...', 5);

    // Yield to let UI update
    await new Promise((resolve) => setTimeout(resolve, 0));

    // First count records for this API key
    const recordsToDelete = await db.sales.where('apiKeyId').equals(apiKeyId).count();

    if (recordsToDelete === 0) {
      onProgress?.('No records to delete', 40);
    } else {
      onProgress?.(`Found ${recordsToDelete.toLocaleString()} records to delete...`, 8);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Get record IDs in batches for progress feedback
      const COLLECT_BATCH_SIZE = 10000;
      const recordIds: string[] = [];
      let offset = 0;

      while (offset < recordsToDelete) {
        const batch = await db.sales
          .where('apiKeyId')
          .equals(apiKeyId)
          .offset(offset)
          .limit(COLLECT_BATCH_SIZE)
          .toArray();

        for (const record of batch) {
          if (record.id !== undefined) {
            // IDs are strings (unique key hashes) in the current schema
            recordIds.push(String(record.id));
          }
        }

        offset += batch.length;

        // Map collection progress to range 8-15%
        const collectProgress = 8 + Math.round((offset / recordsToDelete) * 7);
        onProgress?.(
          `Collecting records... ${offset.toLocaleString()} / ${recordsToDelete.toLocaleString()}`,
          collectProgress
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        if (batch.length < COLLECT_BATCH_SIZE) break;
      }

      // Delete in batches with progress
      const DELETE_BATCH_SIZE = 5000;
      let deleted = 0;

      for (let i = 0; i < recordIds.length; i += DELETE_BATCH_SIZE) {
        const batch = recordIds.slice(i, i + DELETE_BATCH_SIZE);
        await db.sales.bulkDelete(batch);
        deleted += batch.length;

        // Map deletion progress to range 15-40%
        const deleteProgress = 15 + Math.round((deleted / recordIds.length) * 25);
        onProgress?.(
          `Deleting... ${deleted.toLocaleString()} / ${recordIds.length.toLocaleString()}`,
          deleteProgress
        );

        // Yield to let UI update
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    onProgress?.('Resetting sync state...', 42);

    // Reset highwatermark for this key
    clearHighwatermark(apiKeyId);

    onProgress?.('Clearing aggregates...', 45);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Recompute aggregates
    await clearAggregates();
    const count = await db.sales.count();
    if (count > 0) {
      onProgress?.('Recomputing aggregates...', 50);
      await computeAndStoreAggregates((message, progress) => {
        // Map aggregate progress (0-100) to our range (50-95)
        const mappedProgress = 50 + Math.round(progress * 0.45);
        onProgress?.(message, mappedProgress);
      });
    }

    onProgress?.('Complete!', 100);
  },

  async getExistingDates(apiKeyId: string): Promise<Set<string>> {
    // Get unique dates for this specific API key
    const dates = new Set<string>();
    const records = await db.sales.where('apiKeyId').equals(apiKeyId).toArray();
    for (const record of records) {
      dates.add(record.date);
    }
    return dates;
  },
};

// ============================================================================
// Sync Task Service (Browser/Dexie implementation)
// ============================================================================

export const browserSyncTaskService: SyncTaskService = {
  async createSyncTasks(apiKeyId: string, dates: string[]): Promise<void> {
    const now = Date.now();
    const tasks: SyncTask[] = [];

    for (const date of dates) {
      const taskId = createTaskId(apiKeyId, date);

      // Delete existing sales data for this date and api key
      // Filter by apiKeyId first (indexed), then filter by date
      const recordsToDelete = await db.sales
        .where('apiKeyId')
        .equals(apiKeyId)
        .filter((r) => r.date === date)
        .primaryKeys();
      if (recordsToDelete.length > 0) {
        await db.sales.bulkDelete(recordsToDelete as string[]);
      }

      tasks.push({
        id: taskId,
        apiKeyId,
        date,
        status: 'todo',
        createdAt: now,
      });
    }

    // Bulk put will overwrite existing tasks with same ID
    if (tasks.length > 0) {
      await db.syncTasks.bulkPut(tasks);
    }
  },

  async getPendingTasks(): Promise<SyncTask[]> {
    const tasks = await db.syncTasks.where('status').anyOf(['todo', 'in_progress']).sortBy('date');
    return tasks;
  },

  async getPendingTasksForKey(apiKeyId: string): Promise<SyncTask[]> {
    const tasks = await db.syncTasks
      .where('[apiKeyId+status]')
      .anyOf([
        [apiKeyId, 'todo'],
        [apiKeyId, 'in_progress'],
      ])
      .sortBy('date');
    return tasks;
  },

  async markTaskInProgress(taskId: string): Promise<void> {
    await db.syncTasks.update(taskId, { status: 'in_progress' });
  },

  async markTaskDone(taskId: string): Promise<void> {
    await db.syncTasks.update(taskId, {
      status: 'done',
      completedAt: Date.now(),
    });
  },

  async countPendingTasks(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const tasks = await db.syncTasks.where('status').anyOf(['todo', 'in_progress']).toArray();

    for (const task of tasks) {
      const current = counts.get(task.apiKeyId) || 0;
      counts.set(task.apiKeyId, current + 1);
    }

    return counts;
  },

  async countAllPendingTasks(): Promise<number> {
    return db.syncTasks.where('status').anyOf(['todo', 'in_progress']).count();
  },

  async resetInProgressTasks(): Promise<number> {
    const inProgressTasks = await db.syncTasks.where('status').equals('in_progress').toArray();

    if (inProgressTasks.length > 0) {
      await db.syncTasks.bulkUpdate(
        inProgressTasks.map((task) => ({
          key: task.id,
          changes: { status: 'todo' as const },
        }))
      );
    }

    return inProgressTasks.length;
  },

  async clearCompletedTasks(): Promise<void> {
    await db.syncTasks.where('status').equals('done').delete();
  },

  async deleteSyncTasksForKey(apiKeyId: string): Promise<void> {
    await db.syncTasks.where('apiKeyId').equals(apiKeyId).delete();
  },

  async clearSalesForDate(apiKeyId: string, date: string): Promise<void> {
    const recordsToDelete = await db.sales
      .where('apiKeyId')
      .equals(apiKeyId)
      .filter((r) => r.date === date)
      .primaryKeys();
    if (recordsToDelete.length > 0) {
      await db.sales.bulkDelete(recordsToDelete as string[]);
    }
  },
};
