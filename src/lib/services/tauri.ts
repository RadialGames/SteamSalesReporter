// Tauri-mode service implementation
// Uses Tauri invoke to communicate with Rust backend

import { invoke } from '@tauri-apps/api/core';
import type {
  SalesService,
  SalesRecord,
  FetchParams,
  FetchResult,
  Filters,
  ApiKeyInfo,
  ChangedDatesResult,
  DataProgressCallback,
} from './types';

export const tauriServices: SalesService = {
  // Multi-key API management
  async getAllApiKeys(): Promise<ApiKeyInfo[]> {
    return invoke('get_all_api_keys');
  },

  async getApiKey(id: string): Promise<string | null> {
    return invoke('get_api_key', { id });
  },

  async addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo> {
    return invoke('add_api_key', { key, displayName });
  },

  async updateApiKeyName(id: string, displayName: string): Promise<void> {
    return invoke('update_api_key_name', { id, displayName });
  },

  async deleteApiKey(id: string): Promise<void> {
    return invoke('delete_api_key', { id });
  },

  // Data operations
  async getChangedDates(apiKey: string, apiKeyId: string): Promise<ChangedDatesResult> {
    return invoke('get_changed_dates', { apiKey, apiKeyId });
  },

  async fetchSalesData(params: FetchParams): Promise<FetchResult> {
    // Note: The Rust backend handles getting the API key from secure storage
    // We only pass the apiKeyId
    return invoke('fetch_sales_data', { apiKeyId: params.apiKeyId });
  },

  async getSalesFromDb(filters: Filters): Promise<SalesRecord[]> {
    return invoke('get_sales_from_db', { filters });
  },

  async saveSalesData(data: SalesRecord[], apiKeyId: string): Promise<void> {
    return invoke('save_sales_data', { data, apiKeyId });
  },

  // Per-key highwatermark
  async getHighwatermark(apiKeyId: string): Promise<number> {
    return invoke('get_highwatermark', { apiKeyId });
  },

  async setHighwatermark(apiKeyId: string, value: number): Promise<void> {
    return invoke('set_highwatermark', { apiKeyId, value });
  },

  // Data management
  // Note: Progress callbacks not supported in Tauri mode yet (would require Rust backend changes)
  async clearAllData(_onProgress?: DataProgressCallback): Promise<void> {
    return invoke('clear_all_data');
  },

  async clearDataForKey(apiKeyId: string, _onProgress?: DataProgressCallback): Promise<void> {
    return invoke('clear_data_for_key', { apiKeyId });
  },

  // Helper
  async getExistingDates(apiKeyId: string): Promise<Set<string>> {
    const dates: string[] = await invoke('get_existing_dates', { apiKeyId });
    return new Set(dates);
  },
};
