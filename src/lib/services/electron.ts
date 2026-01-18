// Electron-mode service implementation
// Uses IPC to communicate with main process for API calls and SQLite storage

import type { SalesService, SalesRecord, FetchParams, FetchResult, Filters } from './types';

// Type for the exposed electron API
interface ElectronAPI {
  getApiKey: () => Promise<string | null>;
  setApiKey: (key: string) => Promise<void>;
  fetchSalesData: (params: FetchParams) => Promise<FetchResult>;
  getSalesFromDb: (filters: Filters) => Promise<SalesRecord[]>;
  saveSalesData: (data: SalesRecord[]) => Promise<void>;
  getHighwatermark: () => Promise<number>;
  setHighwatermark: (value: number) => Promise<void>;
  clearAllData: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

function getElectronAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error('Electron API not available. Are you running in Electron?');
  }
  return window.electronAPI;
}

export const electronServices: SalesService = {
  async getApiKey(): Promise<string | null> {
    return getElectronAPI().getApiKey();
  },

  async setApiKey(key: string): Promise<void> {
    return getElectronAPI().setApiKey(key);
  },

  async fetchSalesData(params: FetchParams): Promise<FetchResult> {
    return getElectronAPI().fetchSalesData(params);
  },

  async getSalesFromDb(filters: Filters): Promise<SalesRecord[]> {
    return getElectronAPI().getSalesFromDb(filters);
  },

  async saveSalesData(data: SalesRecord[]): Promise<void> {
    return getElectronAPI().saveSalesData(data);
  },

  async getHighwatermark(): Promise<number> {
    return getElectronAPI().getHighwatermark();
  },

  async setHighwatermark(value: number): Promise<void> {
    return getElectronAPI().setHighwatermark(value);
  },

  async clearAllData(): Promise<void> {
    return getElectronAPI().clearAllData();
  }
};
