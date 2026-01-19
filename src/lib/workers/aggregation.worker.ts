// Web Worker for heavy aggregation computations
// This runs off the main thread to keep the UI responsive

import type { SalesRecord, Filters } from '$lib/services/types';
import { applyFilters, applyFiltersExcluding } from '$lib/utils/filters';

// Message types
interface ComputeGroupsMessage {
  type: 'computeGroups';
  data: {
    records: SalesRecord[];
    mode: 'appId' | 'packageId';
  };
}

interface ComputeAggregatesMessage {
  type: 'computeAggregates';
  data: {
    records: SalesRecord[];
    filters: Filters;
  };
}

type WorkerMessage = ComputeGroupsMessage | ComputeAggregatesMessage;

// Product group type (matches LaunchComparison)
interface ProductGroup {
  id: number;
  name: string;
  records: SalesRecord[];
  hasRevenue: boolean;
}

// Progress reporting interval (every N records)
const PROGRESS_INTERVAL = 10000;

// Compute product groups (for Launch Comparison) with progress reporting
function computeGroups(
  records: SalesRecord[],
  mode: 'appId' | 'packageId',
  messageId?: string
): ProductGroup[] {
  const groups = new Map<number, ProductGroup>();
  const total = records.length;

  for (let i = 0; i < total; i++) {
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
    group.records.push(record);

    if (record.netSalesUsd && record.netSalesUsd > 0) {
      group.hasRevenue = true;
    }

    // Report progress at regular intervals
    if (i > 0 && i % PROGRESS_INTERVAL === 0) {
      self.postMessage({
        type: 'progress',
        data: { processed: i, total },
        id: messageId,
      });
    }
  }

  // Final progress update before returning results
  self.postMessage({
    type: 'progress',
    data: { processed: total, total },
    id: messageId,
  });

  return Array.from(groups.values())
    .filter((g) => g.hasRevenue && g.id != null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Compute all aggregates at once
function computeAggregates(records: SalesRecord[], filters: Filters) {
  const filtered = applyFilters(records, filters);

  // Daily summary
  const byDate = new Map<string, { date: string; totalRevenue: number; totalUnits: number }>();
  for (const sale of filtered) {
    const existing = byDate.get(sale.date) || {
      date: sale.date,
      totalRevenue: 0,
      totalUnits: 0,
    };
    existing.totalRevenue += sale.netSalesUsd ?? 0;
    existing.totalUnits += sale.unitsSold;
    byDate.set(sale.date, existing);
  }
  const dailySummary = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

  // App summary (without appIds filter)
  const filteredForApps = applyFiltersExcluding(records, filters, 'appIds');
  const byApp = new Map<
    number,
    { appId: number; appName: string; totalRevenue: number; totalUnits: number }
  >();
  for (const sale of filteredForApps) {
    const existing = byApp.get(sale.appId) || {
      appId: sale.appId,
      appName: sale.appName || `App ${sale.appId}`,
      totalRevenue: 0,
      totalUnits: 0,
    };
    existing.totalRevenue += sale.netSalesUsd ?? 0;
    existing.totalUnits += sale.unitsSold;
    if (sale.appName) existing.appName = sale.appName;
    byApp.set(sale.appId, existing);
  }
  const appSummary = Array.from(byApp.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Country summary (without countryCode filter)
  const filteredForCountries = applyFiltersExcluding(records, filters, 'countryCode');
  const byCountry = new Map<
    string,
    { countryCode: string; totalRevenue: number; totalUnits: number }
  >();
  for (const sale of filteredForCountries) {
    const existing = byCountry.get(sale.countryCode) || {
      countryCode: sale.countryCode,
      totalRevenue: 0,
      totalUnits: 0,
    };
    existing.totalRevenue += sale.netSalesUsd ?? 0;
    existing.totalUnits += sale.unitsSold;
    byCountry.set(sale.countryCode, existing);
  }
  const countrySummary = Array.from(byCountry.values()).sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );

  // Total stats
  const totalStats = {
    totalRevenue: filtered.reduce((sum, s) => sum + (s.netSalesUsd ?? 0), 0),
    totalUnits: filtered.reduce((sum, s) => sum + s.unitsSold, 0),
    totalRecords: filtered.length,
    uniqueApps: new Set(filtered.map((s) => s.appId)).size,
    uniqueCountries: new Set(filtered.map((s) => s.countryCode)).size,
  };

  return {
    dailySummary,
    appSummary,
    countrySummary,
    totalStats,
  };
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent<WorkerMessage & { id?: string }>) => {
  const { type, data, id } = event.data;

  try {
    switch (type) {
      case 'computeGroups': {
        const result = computeGroups(data.records, data.mode, id);
        self.postMessage({ type: 'groupsResult', data: result, id });
        break;
      }
      case 'computeAggregates': {
        const result = computeAggregates(data.records, data.filters);
        self.postMessage({ type: 'aggregatesResult', data: result, id });
        break;
      }
      default:
        console.warn('Unknown message type:', type);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      id,
    });
  }
};

// TypeScript export to make this a module
export {};
