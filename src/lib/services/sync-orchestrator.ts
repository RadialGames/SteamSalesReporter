// Sync orchestrator for coordinating multi-key Steam sales data synchronization
// Uses a 3-phase approach: (1) discover dates, (2) populate data, (3) compute aggregates

import type { ApiKeyInfo } from './types';
import type { SyncTask } from './sync-tasks';
import { services, syncTaskService } from './index';
import { computeAndStoreAggregates } from '$lib/db/dexie';
import { fetchSalesForDate, SyncCancelledError } from './steam-api-client';
import { saveSalesWithOverwrite } from './sync-service';

export { SyncCancelledError };

// Number of tasks to process in parallel
const PARALLEL_BATCH_SIZE = 3;

// Progress phases
export type SyncPhase =
  | 'discovery'
  | 'populate'
  | 'aggregates'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface SyncProgress {
  phase: SyncPhase;
  message: string;
  // Discovery phase progress
  currentApiKey?: number;
  totalApiKeys?: number;
  discoveredDates?: number;
  // Populate phase progress
  completedTasks?: number;
  totalTasks?: number;
  currentDate?: string;
  recordsFetched?: number;
  // Per-key breakdown
  keySegments?: KeySegment[];
  // Error info
  error?: string;
}

export interface KeySegment {
  keyId: string;
  keyName: string;
  pendingTasks: number;
}

export interface SyncCallbacks {
  onProgress: (progress: SyncProgress) => void;
  getAbortSignal: () => AbortSignal | undefined;
}

export interface SyncResult {
  totalRecords: number;
  totalTasks: number;
}

/**
 * Phase 1: Discovery
 * - For each API key, call GetChangedDatesForPartner
 * - Create TODO entries in the database
 * - Save highwatermark immediately
 * - Count total TODO items
 */
async function discoverChangedDates(
  apiKeys: ApiKeyInfo[],
  callbacks: SyncCallbacks
): Promise<{ totalDates: number; keySegments: KeySegment[] }> {
  let totalDates = 0;
  const keySegments: KeySegment[] = [];

  for (let i = 0; i < apiKeys.length; i++) {
    const keyInfo = apiKeys[i];

    // Check if cancelled
    if (callbacks.getAbortSignal()?.aborted) {
      throw new SyncCancelledError();
    }

    callbacks.onProgress({
      phase: 'discovery',
      message: `Checking API key ${i + 1} of ${apiKeys.length}...`,
      currentApiKey: i + 1,
      totalApiKeys: apiKeys.length,
      discoveredDates: totalDates,
    });

    // Get the actual API key
    const apiKey = await services.getApiKey(keyInfo.id);
    if (!apiKey) continue;

    // Call GetChangedDatesForPartner
    const { dates, newHighwatermark } = await services.getChangedDates(apiKey, keyInfo.id);

    if (dates.length > 0) {
      // Create TODO entries in the database
      // This also deletes existing sales data for these dates
      await syncTaskService.createSyncTasks(keyInfo.id, dates);

      // Save highwatermark immediately after creating tasks
      await services.setHighwatermark(keyInfo.id, newHighwatermark);

      totalDates += dates.length;
    }

    const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
    keySegments.push({
      keyId: keyInfo.id,
      keyName,
      pendingTasks: dates.length,
    });

    callbacks.onProgress({
      phase: 'discovery',
      message: `Found ${dates.length} dates for ${keyName}`,
      currentApiKey: i + 1,
      totalApiKeys: apiKeys.length,
      discoveredDates: totalDates,
      keySegments: [...keySegments],
    });
  }

  return { totalDates, keySegments };
}

/**
 * Process a single task: fetch all sales data for a date
 */
async function processTask(task: SyncTask, apiKey: string, signal?: AbortSignal): Promise<number> {
  // Fetch all sales for this date (handles pagination internally)
  const sales = await fetchSalesForDate(apiKey, task.apiKeyId, task.date, signal);

  // Save to database
  if (sales.length > 0) {
    await saveSalesWithOverwrite(sales, task.apiKeyId);
  }

  return sales.length;
}

