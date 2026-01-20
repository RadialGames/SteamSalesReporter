// Sync orchestrator for coordinating multi-key Steam sales data synchronization
// Uses a 3-phase approach: (1) discover dates, (2) populate data, (3) compute aggregates

import type { ApiKeyInfo, SalesService } from './types';
import type { SyncTask, SyncTaskService } from './sync-tasks';
import { computeAndStoreAggregates } from '$lib/db/dexie';
import { fetchSalesForDate, SyncCancelledError } from './steam-api-client';
import { saveSalesWithOverwrite } from './sync-service';
import { services as defaultServices, syncTaskService as defaultSyncTaskService } from './index';

export { SyncCancelledError };

/**
 * Simple semaphore to limit concurrent operations
 */
class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(count: number) {
    this.available = count;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    if (this.waiters.length > 0) {
      const next = this.waiters.shift();
      if (next) next();
    } else {
      this.available++;
    }
  }
}

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
 * Sync orchestrator class that coordinates multi-key Steam sales data synchronization.
 * Accepts batch size as a constructor parameter to allow configuration.
 */
export class SyncOrchestrator {
  // Semaphore to limit concurrent HTTP requests (browser connection limits)
  // Most browsers limit to 6-10 concurrent connections per domain
  // Using 8 to stay safely under the limit while allowing good throughput
  private readonly httpSemaphore: Semaphore;

  constructor(
    private readonly services: SalesService,
    private readonly syncTaskService: SyncTaskService,
    private readonly parallelBatchSize: number = 10,
    private readonly maxConcurrentHttpRequests: number = 8
  ) {
    this.httpSemaphore = new Semaphore(maxConcurrentHttpRequests);
  }

