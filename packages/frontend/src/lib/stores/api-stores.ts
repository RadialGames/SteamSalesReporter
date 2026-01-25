/**
 * API-based stores for the frontend
 * 
 * These stores fetch data from the backend API instead of local SQLite.
 * They provide reactive state management with automatic refetching.
 */

import { writable, derived, get } from 'svelte/store';
import * as api from '$lib/api/client';
import type { ApiKeyInfo, SyncProgress, DashboardStats, DailySummary, AppSummary, CountrySummary, SalesRecord, SalesQueryParams } from '$lib/api/client';

// ==================== API Keys Store ====================

function createApiKeysStore() {
  const { subscribe, set } = writable<ApiKeyInfo[]>([]);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load() {
      loading.set(true);
      error.set(null);
      try {
        const keys = await api.getApiKeys();
        set(keys);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load API keys');
      } finally {
        loading.set(false);
      }
    },

    async add(key: string, displayName?: string) {
      loading.set(true);
      error.set(null);
      try {
        const newKey = await api.addApiKey(key, displayName);
        // Reload all keys to ensure consistency
        const keys = await api.getApiKeys();
        set(keys);
        return newKey;
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to add API key');
        throw e;
      } finally {
        loading.set(false);
      }
    },

    async update(id: string, displayName: string) {
      error.set(null);
      try {
        await api.updateApiKey(id, displayName);
        const keys = await api.getApiKeys();
        set(keys);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to update API key');
        throw e;
      }
    },

    async delete(id: string) {
      error.set(null);
      try {
        await api.deleteApiKey(id);
        const keys = await api.getApiKeys();
        set(keys);
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to delete API key');
        throw e;
      }
    },
  };
}

export const apiKeysStore = createApiKeysStore();

// ==================== Sync Store ====================

function createSyncStore() {
  const progress = writable<SyncProgress | null>(null);
  const syncId = writable<string | null>(null);
  const isRunning = derived(progress, ($progress) => 
    $progress !== null && $progress.phase !== 'complete' && $progress.phase !== 'error'
  );

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function pollStatus(id: string) {
    try {
      const status = await api.getSyncStatus(id);
      progress.set(status);

      if (status.phase === 'complete' || status.phase === 'error') {
        stopPolling();
      }
    } catch (e) {
      // Sync may have expired
      stopPolling();
      progress.set(null);
    }
  }

  return {
    progress: { subscribe: progress.subscribe },
    isRunning: { subscribe: isRunning.subscribe },

    async start(apiKeyIds?: string[]) {
      stopPolling();
      progress.set({
        phase: 'discovery',
        message: 'Starting sync...',
      });

      try {
        const { syncId: id } = await api.startSync(apiKeyIds);
        syncId.set(id);

        // Start polling for progress
        pollInterval = setInterval(() => pollStatus(id), 1000);
        
        // Initial poll
        await pollStatus(id);
      } catch (e) {
        progress.set({
          phase: 'error',
          message: 'Failed to start sync',
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    },

    stop() {
      stopPolling();
    },

    clear() {
      stopPolling();
      progress.set(null);
      syncId.set(null);
    },
  };
}

export const syncStore = createSyncStore();

// ==================== Filter Store ====================

export interface Filters {
  startDate?: string;
  endDate?: string;
  apiKeyIds?: string[];
  appIds?: number[];
  countryCode?: string;
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
    setApiKeys(apiKeyIds?: string[]) {
      update(f => ({ ...f, apiKeyIds }));
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
        const data = await api.getStats(filters);
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
        const data = await api.getDailySummaries({ ...filters, limit: 1000 });
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
        const data = await api.getAppSummaries({ ...filters, limit: 100 });
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
        const data = await api.getCountrySummaries({ ...filters, limit: 250 });
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

  let currentParams: SalesQueryParams = {};

  return {
    subscribe: records.subscribe,
    pagination: { subscribe: pagination.subscribe },
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load(params: SalesQueryParams = {}) {
      loading.set(true);
      error.set(null);
      currentParams = { ...params, offset: 0 };

      try {
        const response = await api.getSales(currentParams);
        records.set(response.records);
        pagination.set({ total: response.pagination.total, hasMore: response.pagination.hasMore });
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
      currentParams = { ...currentParams, offset: (currentParams.offset || 0) + (currentParams.limit || 1000) };

      try {
        const response = await api.getSales(currentParams);
        records.update(r => [...r, ...response.records]);
        pagination.set({ total: response.pagination.total, hasMore: response.pagination.hasMore });
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to load more records');
      } finally {
        loading.set(false);
      }
    },

    clear() {
      records.set([]);
      pagination.set({ total: 0, hasMore: false });
      currentParams = {};
    },
  };
}

export const salesRecordsStore = createSalesRecordsStore();

// ==================== Lookups Store ====================

function createLookupsStore() {
  const apps = writable<api.AppLookup[]>([]);
  const countries = writable<api.CountryLookup[]>([]);
  const loading = writable(false);

  return {
    apps: { subscribe: apps.subscribe },
    countries: { subscribe: countries.subscribe },
    loading: { subscribe: loading.subscribe },

    async loadApps() {
      loading.set(true);
      try {
        const data = await api.getAppsLookup();
        apps.set(data);
      } finally {
        loading.set(false);
      }
    },

    async loadCountries() {
      loading.set(true);
      try {
        const data = await api.getCountriesLookup();
        countries.set(data);
      } finally {
        loading.set(false);
      }
    },

    async loadAll() {
      loading.set(true);
      try {
        const [appsData, countriesData] = await Promise.all([
          api.getAppsLookup(),
          api.getCountriesLookup(),
        ]);
        apps.set(appsData);
        countries.set(countriesData);
      } finally {
        loading.set(false);
      }
    },
  };
}

export const lookupsStore = createLookupsStore();

// ==================== Health Check ====================

export const backendHealthy = writable<boolean | null>(null);

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const status = await api.checkHealth();
    const healthy = status.status === 'healthy' && status.database === 'connected';
    backendHealthy.set(healthy);
    return healthy;
  } catch {
    backendHealthy.set(false);
    return false;
  }
}
