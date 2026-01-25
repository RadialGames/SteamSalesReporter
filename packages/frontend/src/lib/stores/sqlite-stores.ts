/**
 * SQLite-based stores for the frontend
 * 
 * These stores query the SQLite database directly via Tauri commands.
 * They provide reactive state management for the sales data.
 */

import { writable, derived, get } from 'svelte/store';
import * as queryClient from '$lib/api/query-client';
import type {
  DashboardStats,
  DailySummary,
  AppSummary,
  CountrySummary,
  SalesRecord,
  SalesResponse,
  AppLookup,
  CountryLookup,
  QueryFilters,
} from '$lib/api/query-client';

// ==================== Database Loaded State ====================

// Database loaded state - starts as false until CLI status confirms database exists
export const databaseLoaded = writable<boolean>(false);
export const databaseError = writable<string | null>(null);

// Function to set database as loaded (called when CLI status confirms database exists)
export function setDatabaseLoaded(loaded: boolean) {
  databaseLoaded.set(loaded);
}

// Function to set database error
export function setDatabaseError(error: string | null) {
  databaseError.set(error);
}

// ==================== Filter Store ====================

export interface Filters {
  startDate?: string;
  endDate?: string;
  appIds?: number[];
  countryCode?: string;
}

// Convert Filters to QueryFilters
function toQueryFilters(filters: Filters, additional: Partial<QueryFilters> = {}): QueryFilters {
  return {
    start_date: filters.startDate,
    end_date: filters.endDate,
    app_ids: filters.appIds,
    country_code: filters.countryCode,
    ...additional,
  };
}

function createFilterStore() {
  const { subscribe, set, update } = writable<Filters>({});

  return {
    subscribe,
    set,
    update,
    clear() {
      set({});
    },
    setDateRange(startDate?: string, endDate?: string) {
      update(f => ({ ...f, startDate, endDate }));
    },
    setApps(appIds?: number[]) {
      update(f => ({ ...f, appIds }));
    },
    setCountry(countryCode?: string) {
      update(f => ({ ...f, countryCode }));
    },
  };
}

export const filterStore = createFilterStore();

// ==================== Stats Store ====================

function createStatsStore() {
  const stats = writable<DashboardStats | null>(null);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe: stats.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(filters: Filters = {}) {
      loading.set(true);
      error.set(null);
      try {
        const data = await queryClient.getStats(toQueryFilters(filters));
        stats.set(data);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load stats');
      } finally {
        loading.set(false);
      }
    },
  };
}

export const statsStore = createStatsStore();

// ==================== Daily Summaries Store ====================

function createDailySummariesStore() {
  const summaries = writable<DailySummary[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe: summaries.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(filters: Filters = {}) {
      loading.set(true);
      error.set(null);
      try {
        const data = await queryClient.getDailySummaries(toQueryFilters(filters, { limit: 1000 }));
        summaries.set(data);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load daily summaries');
      } finally {
        loading.set(false);
      }
    },
  };
}

export const dailySummariesStore = createDailySummariesStore();

// ==================== App Summaries Store ====================

function createAppSummariesStore() {
  const summaries = writable<AppSummary[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe: summaries.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(filters: Filters = {}) {
      loading.set(true);
      error.set(null);
      try {
        const data = await queryClient.getAppSummaries(toQueryFilters(filters, { limit: 100 }));
        summaries.set(data);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load app summaries');
      } finally {
        loading.set(false);
      }
    },
  };
}

export const appSummariesStore = createAppSummariesStore();

// ==================== Country Summaries Store ====================

function createCountrySummariesStore() {
  const summaries = writable<CountrySummary[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe: summaries.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(filters: Filters = {}) {
      loading.set(true);
      error.set(null);
      try {
        const data = await queryClient.getCountrySummaries(toQueryFilters(filters, { limit: 250 }));
        summaries.set(data);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load country summaries');
      } finally {
        loading.set(false);
      }
    },
  };
}

export const countrySummariesStore = createCountrySummariesStore();

// ==================== Sales Records Store (paginated) ====================

function createSalesRecordsStore() {
  const records = writable<SalesRecord[]>([]);
  const pagination = writable<{ total: number; hasMore: boolean }>({ total: 0, hasMore: false });
  const loading = writable(false);
  const error = writable<string | null>(null);

  let currentFilters: Filters = {};
  let currentOffset = 0;

  return {
    subscribe: records.subscribe,
    pagination: { subscribe: pagination.subscribe },
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(filters: Filters = {}, sortBy: 'date' | 'revenue' | 'units' = 'date', sortOrder: 'asc' | 'desc' = 'desc') {
      loading.set(true);
      error.set(null);
      currentFilters = filters;
      currentOffset = 0;

      try {
        const response = await queryClient.getSales(toQueryFilters(filters, {
          offset: 0,
          limit: 1000,
          sort_by: sortBy,
          sort_order: sortOrder,
        }));
        records.set(response.records);
        pagination.set({ total: response.pagination.total, hasMore: response.pagination.has_more });
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load sales records');
      } finally {
        loading.set(false);
      }
    },

    async loadMore() {
      const currentPagination = get(pagination);
      if (!currentPagination.hasMore) return;

      loading.set(true);
      currentOffset += 1000;

      try {
        const response = await queryClient.getSales(toQueryFilters(currentFilters, {
          offset: currentOffset,
          limit: 1000,
        }));
        records.update(r => [...r, ...response.records]);
        pagination.set({ total: response.pagination.total, hasMore: response.pagination.has_more });
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load more records');
      } finally {
        loading.set(false);
      }
    },

    clear() {
      records.set([]);
      pagination.set({ total: 0, hasMore: false });
      currentFilters = {};
      currentOffset = 0;
    },
  };
}

export const salesRecordsStore = createSalesRecordsStore();

// ==================== Lookups Store ====================

function createLookupsStore() {
  const apps = writable<AppLookup[]>([]);
  const countries = writable<CountryLookup[]>([]);
  const loading = writable(false);

  return {
    apps: { subscribe: apps.subscribe },
    countries: { subscribe: countries.subscribe },
    loading: { subscribe: loading.subscribe },

    async loadApps() {
      loading.set(true);
      try {
        const data = await queryClient.getAppsLookup();
        apps.set(data);
      } finally {
        loading.set(false);
      }
    },

    async loadCountries() {
      loading.set(true);
      try {
        const data = await queryClient.getCountriesLookup();
        countries.set(data);
      } finally {
        loading.set(false);
      }
    },

    async loadAll() {
      loading.set(true);
      try {
        const [appsData, countriesData] = await Promise.all([
          queryClient.getAppsLookup(),
          queryClient.getCountriesLookup(),
        ]);
        apps.set(appsData);
        countries.set(countriesData);
      } catch (e) {
        // Silently handle errors - database might not exist yet
        console.warn('[lookupsStore] Failed to load lookups:', e);
        apps.set([]);
        countries.set([]);
      } finally {
        loading.set(false);
      }
    },
  };
}

export const lookupsStore = createLookupsStore();
