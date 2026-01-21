/**
 * Worker Manager for Background Aggregation Computations
 *
 * All heavy computations are offloaded to a Web Worker to keep the UI responsive.
 * This avoids blocking the main thread and prevents Svelte 5 reactive proxy overhead.
 *
 * ## Usage
 *
 * - `computeProductGroups()` - For Launch Comparison product grouping
 * - `computeAggregates()` - For computing daily/app/country summaries
 *
 * ## Why Always Use Workers
 *
 * 1. **UI Responsiveness** - Never blocks the main thread
 * 2. **Proxy Overhead** - Svelte 5 proxies are slow; worker receives plain objects via postMessage
 * 3. **Consistent Behavior** - No threshold edge cases or unexpected slowdowns
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

/**
 * Safe deep clone for worker communication
 * Handles SalesRecord arrays and other data structures safely
 */
function safeClone(data: unknown, seen = new WeakSet()): unknown {
  // Prevent infinite recursion with circular references
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
    return data;
  }

  // Check for circular references
  if (typeof data === 'object') {
    if (seen.has(data)) {
      return null; // Replace circular references with null
    }
    seen.add(data);
  }

  if (Array.isArray(data)) {
    const result = data.map((item) => safeClone(item, seen));
    seen.delete(data); // Clean up after processing
    return result;
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip functions, symbols, and other non-serializable properties
      if (typeof value !== 'function' && typeof value !== 'symbol') {
        // Skip properties that start with $ (Svelte internal)
        if (!key.startsWith('$') && !key.startsWith('_')) {
          result[key] = safeClone(value, seen);
        }
      }
    }
    seen.delete(data); // Clean up after processing
    return result;
  }

  // For any other type (like Date, etc.), try to convert to a serializable form
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    // If JSON serialization fails, return null
    return null;
  }
}

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
          pending.reject(new Error(`Worker error: ${error}`));
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

    // Try to send data directly first, fall back to safe clone if needed
    try {
      w.postMessage({ type, data, id });
    } catch (error) {
      console.warn('Direct postMessage failed, trying safe clone:', error);
      const plainData = safeClone(data);
      w.postMessage({ type, data: plainData, id });
    }
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
 * Always uses Web Worker to keep UI responsive
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

  // Empty records - return immediately
  if (records.length === 0) {
    return [];
  }

  // Always use worker for UI responsiveness
  try {
    return await sendToWorker<ProductGroup[]>('computeGroups', { records, mode }, options);
  } catch (error) {
    // Don't fall back if explicitly cancelled
    if (error instanceof Error && error.message === 'Computation cancelled') {
      throw error;
    }
    // Fall back to sync computation only if worker fails
    console.warn('Worker failed, falling back to sync computation:', error);
    return computeGroupsSync(records, mode);
  }
}

/**
 * Compute all aggregates in one pass
 * Always uses Web Worker to keep UI responsive
 */
export async function computeAggregates(
  records: SalesRecord[],
  filters: Filters
): Promise<AggregatesResult> {
  // Empty records - return empty results
  if (records.length === 0) {
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

  // Always use worker for UI responsiveness
  try {
    return await sendToWorker<AggregatesResult>('computeAggregates', { records, filters });
  } catch (error) {
    console.warn('Worker failed for aggregates:', error);
    // Return empty results on failure - caller should handle gracefully
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
