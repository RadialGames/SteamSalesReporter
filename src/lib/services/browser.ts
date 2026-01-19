// Browser-mode service implementation
// Uses Vite proxy for API calls, IndexedDB for storage, localStorage for settings

import type { SalesService, SalesRecord, FetchParams, FetchResult, Filters, SteamChangedDatesResponse, SteamDetailedSalesResponse, ProgressCallback, ApiKeyInfo, ChangedDatesResult } from './types';
import { db, computeAndStoreAggregates, clearAggregates } from '$lib/db/dexie';

// Storage keys
const API_KEYS_STORAGE_KEY = 'steam_api_keys'; // JSON array of ApiKeyInfo
const API_KEY_VALUES_PREFIX = 'steam_api_key_'; // Individual key values: steam_api_key_{id}
const HIGHWATERMARK_PREFIX = 'highwatermark_'; // Per-key highwatermarks: highwatermark_{id}

// Helper to generate UUID
function generateId(): string {
  return crypto.randomUUID();
}

// Helper to get last 4 chars of key for display
function getKeyHash(key: string): string {
  return key.slice(-4);
}

// Number of dates to fetch in parallel (be respectful to Steam's servers)
const PARALLEL_BATCH_SIZE = 3;

async function fetchFromSteamApi<T>(endpoint: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const queryString = new URLSearchParams(params).toString();
  // Note: partner.steam-api.com doesn't use /webapi/ prefix
  const url = `/api/steam/${endpoint}?${queryString}`;
  
  const response = await fetch(url, { signal });
  
  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

// Custom error for cancelled operations
export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled by user');
    this.name = 'SyncCancelledError';
  }
}

// Helper to fetch all sales for a single date (handles pagination)
async function fetchSalesForDate(apiKey: string, apiKeyId: string, date: string, signal?: AbortSignal): Promise<SalesRecord[]> {
  const dateSales: SalesRecord[] = [];
  let pageHighwatermark = 0;
  let hasMore = true;
  
  while (hasMore) {
    // Check if cancelled before each request
    if (signal?.aborted) {
      throw new SyncCancelledError();
    }
    
    const salesResponse = await fetchFromSteamApi<SteamDetailedSalesResponse>(
      'IPartnerFinancialsService/GetDetailedSales/v1',
      {
        key: apiKey,
        date,
        highwatermark_id: pageHighwatermark.toString()
      },
      signal
    );
    
    // Steam API returns 'results' not 'sales', and max_id is a string
    const results = salesResponse.response?.results || [];
    const maxIdStr = salesResponse.response?.max_id || '0';
    const maxId = parseInt(maxIdStr, 10) || 0;
    
    // Build lookup maps from all info arrays
    const appNameMap = new Map<number, string>();
    for (const app of salesResponse.response?.app_info || []) {
      appNameMap.set(app.appid, app.app_name);
    }
    
    const packageNameMap = new Map<number, string>();
    for (const pkg of salesResponse.response?.package_info || []) {
      packageNameMap.set(pkg.packageid, pkg.package_name);
    }
    
    const bundleNameMap = new Map<number, string>();
    for (const bundle of salesResponse.response?.bundle_info || []) {
      bundleNameMap.set(bundle.bundleid, bundle.bundle_name);
    }
    
    const partnerNameMap = new Map<number, string>();
    for (const partner of salesResponse.response?.partner_info || []) {
      partnerNameMap.set(partner.partnerid, partner.partner_name);
    }
    
    const countryInfoMap = new Map<string, { name: string; region: string }>();
    for (const country of salesResponse.response?.country_info || []) {
      countryInfoMap.set(country.country_code, { name: country.country_name, region: country.region });
    }
    
    const gameItemInfoMap = new Map<string, { description: string; category: string }>();
    for (const item of salesResponse.response?.game_item_info || []) {
      gameItemInfoMap.set(`${item.appid}-${item.game_item_id}`, { description: item.game_item_description, category: item.game_item_category });
    }
    
    const keyRequestInfoMap = new Map<number, { notes: string; gameCodeDescription: string }>();
    for (const kr of salesResponse.response?.key_request_info || []) {
      keyRequestInfoMap.set(kr.key_request_id, { notes: kr.key_request_notes, gameCodeDescription: kr.game_code_description });
    }
    
    const discountInfoMap = new Map<number, string>();
    for (const discount of salesResponse.response?.combined_discount_info || []) {
      discountInfoMap.set(discount.combined_discount_id, discount.combined_discount_name);
    }
    
    // Convert Steam API format to our format - capture ALL fields
    for (const item of results) {
      const primaryAppid = item.primary_appid || item.appid || 0;
      const grossSalesUsd = parseFloat(item.gross_sales_usd || '0');
      const grossReturnsUsd = parseFloat(item.gross_returns_usd || '0');
      const netSalesUsd = parseFloat(item.net_sales_usd || '0');
      const netTaxUsd = parseFloat(item.net_tax_usd || '0');
      const unitsSold = item.net_units_sold ?? item.gross_units_sold ?? item.gross_units_activated ?? 0;
      
      // Get lookup data
      const countryInfo = countryInfoMap.get(item.country_code);
      const gameItemKey = item.appid && item.game_item_id ? `${item.appid}-${item.game_item_id}` : null;
      const gameItemInfo = gameItemKey ? gameItemInfoMap.get(gameItemKey) : null;
      const keyRequestInfo = item.key_request_id ? keyRequestInfoMap.get(item.key_request_id) : null;
      
      dateSales.push({
        // API Key association (required)
        apiKeyId,
        
        // Core identifiers
        date: item.date,
        lineItemType: item.line_item_type,
        partnerid: item.partnerid,
        primaryAppid,
        packageid: item.packageid,
        bundleid: item.bundleid,
        appid: item.appid,
        gameItemId: item.game_item_id,
        
        // Location & platform
        countryCode: item.country_code,
        platform: item.platform,
        currency: item.currency,
        
        // Pricing
        basePrice: item.base_price,
        salePrice: item.sale_price,
        avgSalePriceUsd: item.avg_sale_price_usd,
        packageSaleType: item.package_sale_type,
        
        // Units
        grossUnitsSold: item.gross_units_sold,
        grossUnitsReturned: item.gross_units_returned,
        grossUnitsActivated: item.gross_units_activated,
        netUnitsSold: item.net_units_sold,
        
        // Revenue (USD)
        grossSalesUsd,
        grossReturnsUsd,
        netSalesUsd,
        netTaxUsd,
        
        // Discounts & revenue share
        combinedDiscountId: item.combined_discount_id,
        totalDiscountPercentage: item.total_discount_percentage,
        additionalRevenueShareTier: item.additional_revenue_share_tier,
        keyRequestId: item.key_request_id,
        viwGrantPartnerid: item.viw_grant_partnerid,
        
        // Lookup data (friendly names)
        appName: appNameMap.get(primaryAppid),
        packageName: item.packageid ? packageNameMap.get(item.packageid) : undefined,
        bundleName: item.bundleid ? bundleNameMap.get(item.bundleid) : undefined,
        partnerName: item.partnerid ? partnerNameMap.get(item.partnerid) : undefined,
        countryName: countryInfo?.name,
        region: countryInfo?.region,
        gameItemDescription: gameItemInfo?.description,
        gameItemCategory: gameItemInfo?.category,
        keyRequestNotes: keyRequestInfo?.notes,
        gameCodeDescription: keyRequestInfo?.gameCodeDescription,
        combinedDiscountName: item.combined_discount_id ? discountInfoMap.get(item.combined_discount_id) : undefined,
        
        // Legacy fields for backwards compatibility with charts
        appId: primaryAppid,
        unitsSold
      });
    }
    
    // Check if there's more data
    hasMore = maxId > pageHighwatermark && results.length > 0;
    pageHighwatermark = maxId;
  }
  
  return dateSales;
}

