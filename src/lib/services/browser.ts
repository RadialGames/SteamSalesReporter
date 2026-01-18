// Browser-mode service implementation
// Uses Vite proxy for API calls, IndexedDB for storage, localStorage for settings

import type { SalesService, SalesRecord, FetchParams, FetchResult, Filters, SteamChangedDatesResponse, SteamDetailedSalesResponse, ProgressCallback } from './types';
import { db } from '$lib/db/dexie';

const API_KEY_STORAGE_KEY = 'steam_api_key';
const HIGHWATERMARK_KEY = 'highwatermark';

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
async function fetchSalesForDate(apiKey: string, date: string, signal?: AbortSignal): Promise<SalesRecord[]> {
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
        unitsSold,
        netRevenue: netSalesUsd,
        grossRevenue: grossSalesUsd
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
        const sales = await fetchSalesForDate(apiKey, date, signal);
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
  async getApiKey(): Promise<string | null> {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  },

  async setApiKey(key: string): Promise<void> {
    localStorage.setItem(API_KEY_STORAGE_KEY, key);
  },

  async fetchSalesData(params: FetchParams): Promise<FetchResult> {
    const { apiKey, onProgress, signal } = params;
    
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
    const storedHighwatermark = await this.getHighwatermark();
    
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
    const totalRecordsSaved = await processDatesInBatches(apiKey, dates, onProgress, signal);
    
    // Phase 4: Data is already saved - just report completion
    // NOTE: We do NOT save the highwatermark here!
    // The caller must save it AFTER this function returns successfully.
    
    // Return empty array since data is already in DB, but include count for reporting
    return { sales: [], newHighwatermark, recordCount: totalRecordsSaved };
  },

  async getSalesFromDb(filters: Filters): Promise<SalesRecord[]> {
    let collection = db.sales.toCollection();
    
    if (filters.appId) {
      collection = db.sales.where('appId').equals(filters.appId);
    }
    
    let results = await collection.toArray();
    
    // Apply date filters in memory (Dexie compound queries can be tricky)
    if (filters.startDate) {
      results = results.filter(r => r.date >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter(r => r.date <= filters.endDate!);
    }
    if (filters.countryCode) {
      results = results.filter(r => r.countryCode === filters.countryCode);
    }
    
    return results;
  },

  async saveSalesData(data: SalesRecord[]): Promise<void> {
    // Use bulkPut to handle duplicates (upsert behavior)
    await db.sales.bulkPut(data);
  },

  async getHighwatermark(): Promise<number> {
    const meta = await db.syncMeta.get(HIGHWATERMARK_KEY);
    return meta ? parseInt(meta.value, 10) : 0;
  },

  async setHighwatermark(value: number): Promise<void> {
    await db.syncMeta.put({ key: HIGHWATERMARK_KEY, value: value.toString() });
  },

  async clearAllData(): Promise<void> {
    // Clear all sales records
    await db.sales.clear();
    
    // Clear sync metadata (including highwatermark)
    await db.syncMeta.clear();
    
    // Also clear the API key from localStorage
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
};
