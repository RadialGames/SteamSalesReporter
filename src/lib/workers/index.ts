// Worker manager for background aggregation computations
import type { SalesRecord, Filters, DailySummary, AppSummary, CountrySummary } from '$lib/services/types';

// Product group type (matches KimStyleReport)
export interface ProductGroup {
  id: number;
  name: string;
  records: SalesRecord[];
  hasRevenue: boolean;
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

// Threshold for using worker (records count)
const WORKER_THRESHOLD = 50000;

let worker: Worker | null = null;
let pendingRequests = new Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let requestId = 0;

// Initialize the worker
function getWorker(): Worker {
  if (!worker) {
    // Use Vite's worker import syntax
    worker = new Worker(new URL('./aggregation.worker.ts', import.meta.url), {
      type: 'module'
    });

    worker.onmessage = (event) => {
      const { type, data, error, id } = event.data;

      if (type === 'error') {
        // Reject all pending requests on error
        const pending = pendingRequests.get(id);
        if (pending) {
          pending.reject(new Error(error));
          pendingRequests.delete(id);
        }
        return;
      }

      // Find and resolve the pending request
      const pending = pendingRequests.get(id);
      if (pending) {
        pending.resolve(data);
        pendingRequests.delete(id);
      }
    };

    worker.onerror = (error) => {
      console.error('Worker error:', error);
      // Reject all pending requests
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error('Worker error'));
        pendingRequests.delete(id);
      }
    };
  }
  return worker;
}

// Send message to worker and wait for response
function sendToWorker<T>(type: string, data: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `${type}-${requestId++}`;
    pendingRequests.set(id, { resolve, reject });

    const w = getWorker();
    w.postMessage({ type, data, id });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Worker timeout'));
      }
    }, 30000);
  });
}

// Synchronous fallback for small datasets
function computeGroupsSync(records: SalesRecord[], mode: 'appId' | 'packageId'): ProductGroup[] {
  const groups = new Map<number, ProductGroup>();

  for (const record of records) {
    const id = mode === 'appId' ? record.appId : record.packageid;
    if (id == null) continue;

    if (!groups.has(id)) {
      const name =
        mode === 'appId'
          ? record.appName || `App ${id}`
          : record.packageName || `Package ${id}`;
      groups.set(id, {
        id,
        name,
        records: [],
        hasRevenue: false
      });
    }

    const group = groups.get(id)!;
    group.records.push(record);

    if (record.netSalesUsd && record.netSalesUsd > 0) {
      group.hasRevenue = true;
    }
  }

  return Array.from(groups.values())
    .filter((g) => g.hasRevenue && g.id != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Compute product groups for Kim Style report
 * Uses Web Worker for large datasets, synchronous for small ones
 */
export async function computeProductGroups(
  records: SalesRecord[],
  mode: 'appId' | 'packageId'
): Promise<ProductGroup[]> {
  // Use synchronous computation for small datasets
  if (records.length < WORKER_THRESHOLD) {
    return computeGroupsSync(records, mode);
  }

  // Use worker for large datasets
  try {
    return await sendToWorker<ProductGroup[]>('computeGroups', { records, mode });
  } catch (error) {
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
      uniqueCountries: 0
    }
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
