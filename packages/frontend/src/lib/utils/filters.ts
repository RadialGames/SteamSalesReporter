// Shared filter utilities for sales data
// Used by stores, workers, and database queries

import type { Filters } from '$lib/stores/sqlite-stores';

/** Minimal record shape used for filtering (compatible with query-client and services/types) */
type FilterableRecord = {
  date: string;
  appId?: number | null;
  countryCode?: string | null;
};

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
export function applyFilters<T extends FilterableRecord>(
  records: T[],
  filters: Filters
): T[] {
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
    filtered = filtered.filter((s) => s.appId != null && appIdSet.has(s.appId));
  }

  // Country filter
  if (filters.countryCode) {
    filtered = filtered.filter(
      (s) => s.countryCode != null && s.countryCode === filters.countryCode
    );
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
export function applyFiltersExcluding<T extends FilterableRecord>(
  records: T[],
  filters: Filters,
  ...excludeKeys: (keyof Filters)[]
): T[] {
  const filteredFilters = { ...filters };
  for (const key of excludeKeys) {
    delete filteredFilters[key];
  }
  return applyFilters(records, filteredFilters);
}

/**
 * Convert filterStore (Svelte store) value to Filters type for database queries.
 * This ensures consistent field extraction when passing filters to database functions.
 *
 * @param filterStoreValue - The value from $filterStore (already Filters type, but this makes intent explicit)
 * @returns Filters object with all filter fields
 *
 * @example
 * const filters = $filterStore;
 * const dbFilters = filterStoreToFilters(filters);
 * const result = await getParsedRecords(page, pageSize, dbFilters);
 */
export function filterStoreToFilters(filterStoreValue: Filters): Filters {
  return {
    appIds: filterStoreValue.appIds,
    countryCode: filterStoreValue.countryCode,
    startDate: filterStoreValue.startDate,
    endDate: filterStoreValue.endDate,
  };
}
