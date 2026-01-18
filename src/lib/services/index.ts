// Service abstraction layer
// Automatically selects browser or electron implementation based on environment

import type { SalesService } from './types';
import { browserServices } from './browser';
import { electronServices } from './electron';

export type { SalesService, SalesRecord, FetchParams, Filters } from './types';
export type { DailySummary, AppSummary, CountrySummary } from './types';

/**
 * Detect if we're running inside Electron
 */
function isElectron(): boolean {
  // Only return true if electronAPI is actually available and functional
  // This is the definitive check - the preload script sets this up
  if (typeof window !== 'undefined' && 
      window.electronAPI !== undefined && 
      typeof window.electronAPI.getApiKey === 'function') {
    return true;
  }
  
  // Default to browser mode - safer for development
  return false;
}

// Cache the services once determined
let _services: SalesService | null = null;

/**
 * Get the appropriate services implementation.
 * Lazily evaluated to ensure window.electronAPI has been set up.
 */
function getServices(): SalesService {
  if (_services === null) {
    _services = isElectron() ? electronServices : browserServices;
  }
  return _services;
}

/**
 * The services object provides a unified interface for:
 * - API key management
 * - Steam API data fetching
 * - Local database operations
 * 
 * In browser mode (development): Uses Vite proxy, IndexedDB, localStorage
 * In Electron mode (production): Uses IPC to main process, SQLite, safeStorage
 */
export const services: SalesService = {
  getApiKey: () => getServices().getApiKey(),
  setApiKey: (key) => getServices().setApiKey(key),
  fetchSalesData: (params) => getServices().fetchSalesData(params),
  getSalesFromDb: (filters) => getServices().getSalesFromDb(filters),
  saveSalesData: (data) => getServices().saveSalesData(data),
  getHighwatermark: () => getServices().getHighwatermark(),
  setHighwatermark: (value) => getServices().setHighwatermark(value),
  clearAllData: () => getServices().clearAllData(),
};

/**
 * Utility to check current mode
 */
export function getCurrentMode(): 'browser' | 'electron' {
  return isElectron() ? 'electron' : 'browser';
}