/**
 * Phase 2: Populate Data
 * - Get all pending tasks from database
 * - Process in parallel batches
 * - Mark as done after completion
 */
async function populateData(
  keySegments: KeySegment[],
  callbacks: SyncCallbacks
): Promise<{ totalRecords: number; totalTasks: number }> {
  // Get all pending tasks
  const allTasks = await syncTaskService.getPendingTasks();

  if (allTasks.length === 0) {
    return { totalRecords: 0, totalTasks: 0 };
  }

  const totalTasks = allTasks.length;
  let completedTasks = 0;
  let totalRecords = 0;

  // Build a map of apiKeyId -> apiKey for quick lookup
  const apiKeyMap = new Map<string, string>();
  for (const segment of keySegments) {
    const apiKey = await services.getApiKey(segment.keyId);
    if (apiKey) {
      apiKeyMap.set(segment.keyId, apiKey);
    }
  }

  // Process tasks in parallel batches
  for (let i = 0; i < allTasks.length; i += PARALLEL_BATCH_SIZE) {
    // Check if cancelled
    if (callbacks.getAbortSignal()?.aborted) {
      throw new SyncCancelledError();
    }

    const batch = allTasks.slice(i, i + PARALLEL_BATCH_SIZE);

    // Mark all tasks in batch as in_progress
    await Promise.all(batch.map((task) => syncTaskService.markTaskInProgress(task.id)));

    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (task) => {
        const apiKey = apiKeyMap.get(task.apiKeyId);
        if (!apiKey) {
          console.warn(`No API key found for task ${task.id}`);
          return { task, records: 0 };
        }

        try {
          const records = await processTask(task, apiKey, callbacks.getAbortSignal());
          return { task, records };
        } catch (err) {
          if (err instanceof SyncCancelledError) {
            throw err;
          }
          console.error(`Error processing task ${task.id}:`, err);
          return { task, records: 0 };
        }
      })
    );

    // Mark tasks as done and update progress
    for (const { task, records } of results) {
      await syncTaskService.markTaskDone(task.id);
      totalRecords += records;
      completedTasks++;
    }

    // Update progress
    const lastTask = batch[batch.length - 1];
    callbacks.onProgress({
      phase: 'populate',
      message: `Fetching sales data...`,
      completedTasks,
      totalTasks,
      currentDate: lastTask.date,
      recordsFetched: totalRecords,
      keySegments,
    });

    // Yield to UI
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { totalRecords, totalTasks };
}

/**
 * Phase 3: Compute Aggregates
 */
async function computeAggregates(
  totalRecords: number,
  keySegments: KeySegment[],
  callbacks: SyncCallbacks
): Promise<void> {
  if (totalRecords === 0) return;

  callbacks.onProgress({
    phase: 'aggregates',
    message: 'Computing aggregates for faster loading...',
    recordsFetched: totalRecords,
    keySegments,
  });

  await computeAndStoreAggregates((message, progress) => {
    callbacks.onProgress({
      phase: 'aggregates',
      message,
      completedTasks: progress,
      totalTasks: 100,
      recordsFetched: totalRecords,
      keySegments,
    });
  });
}

/**
 * Run the full sync process
 */