// Process dates in parallel batches with incremental database saves
// This prevents memory issues when processing thousands of dates
async function processDatesInBatches(
  apiKey: string,
  apiKeyId: string,
  dates: string[],
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<number> {
  let processedCount = 0;
  let totalRecords = 0;
  
  // Process in batches
  for (let i = 0; i < dates.length; i += PARALLEL_BATCH_SIZE) {
    // Check if cancelled before each batch
    if (signal?.aborted) {
      throw new SyncCancelledError();
    }
    
    const batch = dates.slice(i, i + PARALLEL_BATCH_SIZE);
    
    // Fetch all dates in this batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (date) => {
        const sales = await fetchSalesForDate(apiKey, apiKeyId, date, signal);
        return { date, sales };
      })
    );
    
    // Collect batch sales and save immediately to database
    // This prevents memory accumulation over thousands of dates
    const batchSales: SalesRecord[] = [];
    for (const result of batchResults) {
      batchSales.push(...result.sales);
      totalRecords += result.sales.length;
      processedCount++;
    }
    
    // Save this batch to database immediately
    if (batchSales.length > 0) {
      await db.sales.bulkPut(batchSales);
    }
    
    // Get the last date in this batch for display
    const lastDateInBatch = batch[batch.length - 1];
    
    // Update progress after each batch (not each result) and yield to UI
    onProgress?.({
      phase: 'sales',
      message: `Fetching sales data...`,
      current: processedCount,
      total: dates.length,
      currentDate: lastDateInBatch,
      recordsFetched: totalRecords
    });
    
    // Yield to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  // Return total count (data is already saved to DB)
  return totalRecords;
}

