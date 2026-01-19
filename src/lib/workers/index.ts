/**
 * Worker Manager for Background Aggregation Computations
 *
 * ## Aggregation Strategy Overview
 *
 * This app uses three different approaches for computing aggregations,
 * each optimized for different scenarios:
 *
 * ### 1. Real-time Derived Stores (src/lib/stores/sales.ts)
 * - **When:** Small datasets (<50k records) with active user filtering
 * - **How:** Svelte derived stores recompute on every filter change
 * - **Pros:** Immediate feedback, simple implementation
 * - **Cons:** Blocks UI thread, slow for large datasets
 *
 * ### 2. Web Worker (this file + aggregation.worker.ts)
 * - **When:** Large datasets (>=50k records) during active UI interaction
 * - **How:** Offloads computation to a background thread
 * - **Pros:** Non-blocking UI, handles large datasets
 * - **Cons:** Message passing overhead, async complexity
 *
 * ### 3. Pre-computed IndexedDB Aggregates (src/lib/db/dexie.ts)
 * - **When:** After data sync, for initial load
 * - **How:** Computes once and stores in IndexedDB tables
 * - **Pros:** Instant reads, no recomputation needed
 * - **Cons:** Stale until recomputed, storage overhead
 *
 * ## Threshold Configuration
 *
 * The WORKER_THRESHOLD (50,000 records) determines when to use the worker.
 * Below this threshold, synchronous computation is fast enough.
 * Above this threshold, the worker prevents UI blocking.
 *
 * ## Usage Guidelines
 *
 * - For interactive filtering: Use derived stores (auto-handles small datasets)
 * - For Launch Comparison: Use computeProductGroups() (auto-selects worker/sync)
 * - After data sync: Call computeAndStoreAggregates() in dexie.ts
 * - For initial app load: Read from pre-computed IndexedDB tables
 */

import type {
  SalesRecord,
  Filters,
  DailySummary,
  AppSummary,
  CountrySummary,
} from '$lib/services/types';
import { calculateLaunchDays, type LaunchMetricsResult } from '$lib/utils/launch-metrics';

// Product group type (matches LaunchComparison)
export interface ProductGroup {
  id: number;
  name: string;
  records: SalesRecord[];
  hasRevenue: boolean;
  // Pre-computed launch metrics (computed with plain objects to avoid proxy overhead)
  launchMetrics?: LaunchMetricsResult;
}

export interface AggregatesResult {
  dailySummary: DailySummary[];
  appSummary: AppSummary[];
  countrySummary: CountrySummary[];
  totalStats: {
    totalRevenue: number;
    totalUnits: number;
    totalRecords: number;
    uniqueApps: number;
    uniqueCountries: number;
  };
}

// Progress callback type
export interface WorkerProgress {
  processed: number;
  total: number;
}

export type ProgressCallback = (progress: WorkerProgress) => void;

// Options for worker computations
export interface ComputeOptions {
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

/**
 * Threshold for using Web Worker vs synchronous computation.
 *
 * IMPORTANT: We use a low threshold because Svelte 5's reactive proxies
 * make iteration extremely slow (~0.5ms per record). The Web Worker
 * receives serialized plain objects via postMessage, avoiding proxy overhead.
 *
 * - Below 5k records: Sync computation is acceptable (~500ms with proxy)
 * - Above 5k records: Worker is used to avoid proxy overhead
 */
const WORKER_THRESHOLD = 5000;

let worker: Worker | null = null;

// Extended pending request tracking with progress callback and timeout management
interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressCallback;
  timeoutId?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Generic map storing requests of various types
const pendingRequests = new Map<string, PendingRequest<any>>();
let requestId = 0;

// Base timeout and extension per progress update
const BASE_TIMEOUT_MS = 30000;
const TIMEOUT_EXTENSION_MS = 15000;

// Initialize the worker
function getWorker(): Worker {
  if (!worker) {
    // Use Vite's worker import syntax
    worker = new Worker(new URL('./aggregation.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event) => {
      const { type, data, error, id } = event.data;

      if (type === 'error') {
        // Reject the pending request on error
        const pending = pendingRequests.get(id);
        if (pending) {
          if (pending.timeoutId) clearTimeout(pending.timeoutId);
          pending.reject(new Error(error));
          pendingRequests.delete(id);
        }
        return;
      }

      // Handle progress updates
      if (type === 'progress') {
        const pending = pendingRequests.get(id);
        if (pending && !pending.cancelled) {
          // Call the progress callback if provided
          if (pending.onProgress) {
            pending.onProgress(data as WorkerProgress);
          }
          // Extend the timeout since we're making progress (heartbeat pattern)
          if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
            pending.timeoutId = setTimeout(() => {
              if (pendingRequests.has(id)) {
                const req = pendingRequests.get(id)!;
                pendingRequests.delete(id);
                req.reject(new Error('Worker timeout - no progress'));
              }
            }, TIMEOUT_EXTENSION_MS);
          }
        }
        return;
      }

      // Find and resolve the pending request (final result)
      const pending = pendingRequests.get(id);
      if (pending) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        if (!pending.cancelled) {
          pending.resolve(data);
        }
        pendingRequests.delete(id);
      }
    };

    worker.onerror = (error) => {
      console.error('Worker error:', error);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        if (pending.timeoutId) clearTimeout(pending.timeoutId);
        pending.reject(new Error('Worker error'));
        pendingRequests.delete(id);
      }
    };
  }
  return worker;
}