export async function runSync(
  apiKeys: ApiKeyInfo[],
  callbacks: SyncCallbacks
): Promise<SyncResult> {
  // Phase 1: Discovery
  callbacks.onProgress({
    phase: 'discovery',
    message: 'Checking for updates across all API keys...',
    currentApiKey: 0,
    totalApiKeys: apiKeys.length,
    discoveredDates: 0,
  });

  const { keySegments } = await discoverChangedDates(apiKeys, callbacks);

  // Also count any existing pending tasks from previous incomplete syncs
  const existingPendingCount = await syncTaskService.countAllPendingTasks();

  // If no tasks to process, we're done
  if (existingPendingCount === 0) {
    callbacks.onProgress({
      phase: 'complete',
      message: 'Already up to date!',
      completedTasks: 0,
      totalTasks: 0,
      recordsFetched: 0,
    });
    return { totalRecords: 0, totalTasks: 0 };
  }

  // Update keySegments with actual pending task counts
  const pendingCounts = await syncTaskService.countPendingTasks();
  for (const segment of keySegments) {
    segment.pendingTasks = pendingCounts.get(segment.keyId) || 0;
  }

  // Phase 2: Populate Data
  callbacks.onProgress({
    phase: 'populate',
    message: 'Starting data fetch...',
    completedTasks: 0,
    totalTasks: existingPendingCount,
    recordsFetched: 0,
    keySegments,
  });

  const { totalRecords, totalTasks } = await populateData(keySegments, callbacks);

  // Phase 3: Compute Aggregates
  await computeAggregates(totalRecords, keySegments, callbacks);

  // Clean up completed tasks
  await syncTaskService.clearCompletedTasks();

  // Done
  callbacks.onProgress({
    phase: 'complete',
    message: `Sync complete! Processed ${totalRecords.toLocaleString()} records`,
    completedTasks: totalTasks,
    totalTasks,
    recordsFetched: totalRecords,
    keySegments,
  });

  return { totalRecords, totalTasks };
}

/**
 * Resume a previously interrupted sync
 * Processes any remaining pending tasks
 */
export async function resumeSync(
  apiKeys: ApiKeyInfo[],
  callbacks: SyncCallbacks
): Promise<SyncResult> {
  // Build key segments from API keys
  const keySegments: KeySegment[] = [];
  const pendingCounts = await syncTaskService.countPendingTasks();

  for (const keyInfo of apiKeys) {
    const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
    keySegments.push({
      keyId: keyInfo.id,
      keyName,
      pendingTasks: pendingCounts.get(keyInfo.id) || 0,
    });
  }

  const totalPending = await syncTaskService.countAllPendingTasks();

  if (totalPending === 0) {
    callbacks.onProgress({
      phase: 'complete',
      message: 'No pending tasks to resume',
      completedTasks: 0,
      totalTasks: 0,
      recordsFetched: 0,
    });
    return { totalRecords: 0, totalTasks: 0 };
  }

  // Go straight to populate phase
  callbacks.onProgress({
    phase: 'populate',
    message: `Resuming sync with ${totalPending} pending tasks...`,
    completedTasks: 0,
    totalTasks: totalPending,
    recordsFetched: 0,
    keySegments,
  });

  const { totalRecords, totalTasks } = await populateData(keySegments, callbacks);

  // Phase 3: Compute Aggregates
  await computeAggregates(totalRecords, keySegments, callbacks);

  // Clean up completed tasks
  await syncTaskService.clearCompletedTasks();

  // Done
  callbacks.onProgress({
    phase: 'complete',
    message: `Sync complete! Processed ${totalRecords.toLocaleString()} records`,
    completedTasks: totalTasks,
    totalTasks,
    recordsFetched: totalRecords,
    keySegments,
  });

  return { totalRecords, totalTasks };
}

/**
 * Check if an error represents a cancellation
 */
export function isCancellationError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'SyncCancelledError' ||
      err.name === 'AbortError' ||
      err.message === 'SyncCancelledError')
  );
}

/**
 * Check if there are pending tasks from a previous incomplete sync
 */
export async function hasPendingTasks(): Promise<boolean> {
  const count = await syncTaskService.countAllPendingTasks();
  return count > 0;
}

/**
 * Get the count of pending tasks
 */
export async function getPendingTaskCount(): Promise<number> {
  return syncTaskService.countAllPendingTasks();
}