  /**
   * Phase 1: Discovery
   * - For each API key, call GetChangedDatesForPartner
   * - Create TODO entries in the database
   * - Save highwatermark immediately
   * - Count total TODO items
   */
  private async discoverChangedDates(
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
      const apiKey = await this.services.getApiKey(keyInfo.id);
      if (!apiKey) continue;

      // Call GetChangedDatesForPartner
      const { dates, newHighwatermark } = await this.services.getChangedDates(apiKey, keyInfo.id);

      if (dates.length > 0) {
        // Create TODO entries in the database
        // This also deletes existing sales data for these dates
        await this.syncTaskService.createSyncTasks(keyInfo.id, dates);

        // Save highwatermark immediately after creating tasks
        await this.services.setHighwatermark(keyInfo.id, newHighwatermark);

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
  private async processTask(task: SyncTask, apiKey: string, signal?: AbortSignal): Promise<number> {
    // Acquire HTTP semaphore to limit concurrent requests
    await this.httpSemaphore.acquire();
    try {
      // Fetch all sales for this date (handles pagination internally)
      const sales = await fetchSalesForDate(apiKey, task.apiKeyId, task.date, signal);

      // Save to database (this can happen concurrently, no semaphore needed)
      if (sales.length > 0) {
        await saveSalesWithOverwrite(sales, task.apiKeyId);
      }

      return sales.length;
    } finally {
      // Always release semaphore, even on error
      this.httpSemaphore.release();
    }
  }

  /**
   * Phase 2: Populate Data
   * - Get all pending tasks from database
   * - Process in parallel batches
   * - Mark as done after completion
   */
  private async populateData(
    keySegments: KeySegment[],
    callbacks: SyncCallbacks
  ): Promise<{ totalRecords: number; totalTasks: number }> {
    // Get all pending tasks
    const allTasks = await this.syncTaskService.getPendingTasks();

    if (allTasks.length === 0) {
      return { totalRecords: 0, totalTasks: 0 };
    }

    // Sort tasks: first by API key, then by date
    // This ensures all tasks for one API key are processed before moving to the next
    const sortedTasks = [...allTasks].sort((a, b) => {
      // Primary sort: by API key ID
      if (a.apiKeyId !== b.apiKeyId) {
        return a.apiKeyId.localeCompare(b.apiKeyId);
      }
      // Secondary sort: by date (chronological)
      return a.date.localeCompare(b.date);
    });

    const totalTasks = sortedTasks.length;
    let completedTasks = 0;
    let totalRecords = 0;

    // Build a map of apiKeyId -> apiKey for quick lookup
    const apiKeyMap = new Map<string, string>();
    for (const segment of keySegments) {
      const apiKey = await this.services.getApiKey(segment.keyId);
      if (apiKey) {
        apiKeyMap.set(segment.keyId, apiKey);
      }
    }

    // Create a queue of pending tasks for the worker pool (already sorted)
    const taskQueue = [...sortedTasks];
    let cancelled = false;

    // Worker function - processes tasks from the queue until empty
    const runWorker = async (workerId: number): Promise<void> => {
      while (taskQueue.length > 0 && !cancelled) {
        // Check if cancelled
        if (callbacks.getAbortSignal()?.aborted) {
          cancelled = true;
          return;
        }

        // Take next task from queue
        const task = taskQueue.shift();
        if (!task) break;

        // Get API key for this task
        const apiKey = apiKeyMap.get(task.apiKeyId);
        if (!apiKey) {
          console.warn(`No API key found for task ${task.id}`);
          completedTasks++;
          callbacks.onProgress({
            phase: 'populate',
            message: `Fetching sales data...`,
            completedTasks,
            totalTasks,
            currentDate: task.date,
            recordsFetched: totalRecords,
            keySegments,
          });
          continue;
        }

        try {
          // Mark task as in_progress
          await this.syncTaskService.markTaskInProgress(task.id);

          // Process the task
          const records = await this.processTask(task, apiKey, callbacks.getAbortSignal());

          // Mark task as done
          await this.syncTaskService.markTaskDone(task.id);

          // Update counters
          totalRecords += records;
          completedTasks++;

          // Update progress immediately
          callbacks.onProgress({
            phase: 'populate',
            message: `Fetching sales data...`,
            completedTasks,
            totalTasks,
            currentDate: task.date,
            recordsFetched: totalRecords,
            keySegments,
          });
        } catch (err) {
          if (err instanceof SyncCancelledError) {
            cancelled = true;
            throw err;
          }
          console.error(`Error processing task ${task.id}:`, err);

          // Still mark as done and update progress on error
          await this.syncTaskService.markTaskDone(task.id);
          completedTasks++;
          callbacks.onProgress({
            phase: 'populate',
            message: `Fetching sales data...`,
            completedTasks,
            totalTasks,
            currentDate: task.date,
            recordsFetched: totalRecords,
            keySegments,
          });
        }
      }
    };

    // Launch up to parallelBatchSize concurrent workers
    const numWorkers = Math.min(this.parallelBatchSize, allTasks.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < numWorkers; i++) {
      workers.push(runWorker(i));
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    // Check if we were cancelled
    if (cancelled) {
      throw new SyncCancelledError();
    }

    return { totalRecords, totalTasks };
  }

  /**
   * Phase 3: Compute Aggregates
   */
  private async computeAggregates(
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
  async runSync(apiKeys: ApiKeyInfo[], callbacks: SyncCallbacks): Promise<SyncResult> {
    // Phase 1: Discovery
    callbacks.onProgress({
      phase: 'discovery',
      message: 'Checking for updates across all API keys...',
      currentApiKey: 0,
      totalApiKeys: apiKeys.length,
      discoveredDates: 0,
    });

    const { keySegments } = await this.discoverChangedDates(apiKeys, callbacks);

    // Also count any existing pending tasks from previous incomplete syncs
    const existingPendingCount = await this.syncTaskService.countAllPendingTasks();

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
    const pendingCounts = await this.syncTaskService.countPendingTasks();
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

    const { totalRecords, totalTasks } = await this.populateData(keySegments, callbacks);

    // Phase 3: Compute Aggregates
    await this.computeAggregates(totalRecords, keySegments, callbacks);

    // Clean up completed tasks
    await this.syncTaskService.clearCompletedTasks();

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
  async resumeSync(apiKeys: ApiKeyInfo[], callbacks: SyncCallbacks): Promise<SyncResult> {
    // Build key segments from API keys
    const keySegments: KeySegment[] = [];
    const pendingCounts = await this.syncTaskService.countPendingTasks();

    for (const keyInfo of apiKeys) {
      const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
      keySegments.push({
        keyId: keyInfo.id,
        keyName,
        pendingTasks: pendingCounts.get(keyInfo.id) || 0,
      });
    }

    const totalPending = await this.syncTaskService.countAllPendingTasks();

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

    const { totalRecords, totalTasks } = await this.populateData(keySegments, callbacks);

    // Phase 3: Compute Aggregates
    await this.computeAggregates(totalRecords, keySegments, callbacks);

    // Clean up completed tasks
    await this.syncTaskService.clearCompletedTasks();

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
   * Check if there are pending tasks from a previous incomplete sync
   */
  async hasPendingTasks(): Promise<boolean> {
    const count = await this.syncTaskService.countAllPendingTasks();
    return count > 0;
  }

  /**
   * Get the count of pending tasks
   */
  async getPendingTaskCount(): Promise<number> {
    return this.syncTaskService.countAllPendingTasks();
  }
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
 * Convenience functions that use a default orchestrator instance.
 * These maintain backward compatibility with existing code.
 */

let defaultOrchestrator: SyncOrchestrator | null = null;

function getDefaultOrchestrator(): SyncOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new SyncOrchestrator(defaultServices, defaultSyncTaskService, 100);
  }
  return defaultOrchestrator;
}

/**
 * @deprecated Use SyncOrchestrator class directly. This function is kept for backward compatibility.
 */
export async function runSync(
  apiKeys: ApiKeyInfo[],
  callbacks: SyncCallbacks
): Promise<SyncResult> {
  return getDefaultOrchestrator().runSync(apiKeys, callbacks);
}

/**
 * @deprecated Use SyncOrchestrator class directly. This function is kept for backward compatibility.
 */
export async function resumeSync(
  apiKeys: ApiKeyInfo[],
  callbacks: SyncCallbacks
): Promise<SyncResult> {
  return getDefaultOrchestrator().resumeSync(apiKeys, callbacks);
}

/**
 * @deprecated Use SyncOrchestrator class directly. This function is kept for backward compatibility.
 */
export async function hasPendingTasks(): Promise<boolean> {
  return getDefaultOrchestrator().hasPendingTasks();
}

/**
 * @deprecated Use SyncOrchestrator class directly. This function is kept for backward compatibility.
 */
export async function getPendingTaskCount(): Promise<number> {
  return getDefaultOrchestrator().getPendingTaskCount();
}
