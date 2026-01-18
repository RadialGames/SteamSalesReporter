// Svelte stores for sales data and application state

import { writable, derived } from 'svelte/store';
import type { SalesRecord, DailySummary, AppSummary, CountrySummary, Filters } from '$lib/services/types';

// Raw sales data store
function createSalesStore() {
  const { subscribe, set, update } = writable<SalesRecord[]>([]);

  return {
    subscribe,
    setData: (data: SalesRecord[]) => set(data),
    addData: (data: SalesRecord[]) => update(current => [...current, ...data]),
    clear: () => set([])
  };
}

export const salesStore = createSalesStore();

// Settings store
function createSettingsStore() {
  let _apiKey: string | null = null;
  const { subscribe, set } = writable<{ apiKey: string | null }>({ apiKey: null });

  return {
    subscribe,
    get apiKey() { return _apiKey; },
    setApiKey: (key: string | null) => {
      _apiKey = key;
      set({ apiKey: key });
    }
  };
}

export const settingsStore = createSettingsStore();

// Filter store
export const filterStore = writable<Filters>({});

// Loading and error states
export const isLoading = writable(false);
export const errorMessage = writable<string | null>(null);

// Derived stores for aggregated data
export const dailySummary = derived(
  [salesStore, filterStore],
  ([$sales, $filters]) => {
    let filtered = [...$sales];
    
    if ($filters.startDate) {
      filtered = filtered.filter(s => s.date >= $filters.startDate!);
    }
    if ($filters.endDate) {
      filtered = filtered.filter(s => s.date <= $filters.endDate!);
    }
    if ($filters.appId != null) {
      filtered = filtered.filter(s => s.appId === $filters.appId);
    }
    if ($filters.countryCode) {
      filtered = filtered.filter(s => s.countryCode === $filters.countryCode);
    }

    const byDate = new Map<string, DailySummary>();
    
    for (const sale of filtered) {
      const existing = byDate.get(sale.date) || {
        date: sale.date,
        totalRevenue: 0,
        totalUnits: 0
      };
      
      existing.totalRevenue += sale.netSalesUsd ?? 0;
      existing.totalUnits += sale.unitsSold;
      byDate.set(sale.date, existing);
    }
    
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }
);

export const appSummary = derived(
  [salesStore, filterStore],
  ([$sales, $filters]) => {
    let filtered = [...$sales];
    
    if ($filters.startDate) {
      filtered = filtered.filter(s => s.date >= $filters.startDate!);
    }
    if ($filters.endDate) {
      filtered = filtered.filter(s => s.date <= $filters.endDate!);
    }
    if ($filters.countryCode) {
      filtered = filtered.filter(s => s.countryCode === $filters.countryCode);
    }

    const byApp = new Map<number, AppSummary>();
    
    for (const sale of filtered) {
      const existing = byApp.get(sale.appId) || {
        appId: sale.appId,
        appName: sale.appName || `App ${sale.appId}`,
        totalRevenue: 0,
        totalUnits: 0
      };
      
      existing.totalRevenue += sale.netSalesUsd ?? 0;
      existing.totalUnits += sale.unitsSold;
      if (sale.appName) existing.appName = sale.appName;
      byApp.set(sale.appId, existing);
    }
    
    return Array.from(byApp.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
);

export const countrySummary = derived(
  [salesStore, filterStore],
  ([$sales, $filters]) => {
    let filtered = [...$sales];
    
    if ($filters.startDate) {
      filtered = filtered.filter(s => s.date >= $filters.startDate!);
    }
    if ($filters.endDate) {
      filtered = filtered.filter(s => s.date <= $filters.endDate!);
    }
    if ($filters.appId != null) {
      filtered = filtered.filter(s => s.appId === $filters.appId);
    }

    const byCountry = new Map<string, CountrySummary>();
    
    for (const sale of filtered) {
      const existing = byCountry.get(sale.countryCode) || {
        countryCode: sale.countryCode,
        totalRevenue: 0,
        totalUnits: 0
      };
      
      existing.totalRevenue += sale.netSalesUsd ?? 0;
      existing.totalUnits += sale.unitsSold;
      byCountry.set(sale.countryCode, existing);
    }
    
    return Array.from(byCountry.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
);

// Total stats derived store
export const totalStats = derived(
  [salesStore, filterStore],
  ([$sales, $filters]) => {
    let filtered = [...$sales];
    
    if ($filters.startDate) {
      filtered = filtered.filter(s => s.date >= $filters.startDate!);
    }
    if ($filters.endDate) {
      filtered = filtered.filter(s => s.date <= $filters.endDate!);
    }
    if ($filters.appId != null) {
      filtered = filtered.filter(s => s.appId === $filters.appId);
    }
    if ($filters.countryCode) {
      filtered = filtered.filter(s => s.countryCode === $filters.countryCode);
    }

    return {
      totalRevenue: filtered.reduce((sum, s) => sum + (s.netSalesUsd ?? 0), 0),
      totalUnits: filtered.reduce((sum, s) => sum + s.unitsSold, 0),
      totalRecords: filtered.length,
      uniqueApps: new Set(filtered.map(s => s.appId)).size,
      uniqueCountries: new Set(filtered.map(s => s.countryCode)).size
    };
  }
);
