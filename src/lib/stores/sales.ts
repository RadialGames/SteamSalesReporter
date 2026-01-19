// Svelte stores for sales data and application state

import { writable, derived, get } from 'svelte/store';
import type { SalesRecord, DailySummary, AppSummary, CountrySummary, Filters } from '$lib/services/types';

// Debounce delay in milliseconds
const FILTER_DEBOUNCE_MS = 200;

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

// Filter store with debouncing
// Immediate store holds the current filter values (for UI binding)
const immediateFilterStore = writable<Filters>({});
// Debounced store holds the values that trigger recomputation
const debouncedFilterStoreInternal = writable<Filters>({});

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Create a debounced filter store that updates debouncedFilterStoreInternal after a delay
function createDebouncedFilterStore() {
  return {
    subscribe: immediateFilterStore.subscribe,
    set: (value: Filters) => {
      // Update immediate store right away (for UI responsiveness)
      immediateFilterStore.set(value);
      
      // Debounce the expensive recomputation
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debouncedFilterStoreInternal.set(value);
        debounceTimer = null;
      }, FILTER_DEBOUNCE_MS);
    },
    update: (fn: (value: Filters) => Filters) => {
      const currentValue = get(immediateFilterStore);
      const newValue = fn(currentValue);
      
      // Update immediate store right away
      immediateFilterStore.set(newValue);
      
      // Debounce the expensive recomputation
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debouncedFilterStoreInternal.set(newValue);
        debounceTimer = null;
      }, FILTER_DEBOUNCE_MS);
    },
    // Force immediate update (bypass debounce)
    setImmediate: (value: Filters) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      immediateFilterStore.set(value);
      debouncedFilterStoreInternal.set(value);
    }
  };
}

export const filterStore = createDebouncedFilterStore();

// Internal debounced filter store used by derived stores
const debouncedFilters = debouncedFilterStoreInternal;

// Helper function to apply filters to sales data
function applyFilters(sales: SalesRecord[], filters: Filters): SalesRecord[] {
  let filtered = sales;
  
  if (filters.startDate) {
    filtered = filtered.filter(s => s.date >= filters.startDate!);
  }
  if (filters.endDate) {
    filtered = filtered.filter(s => s.date <= filters.endDate!);
  }
  if (filters.appId != null) {
    filtered = filtered.filter(s => s.appId === filters.appId);
  }
  if (filters.countryCode) {
    filtered = filtered.filter(s => s.countryCode === filters.countryCode);
  }
  
  return filtered;
}

// Flag to track if derived stores are currently computing
export const isFiltering = writable(false);

// Create derived store that signals when filtering starts
derived(
  [salesStore, debouncedFilters],
  ([$sales, $filters], set) => {
    if ($sales.length > 100000) {
      isFiltering.set(true);
      // Use requestAnimationFrame to let the UI update before heavy computation
      requestAnimationFrame(() => {
        set({ sales: $sales, filters: $filters });
        isFiltering.set(false);
      });
    } else {
      set({ sales: $sales, filters: $filters });
    }
  },
  { sales: [] as SalesRecord[], filters: {} as Filters }
);

// Loading and error states
export const isLoading = writable(false);
export const errorMessage = writable<string | null>(null);

// Derived stores for aggregated data (use debounced filters to prevent rapid recomputation)
export const dailySummary = derived(
  [salesStore, debouncedFilters],
  ([$sales, $filters]) => {
    const filtered = applyFilters($sales, $filters);

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
  [salesStore, debouncedFilters],
  ([$sales, $filters]) => {
    // For app summary, don't filter by appId
    const filtersWithoutApp = { ...$filters, appId: undefined };
    const filtered = applyFilters($sales, filtersWithoutApp);

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
  [salesStore, debouncedFilters],
  ([$sales, $filters]) => {
    // For country summary, don't filter by countryCode
    const filtersWithoutCountry = { ...$filters, countryCode: undefined };
    const filtered = applyFilters($sales, filtersWithoutCountry);

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
  [salesStore, debouncedFilters],
  ([$sales, $filters]) => {
    const filtered = applyFilters($sales, $filters);

    return {
      totalRevenue: filtered.reduce((sum, s) => sum + (s.netSalesUsd ?? 0), 0),
      totalUnits: filtered.reduce((sum, s) => sum + s.unitsSold, 0),
      totalRecords: filtered.length,
      uniqueApps: new Set(filtered.map(s => s.appId)).size,
      uniqueCountries: new Set(filtered.map(s => s.countryCode)).size
    };
  }
);