export const browserServices: SalesService = {
  // ============================================================================
  // Multi-key API key management
  // ============================================================================
  
  async getAllApiKeys(): Promise<ApiKeyInfo[]> {
    const stored = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      // Ensure we always return an array
      if (!Array.isArray(parsed)) {
        console.warn('API keys storage was not an array, resetting');
        return [];
      }
      return parsed as ApiKeyInfo[];
    } catch {
      return [];
    }
  },

  async getApiKey(id: string): Promise<string | null> {
    return localStorage.getItem(`${API_KEY_VALUES_PREFIX}${id}`);
  },

  async addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo> {
    const id = generateId();
    const keyInfo: ApiKeyInfo = {
      id,
      displayName,
      keyHash: getKeyHash(key),
      createdAt: Date.now()
    };
    
    // Store the key value
    localStorage.setItem(`${API_KEY_VALUES_PREFIX}${id}`, key);
    
    // Add to keys list
    let keys = await this.getAllApiKeys();
    // Ensure keys is an array (defensive check)
    if (!Array.isArray(keys)) {
      console.warn('getAllApiKeys did not return an array, creating new array');
      keys = [];
    }
    keys.push(keyInfo);
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
    
    return keyInfo;
  },

  async updateApiKeyName(id: string, displayName: string): Promise<void> {
    const keys = await this.getAllApiKeys();
    if (!Array.isArray(keys)) throw new Error('API keys storage corrupted');
    
    const keyIndex = keys.findIndex(k => k.id === id);
    if (keyIndex === -1) throw new Error('API key not found');
    
    keys[keyIndex].displayName = displayName;
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys));
  },

  async deleteApiKey(id: string): Promise<void> {
    // Remove the key value
    localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${id}`);
    // Remove the highwatermark
    localStorage.removeItem(`${HIGHWATERMARK_PREFIX}${id}`);
    
    // Remove from keys list
    const keys = await this.getAllApiKeys();
    const filtered = keys.filter(k => k.id !== id);
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(filtered));
  },

  // ============================================================================
  // Data operations
  // ============================================================================

  async getChangedDates(apiKey: string, apiKeyId: string): Promise<ChangedDatesResult> {
    const storedHighwatermark = await this.getHighwatermark(apiKeyId);
    
    const response = await fetchFromSteamApi<SteamChangedDatesResponse>(
      'IPartnerFinancialsService/GetChangedDatesForPartner/v1',
      {
        key: apiKey,
        highwatermark: storedHighwatermark.toString()
      }
    );
    
    const dates = response.response?.dates || [];
    const rawHighwatermark = response.response?.result_highwatermark;
    const newHighwatermark = typeof rawHighwatermark === 'string' 
      ? parseInt(rawHighwatermark, 10) 
      : (rawHighwatermark ?? storedHighwatermark);
    
    return { dates, newHighwatermark };
  },

  async fetchSalesData(params: FetchParams): Promise<FetchResult> {
    const { apiKey, apiKeyId, onProgress, signal } = params;
    
    // Phase 1: Initialize
    onProgress?.({
      phase: 'init',
      message: 'Connecting to Steam Partner API...',
      current: 0,
      total: 100,
      recordsFetched: 0
    });
    
    // Check if already cancelled
    if (signal?.aborted) {
      throw new SyncCancelledError();
    }
    
    // Get current highwatermark (stored from previous successful sync)
    const storedHighwatermark = await this.getHighwatermark(apiKeyId);
    
    // Phase 2: Get changed dates since our last sync
    onProgress?.({
      phase: 'dates',
      message: storedHighwatermark > 0 
        ? 'Checking for updates since last sync...' 
        : 'First sync - fetching all historical data...',
      current: 0,
      total: 1,
      recordsFetched: 0
    });
    
    const changedDatesResponse = await fetchFromSteamApi<SteamChangedDatesResponse>(
      'IPartnerFinancialsService/GetChangedDatesForPartner/v1',
      {
        key: apiKey,
        highwatermark: storedHighwatermark.toString()
      },
      signal
    );
    
    const dates = changedDatesResponse.response?.dates || [];
    // Parse the new highwatermark as a number (API may return it as string)
    const rawHighwatermark = changedDatesResponse.response?.result_highwatermark;
    const newHighwatermark = typeof rawHighwatermark === 'string' 
      ? parseInt(rawHighwatermark, 10) 
      : (rawHighwatermark ?? storedHighwatermark);
    
    onProgress?.({
      phase: 'dates',
      message: dates.length > 0
        ? `Found ${dates.length} date${dates.length === 1 ? '' : 's'} with new/updated data`
        : 'Checking complete',
      current: 1,
      total: 1,
      recordsFetched: 0
    });
    
    // If no dates to process, we're already up to date
    if (dates.length === 0) {
      onProgress?.({
        phase: 'complete',
        message: 'Already up to date! No new sales data found.',
        current: 0,
        total: 0,
        recordsFetched: 0
      });
      // Return empty result but still provide the highwatermark for saving
      return { sales: [], newHighwatermark };
    }
    
    // Phase 3: Fetch sales data in parallel batches
    // Data is saved incrementally to the database to prevent memory issues
    const totalRecordsSaved = await processDatesInBatches(apiKey, apiKeyId, dates, onProgress, signal);
    
    // Phase 4: Compute aggregates for fast queries
    // This pre-computes summaries so the UI doesn't have to iterate all records
    if (totalRecordsSaved > 0) {
      onProgress?.({
        phase: 'saving',
        message: 'Computing aggregates for faster loading...',
        current: 0,
        total: 100,
        recordsFetched: totalRecordsSaved
      });
      
      await computeAndStoreAggregates((message, progress) => {
        onProgress?.({
          phase: 'saving',
          message,
          current: progress,
          total: 100,
          recordsFetched: totalRecordsSaved
        });
      });
    }
    
    // Phase 5: Data is already saved - just report completion
    // NOTE: We do NOT save the highwatermark here!
    // The caller must save it AFTER this function returns successfully.
    
    // Return empty array since data is already in DB, but include count for reporting
    return { sales: [], newHighwatermark, recordCount: totalRecordsSaved };
  },

  async getSalesFromDb(filters: Filters): Promise<SalesRecord[]> {
    // For unfiltered queries on large datasets, consider using pagination
    // This method still loads all data but uses more efficient queries
    let collection = db.sales.toCollection();
    
    // Use indexed queries where possible
    if (filters.appId != null) {
      collection = db.sales.where('appId').equals(filters.appId);
    } else if (filters.startDate && filters.endDate) {
      collection = db.sales.where('date').between(filters.startDate, filters.endDate, true, true);
    } else if (filters.startDate) {
      collection = db.sales.where('date').aboveOrEqual(filters.startDate);
    } else if (filters.endDate) {
      collection = db.sales.where('date').belowOrEqual(filters.endDate);
    }
    
    let results = await collection.toArray();
    
    // Apply remaining filters in memory
    if (filters.countryCode) {
      results = results.filter(r => r.countryCode === filters.countryCode);
    }
    // Date filters if we used appId index instead
    if (filters.appId != null) {
      if (filters.startDate) {
        results = results.filter(r => r.date >= filters.startDate!);
      }
      if (filters.endDate) {
        results = results.filter(r => r.date <= filters.endDate!);
      }
    }
    
    return results;
  },

  async saveSalesData(data: SalesRecord[], apiKeyId: string): Promise<void> {
    // Tag all records with the API key ID
    const taggedData = data.map(record => ({ ...record, apiKeyId }));
    // Use bulkPut to handle duplicates (upsert behavior)
    await db.sales.bulkPut(taggedData);
  },

  // ============================================================================
  // Per-key highwatermark management
  // ============================================================================

  async getHighwatermark(apiKeyId: string): Promise<number> {
    const stored = localStorage.getItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`);
    return stored ? parseInt(stored, 10) : 0;
  },

  async setHighwatermark(apiKeyId: string, value: number): Promise<void> {
    localStorage.setItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`, value.toString());
  },

  // ============================================================================
  // Data management
  // ============================================================================

  async clearAllData(): Promise<void> {
    // Clear all sales records
    await db.sales.clear();
    
    // Clear sync metadata
    await db.syncMeta.clear();
    
    // Clear pre-computed aggregates
    await clearAggregates();
    
    // Clear all API keys and their data from localStorage
    const keys = await this.getAllApiKeys();
    for (const key of keys) {
      localStorage.removeItem(`${API_KEY_VALUES_PREFIX}${key.id}`);
      localStorage.removeItem(`${HIGHWATERMARK_PREFIX}${key.id}`);
    }
    localStorage.removeItem(API_KEYS_STORAGE_KEY);
  },

  async clearDataForKey(apiKeyId: string): Promise<void> {
    // Delete sales records for this API key
    await db.sales.where('apiKeyId').equals(apiKeyId).delete();
    
    // Reset highwatermark for this key
    localStorage.removeItem(`${HIGHWATERMARK_PREFIX}${apiKeyId}`);
    
    // Recompute aggregates
    await clearAggregates();
    const count = await db.sales.count();
    if (count > 0) {
      await computeAndStoreAggregates();
    }
  },

  async getExistingDates(apiKeyId: string): Promise<Set<string>> {
    // Get unique dates for this specific API key
    const dates = new Set<string>();
    const records = await db.sales.where('apiKeyId').equals(apiKeyId).toArray();
    for (const record of records) {
      dates.add(record.date);
    }
    return dates;
  }
};
