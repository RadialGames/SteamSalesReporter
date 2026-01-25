import type {
  ApiKeyInfo,
  SalesService,
  SalesRecord,
  FetchResult,
  ChangedDatesResult,
  DataProgressCallback,
} from './types.js';

/**
 * Stub SalesService implementation.
 * The current app uses Tauri + CLI with a single database; multi-key API key
 * and data-wipe operations are not implemented. This stub exists for typecheck
 * compatibility. ApiKeyModal is not used in the current flow.
 */
const services: SalesService = {
  async getAllApiKeys(): Promise<ApiKeyInfo[]> {
    throw new Error('Not implemented: multi-key API not used in Tauri/CLI mode');
  },
  async getApiKey(): Promise<string | null> {
    throw new Error('Not implemented');
  },
  async addApiKey(): Promise<ApiKeyInfo> {
    throw new Error('Not implemented');
  },
  async updateApiKeyName(): Promise<void> {
    throw new Error('Not implemented');
  },
  async deleteApiKey(): Promise<void> {
    throw new Error('Not implemented');
  },
  async getChangedDates(): Promise<ChangedDatesResult> {
    throw new Error('Not implemented');
  },
  async fetchSalesData(): Promise<FetchResult> {
    throw new Error('Not implemented');
  },
  async getSalesFromDb(): Promise<SalesRecord[]> {
    throw new Error('Not implemented');
  },
  async saveSalesData(): Promise<void> {
    throw new Error('Not implemented');
  },
  async getHighwatermark(): Promise<number> {
    throw new Error('Not implemented');
  },
  async setHighwatermark(): Promise<void> {
    throw new Error('Not implemented');
  },
  async clearAllData(onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Preparing...', 0);
    throw new Error('Not implemented');
  },
  async clearProcessedData(onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Preparing...', 0);
    throw new Error('Not implemented');
  },
  async clearDataForKey(_apiKeyId: string, onProgress?: DataProgressCallback): Promise<void> {
    onProgress?.('Preparing...', 0);
    throw new Error('Not implemented');
  },
  async getExistingDates(): Promise<Set<string>> {
    throw new Error('Not implemented');
  },
};

export { services };
