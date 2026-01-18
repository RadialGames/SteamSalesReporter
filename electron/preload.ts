// Electron preload script
// Exposes safe IPC methods to the renderer process

import { contextBridge, ipcRenderer } from 'electron';
import type { FetchParams, Filters, SalesRecord } from '../src/lib/services/types';

// Expose protected methods that allow the renderer process
// to communicate with the main process via IPC
contextBridge.exposeInMainWorld('electronAPI', {
  getApiKey: (): Promise<string | null> => {
    return ipcRenderer.invoke('get-api-key');
  },

  setApiKey: (key: string): Promise<void> => {
    return ipcRenderer.invoke('set-api-key', key);
  },

  fetchSalesData: (params: FetchParams): Promise<SalesRecord[]> => {
    return ipcRenderer.invoke('fetch-sales-data', params);
  },

  getSalesFromDb: (filters: Filters): Promise<SalesRecord[]> => {
    return ipcRenderer.invoke('get-sales-from-db', filters);
  },

  saveSalesData: (data: SalesRecord[]): Promise<void> => {
    return ipcRenderer.invoke('save-sales-data', data);
  },

  getHighwatermark: (): Promise<number> => {
    return ipcRenderer.invoke('get-highwatermark');
  },

  setHighwatermark: (value: number): Promise<void> => {
    return ipcRenderer.invoke('set-highwatermark', value);
  }
});
