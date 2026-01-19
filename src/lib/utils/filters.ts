// Shared filter utilities for sales data
// Used by stores, workers, and database queries

import type { SalesRecord, Filters } from '$lib/services/types';

/**
 * Apply filters to an array of sales records in memory.
 *
 * This is the single source of truth for filter logic used by:
 * - Svelte stores (real-time filtering)
 * - Web workers (background filtering)
 * - Database queries (in-memory post-processing)
 *
 * @param records - Array of sales records to filter
 * @param filters - Filter criteria to apply
 * @returns Filtered array of sales records
 */
export function applyFilters(records: SalesRecord[], filters: Filters): SalesRecord[] {
  let filtered = records;

  // Date range filters
  if (filters.startDate) {
    filtered = filtered.filter((s) => s.date >= filters.startDate!);
  }
  if (filters.endDate) {
    filtered = filtered.filter((s) => s.date <= filters.endDate!);
  }

  // Multi-select app filter
  if (filters.appIds && filters.appIds.length > 0) {
    const appIdSet = new Set(filters.appIds);
    filtered = filtered.filter((s) => appIdSet.has(s.appId));
  }

  // Multi-select package filter
  if (filters.packageIds && filters.packageIds.length > 0) {
    const packageIdSet = new Set(filters.packageIds);
    filtered = filtered.filter((s) => s.packageid != null && packageIdSet.has(s.packageid));
  }

  // Country filter
  if (filters.countryCode) {
    filtered = filtered.filter((s) => s.countryCode === filters.countryCode);
  }

  // Multi-select API key filter
  if (filters.apiKeyIds && filters.apiKeyIds.length > 0) {
    const apiKeyIdSet = new Set(filters.apiKeyIds);
    filtered = filtered.filter((s) => apiKeyIdSet.has(s.apiKeyId));
  }

  return filtered;
}

/**
 * Apply filters excluding a specific filter key.
 * Useful for aggregations where you want to show totals without a particular filter.
 *
 * @example
 * // Get app summary without filtering by the selected apps
 * const records = applyFiltersExcluding(sales, filters, 'appIds');
 */
export function applyFiltersExcluding(
  records: SalesRecord[],
  filters: Filters,
  ...excludeKeys: (keyof Filters)[]
): SalesRecord[] {
  const filteredFilters = { ...filters };
  for (const key of excludeKeys) {
    delete filteredFilters[key];
  }
  return applyFilters(records, filteredFilters);
}
