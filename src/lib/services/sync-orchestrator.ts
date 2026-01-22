// Sync orchestrator for coordinating multi-key Steam sales data synchronization
// Uses a 3-phase approach: (1) discover dates, (2) populate data, (3) compute aggregates

import type { ApiKeyInfo, SalesService, SalesRecord } from './types';
import type { SyncTaskService } from './sync-tasks';
import { processDataForcefully } from '$lib/db/data-processor';
import { fetchSalesForDate, SyncCancelledError } from './steam-api-client';
import { storeParsedRecords } from '$lib/db/parsed-data';
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

/**
 * Simple mutex for atomic operations
 * Ensures only one async operation can proceed at a time
 */
class Mutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
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
      this.locked = false;
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
   * - Collect highwatermarks to save after successful completion
   * - Count total TODO items
   */
  private async discoverChangedDates(
    apiKeys: ApiKeyInfo[],
    callbacks: SyncCallbacks
  ): Promise<{
    totalDates: number;
    keySegments: KeySegment[];
    pendingHighwatermarks: Map<string, number>;
  }> {
    let totalDates = 0;
    const keySegments: KeySegment[] = [];
    const pendingHighwatermarks = new Map<string, number>();

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

        // Store highwatermark to save after successful completion
        pendingHighwatermarks.set(keyInfo.id, newHighwatermark);

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

    return { totalDates, keySegments, pendingHighwatermarks };
  }

  /**
   * Phase 2: Populate Data - Progress-First Architecture
   *
   * Progress updates are based on HTTP fetch completions (fast, ~100ms each),
   * while DB writes happen asynchronously in the background.
   *
   * This gives smooth progress updates regardless of DB write speed.
   *
   * 1. HTTP Worker Pool (controlled by semaphore):
   *    - Fetches data, parses JSON in memory
   *    - Updates progress immediately on each completion
   *    - Queues records for DB writing
   *    - Uses mutex for atomic task assignment
   *
   * 2. DB Writer (background with backpressure):
   *    - Batches records and writes to SQLite
   *    - Does NOT block progress updates
   *    - Pauses HTTP fetches when queue exceeds MAX_QUEUE_SIZE
   *    - Waits for completion at the end
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
    const sortedTasks = [...allTasks].sort((a, b) => {
      if (a.apiKeyId !== b.apiKeyId) {
        return a.apiKeyId.localeCompare(b.apiKeyId);
      }
      return a.date.localeCompare(b.date);
    });

    const totalTasks = sortedTasks.length;

    // Build a map of apiKeyId -> apiKey for quick lookup
    const apiKeyMap = new Map<string, string>();
    for (const segment of keySegments) {
      const apiKey = await this.services.getApiKey(segment.keyId);
      if (apiKey) {
        apiKeyMap.set(segment.keyId, apiKey);
      }
    }

    // === Constants for backpressure ===
    const MAX_QUEUE_SIZE = 1000; // Pause HTTP fetches when queue exceeds this
    const FLUSH_THRESHOLD = 200; // Trigger flush when queue reaches this

    // === Shared State ===
    let completedHttpTasks = 0;
    let totalRecordsFetched = 0;
    let taskIndex = 0;
    let cancelled = false;

    // Mutex for atomic task index access
    const taskMutex = new Mutex();

    // Queue for DB writes - records accumulate here while HTTP fetches continue
    const dbWriteQueue: (SalesRecord & { id: string; apiKeyId: string })[] = [];
    let dbWriteInProgress = false;
    let dbWritePromise: Promise<void> | null = null;
    let totalRecordsWritten = 0;

    // Backpressure: waiters that are blocked due to full queue
    const queueWaiters: Array<() => void> = [];

    // Signal that queue has space
    const signalQueueHasSpace = (): void => {
      while (queueWaiters.length > 0 && dbWriteQueue.length < MAX_QUEUE_SIZE) {
        const waiter = queueWaiters.shift();
        if (waiter) waiter();
      }
    };

    // Wait for queue to have space
    const waitForQueueSpace = async (): Promise<void> => {
      if (dbWriteQueue.length < MAX_QUEUE_SIZE) return;

      return new Promise<void>((resolve) => {
        queueWaiters.push(resolve);
      });
    };

    // === DB Writer Function (non-blocking) ===
    const flushDbQueue = async (): Promise<void> => {
      if (dbWriteInProgress || dbWriteQueue.length === 0) return;

      dbWriteInProgress = true;

      // Take all records from queue atomically
      const recordsToWrite = dbWriteQueue.splice(0, dbWriteQueue.length);

      // Signal that queue now has space (unblock waiting HTTP workers)
      signalQueueHasSpace();

      try {
        await storeParsedRecords(recordsToWrite);
        totalRecordsWritten += recordsToWrite.length;
      } catch (err) {
        console.error('Error writing records to DB:', err);
      }

      dbWriteInProgress = false;

      // If more records accumulated while we were writing, flush again
      if (dbWriteQueue.length > 0) {
        dbWritePromise = flushDbQueue();
      }
    };

    // === Atomic task acquisition ===
    const acquireNextTask = async (): Promise<{
      index: number;
      task: (typeof sortedTasks)[0];
    } | null> => {
      await taskMutex.acquire();
      try {
        if (taskIndex >= sortedTasks.length || cancelled) {
          return null;
        }
        const index = taskIndex++;
        return { index, task: sortedTasks[index] };
      } finally {
        taskMutex.release();
      }
    };

    // === HTTP Worker Function (uses semaphore for concurrency control) ===
    const processOneTask = async (): Promise<void> => {
      while (!cancelled) {
        // Acquire semaphore slot for HTTP request
        await this.httpSemaphore.acquire();

        try {
          // Atomically get next task
          const taskData = await acquireNextTask();
          if (!taskData) {
            return; // No more tasks
          }

          const { task } = taskData;

          const apiKey = apiKeyMap.get(task.apiKeyId);
          if (!apiKey) {
            completedHttpTasks++;
            continue;
          }

          // Check cancellation
          if (callbacks.getAbortSignal()?.aborted) {
            cancelled = true;
            return;
          }

          // Wait for queue space (backpressure)
          await waitForQueueSpace();

          // HTTP fetch (fast, ~100ms) - fetchSalesForDate now stores raw responses internally
          const salesRecords = await fetchSalesForDate(
            apiKey,
            task.apiKeyId,
            task.date,
            callbacks.getAbortSignal()
          );

          // Build records and add to DB write queue
          for (const record of salesRecords) {
            if (record.id) {
              dbWriteQueue.push({
                ...record,
                id: record.id as string,
                apiKeyId: task.apiKeyId,
                date: record.date,
              });
            }
          }

          totalRecordsFetched += salesRecords.length;
          completedHttpTasks++;

          // Update progress immediately (based on HTTP completion, not DB)
          callbacks.onProgress({
            phase: 'populate',
            message: `Fetching sales data...`,
            completedTasks: completedHttpTasks,
            totalTasks,
            currentDate: task.date,
            recordsFetched: totalRecordsFetched,
            keySegments,
          });

          // Trigger DB write if queue is getting large (fire and forget)
          if (dbWriteQueue.length >= FLUSH_THRESHOLD && !dbWriteInProgress) {
            dbWritePromise = flushDbQueue();
          }
        } catch (err) {
          if (err instanceof SyncCancelledError) {
            cancelled = true;
            return;
          }
          completedHttpTasks++;
          // Update progress even on error (but don't mark as success)
          callbacks.onProgress({
            phase: 'populate',
            message: `Fetching sales data...`,
            completedTasks: completedHttpTasks,
            totalTasks,
            currentDate: 'error',
            recordsFetched: totalRecordsFetched,
            keySegments,
          });
        } finally {
          // Always release semaphore
          this.httpSemaphore.release();
        }
      }
    };

    // === Launch HTTP workers ===
    const httpWorkerPromises: Promise<void>[] = [];
    const numWorkers = Math.min(this.maxConcurrentHttpRequests, sortedTasks.length);

    for (let i = 0; i < numWorkers; i++) {
      httpWorkerPromises.push(processOneTask());
    }

    // Wait for all HTTP workers to finish
    await Promise.all(httpWorkerPromises);

    // Check if we were cancelled
    if (cancelled) {
      throw new SyncCancelledError();
    }

    // === Final DB flush ===
    // Wait for any in-progress DB write to complete
    if (dbWritePromise) {
      await dbWritePromise;
    }

    // Flush remaining records
    if (dbWriteQueue.length > 0) {
      // Update progress to show we're saving
      callbacks.onProgress({
        phase: 'populate',
        message: `Saving ${dbWriteQueue.length} records to database...`,
        completedTasks: completedHttpTasks,
        totalTasks,
        currentDate: 'finalizing',
        recordsFetched: totalRecordsFetched,
        keySegments,
      });

      await flushDbQueue();

      // Wait for final write to complete
      if (dbWritePromise) {
        await dbWritePromise;
      }
    }

    // Clean up: clear all sync tasks
    await this.syncTaskService.clearAllSyncTasks();

    return { totalRecords: totalRecordsWritten, totalTasks };
  }

  /**
   * Phase 3: Compute Aggregates and Display Cache
   * Uses the centralized data processor for consistent handling
   */
  private async computeAggregates(
    totalRecords: number,
    keySegments: KeySegment[],
    callbacks: SyncCallbacks
  ): Promise<void> {
    callbacks.onProgress({
      phase: 'aggregates',
      message: 'Computing aggregates for faster loading...',
      recordsFetched: totalRecords,
      keySegments,
    });

    // Use centralized processor - handles all parsing, aggregates, and display cache
    await processDataForcefully({
      onProgress: (message, progress) => {
        callbacks.onProgress({
          phase: 'aggregates',
          message,
          completedTasks: progress,
          totalTasks: 100,
          recordsFetched: totalRecords,
          keySegments,
        });
      },
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

    const { keySegments, pendingHighwatermarks } = await this.discoverChangedDates(
      apiKeys,
      callbacks
    );

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

    // Save highwatermarks now that sync completed successfully
    for (const [apiKeyId, highwatermark] of pendingHighwatermarks) {
      await this.services.setHighwatermark(apiKeyId, highwatermark);
    }

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