// Send message to worker and wait for response
function sendToWorker<T>(type: string, data: unknown, options?: ComputeOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `${type}-${requestId++}`;

    // Check if already aborted
    if (options?.signal?.aborted) {
      reject(new Error('Computation cancelled'));
      return;
    }

    // Set up timeout that gets extended on progress
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(id)) {
        const req = pendingRequests.get(id)!;
        pendingRequests.delete(id);
        req.reject(new Error('Worker timeout'));
      }
    }, BASE_TIMEOUT_MS);

    const pending: PendingRequest<T> = {
      resolve,
      reject,
      onProgress: options?.onProgress,
      timeoutId,
      cancelled: false,
    };

    pendingRequests.set(id, pending);

    // Set up abort signal listener
    if (options?.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          const req = pendingRequests.get(id);
          if (req) {
            req.cancelled = true;
            if (req.timeoutId) clearTimeout(req.timeoutId);
            pendingRequests.delete(id);
            reject(new Error('Computation cancelled'));
          }
        },
        { once: true }
      );
    }

    const w = getWorker();
    w.postMessage({ type, data, id });
  });
}

// Maximum days to pre-compute (covers all possible user selections)
const MAX_PRECOMPUTE_DAYS = 365;

// Synchronous fallback for small datasets
function computeGroupsSync(records: SalesRecord[], mode: 'appId' | 'packageId'): ProductGroup[] {
  const groups = new Map<number, ProductGroup>();

  // Convert records to plain objects to strip Svelte proxy overhead
  // This is critical for performance - proxy access is very slow in tight loops
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const id = mode === 'appId' ? record.appId : record.packageid;
    if (id == null) continue;

    if (!groups.has(id)) {
      const name =
        mode === 'appId' ? record.appName || `App ${id}` : record.packageName || `Package ${id}`;
      groups.set(id, {
        id,
        name,
        records: [],
        hasRevenue: false,
      });
    }

    const group = groups.get(id)!;
    // Create a plain object copy to strip any reactive proxy
    group.records.push({ ...record });

    if (record.netSalesUsd && record.netSalesUsd > 0) {
      group.hasRevenue = true;
    }
  }

  const result = Array.from(groups.values())
    .filter((g) => g.hasRevenue && g.id != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Pre-compute launch metrics for each group while records are plain objects
  // This avoids expensive proxy access in ProductLaunchTable
  for (const group of result) {
    group.launchMetrics = calculateLaunchDays(group.records, MAX_PRECOMPUTE_DAYS);
  }

  return result;
}

/**
 * Compute product groups for Launch Comparison
 * Uses Web Worker for large datasets, synchronous for small ones
 *
 * @param records - Sales records to process
 * @param mode - Group by 'appId' or 'packageId'
 * @param options - Optional progress callback and abort signal
 */
export async function computeProductGroups(
  records: SalesRecord[],
  mode: 'appId' | 'packageId',
  options?: ComputeOptions
): Promise<ProductGroup[]> {
  // Check for early abort
  if (options?.signal?.aborted) {
    throw new Error('Computation cancelled');
  }

  // Use synchronous computation for small datasets
  // Note: Don't call onProgress synchronously here as it can cause
  // infinite loops when called from within a Svelte effect
  if (records.length < WORKER_THRESHOLD) {
    return computeGroupsSync(records, mode);
  }

  // Use worker for large datasets
  try {
    return await sendToWorker<ProductGroup[]>('computeGroups', { records, mode }, options);
  } catch (error) {
    // Don't fall back if explicitly cancelled
    if (error instanceof Error && error.message === 'Computation cancelled') {
      throw error;
    }
    console.warn('Worker failed, falling back to sync computation:', error);
    return computeGroupsSync(records, mode);
  }
}

/**
 * Compute all aggregates in one pass
 * Uses Web Worker for large datasets
 */
export async function computeAggregates(
  records: SalesRecord[],
  filters: Filters
): Promise<AggregatesResult> {
  // Use worker for large datasets
  if (records.length >= WORKER_THRESHOLD) {
    try {
      return await sendToWorker<AggregatesResult>('computeAggregates', { records, filters });
    } catch (error) {
      console.warn('Worker failed for aggregates:', error);
      // Fall through to sync computation
    }
  }

  // Synchronous fallback (simplified - actual implementation would mirror the worker logic)
  // For now, return empty results to indicate the main thread stores should handle it
  return {
    dailySummary: [],
    appSummary: [],
    countrySummary: [],
    totalStats: {
      totalRevenue: 0,
      totalUnits: 0,
      totalRecords: 0,
      uniqueApps: 0,
      uniqueCountries: 0,
    },
  };
}

/**
 * Check if worker should be used based on data size
 */
export function shouldUseWorker(recordCount: number): boolean {
  return recordCount >= WORKER_THRESHOLD;
}

/**
 * Terminate the worker (call on app cleanup)
 */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
    pendingRequests.clear();
  }
}
