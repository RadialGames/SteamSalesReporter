// Shared types for the Steam Sales Analyzer

// API Key management
export interface ApiKeyInfo {
  id: string;           // UUID
  displayName?: string; // Optional user-friendly name
  keyHash: string;      // Last 4 chars for display identification
  createdAt: number;    // Timestamp
}

export interface SalesRecord {
  id?: number;
  
  // API Key association
  apiKeyId: string;     // Which API key this data came from
  
  // Core identifiers (from results array)
  date: string;
  lineItemType?: string; // "Package", "MicroTxn", etc. (optional for legacy DB records)
  partnerid?: number;
  primaryAppid?: number;
  packageid?: number;
  bundleid?: number;
  appid?: number; // For MicroTxn items
  gameItemId?: number; // For MicroTxn items
  
  // Location & platform
  countryCode: string;
  platform?: string;
  currency?: string;
  
  // Pricing (strings from API)
  basePrice?: string;
  salePrice?: string;
  avgSalePriceUsd?: string;
  packageSaleType?: string; // "Steam", "Retail", etc.
  
  // Units
  grossUnitsSold?: number;
  grossUnitsReturned?: number;
  grossUnitsActivated?: number; // For Retail/key activations
  netUnitsSold?: number;
  
  // Revenue (USD - parsed to numbers)
  grossSalesUsd?: number;
  grossReturnsUsd?: number;
  netSalesUsd?: number;
  netTaxUsd?: number;
  
  // Discounts & revenue share
  combinedDiscountId?: number;
  totalDiscountPercentage?: number;
  additionalRevenueShareTier?: number;
  keyRequestId?: number; // For Retail keys
  viwGrantPartnerid?: number;
  
  // Lookup data (from info arrays in response)
  appName?: string; // From app_info
  packageName?: string; // From package_info
  bundleName?: string; // From bundle_info
  partnerName?: string; // From partner_info
  countryName?: string; // From country_info
  region?: string; // From country_info
  gameItemDescription?: string; // From game_item_info
  gameItemCategory?: string; // From game_item_info
  keyRequestNotes?: string; // From key_request_info
  gameCodeDescription?: string; // From key_request_info
  combinedDiscountName?: string; // From combined_discount_info
  
  // Legacy fields for backwards compatibility with charts
  appId: number; // Alias for primaryAppid
  unitsSold: number; // Alias for netUnitsSold or grossUnitsSold
}

export interface SyncMeta {
  key: string;
  value: string;
}

export interface FetchProgress {
  phase: 'init' | 'dates' | 'fetch' | 'sales' | 'saving' | 'complete' | 'error' | 'cancelled';
  message: string;
  current: number;
  total: number;
  currentDate?: string;
  recordsFetched?: number;
  error?: string;
  // Multi-key sync progress
  currentKeyId?: string;
  currentKeyName?: string;
  currentKeyIndex?: number;
  totalKeys?: number;
  // Re-processing info
  datesToReprocess?: number;
  // Per-key breakdown for segmented progress bar
  keySegments?: {
    keyId: string;
    keyName: string;
    newDates: number;
    reprocessDates: number;
  }[];
}

export type ProgressCallback = (progress: FetchProgress) => void;

/** Simple progress callback for data operations */
export type DataProgressCallback = (message: string, progress: number) => void;

export interface FetchParams {
  apiKey: string;
  apiKeyId: string;     // ID of the API key for association
  startDate?: string;
  endDate?: string;
  onProgress?: ProgressCallback;
  signal?: AbortSignal;
}

export interface Filters {
  startDate?: string;
  endDate?: string;
  appIds?: number[];       // Multi-select product filter
  packageIds?: number[];    // Multi-select package filter
  countryCode?: string;
  apiKeyIds?: string[];    // Multi-select API key source filter
}

// Result from fetchSalesData - includes highwatermark for deferred saving
export interface FetchResult {
  sales: SalesRecord[];
  newHighwatermark: number;
  recordCount?: number; // Total records saved (when using incremental save)
}

// Result from getChangedDates - for pre-counting dates across all keys
export interface ChangedDatesResult {
  dates: string[];
  newHighwatermark: number;
}

export interface SalesService {
  // Multi-key API key management
  getAllApiKeys(): Promise<ApiKeyInfo[]>;
  getApiKey(id: string): Promise<string | null>;
  addApiKey(key: string, displayName?: string): Promise<ApiKeyInfo>;
  updateApiKeyName(id: string, displayName: string): Promise<void>;
  deleteApiKey(id: string): Promise<void>;
  
  // Data operations
  getChangedDates(apiKey: string, apiKeyId: string): Promise<ChangedDatesResult>;
  fetchSalesData(params: FetchParams): Promise<FetchResult>;
  getSalesFromDb(filters: Filters): Promise<SalesRecord[]>;
  saveSalesData(data: SalesRecord[], apiKeyId: string): Promise<void>;
  
  // Per-key highwatermark
  getHighwatermark(apiKeyId: string): Promise<number>;
  setHighwatermark(apiKeyId: string, value: number): Promise<void>;
  
  // Data management
  clearAllData(onProgress?: DataProgressCallback): Promise<void>;
  clearDataForKey(apiKeyId: string, onProgress?: DataProgressCallback): Promise<void>;
  
  // Helper to get dates already in DB for prioritization
  getExistingDates(apiKeyId: string): Promise<Set<string>>;
}

// Steam API response types
export interface SteamChangedDatesResponse {
  response: {
    dates?: string[];
    result_highwatermark?: number;
  };
}

export interface SteamDetailedSalesResponse {
  response: {
    results?: SteamSaleItem[];
    max_id?: string; // API returns string
    // Lookup arrays for friendly names
    app_info?: { appid: number; app_name: string }[];
    package_info?: { packageid: number; package_name: string }[];
    bundle_info?: { bundleid: number; bundle_name: string }[];
    partner_info?: { partnerid: number; partner_name: string }[];
    country_info?: { country_code: string; country_name: string; region: string }[];
    game_item_info?: { appid: number; game_item_id: number; game_item_description: string; game_item_category: string }[];
    key_request_info?: { 
      key_request_id: number; 
      key_request_notes: string; 
      game_code_id: number;
      game_code_description: string;
      territory_code_id: number;
      territory_code_description: string;
    }[];
    combined_discount_info?: {
      combined_discount_id: number;
      combined_discount_name: string;
      total_discount_percentage: number;
      discount_ids: number[];
    }[];
  };
}

// Matches the Steam API response exactly per documentation
export interface SteamSaleItem {
  // Core identifiers
  date: string;
  line_item_type: string; // "Package", "MicroTxn", etc.
  partnerid?: number;
  primary_appid?: number;
  packageid?: number;
  bundleid?: number;
  appid?: number; // For MicroTxn
  game_item_id?: number; // For MicroTxn
  
  // Location & platform
  country_code: string;
  platform?: string;
  currency?: string;
  
  // Pricing (strings from API)
  base_price?: string;
  sale_price?: string;
  avg_sale_price_usd?: string; // For MicroTxn
  package_sale_type?: string; // "Steam", "Retail", etc.
  
  // Units
  gross_units_sold?: number;
  gross_units_returned?: number;
  gross_units_activated?: number; // For Retail key activations
  net_units_sold?: number;
  
  // Revenue in USD (API returns strings)
  gross_sales_usd?: string;
  gross_returns_usd?: string;
  net_sales_usd?: string;
  net_tax_usd?: string;
  
  // Discounts & revenue share
  combined_discount_id?: number;
  total_discount_percentage?: number;
  additional_revenue_share_tier?: number;
  key_request_id?: number; // For Retail keys
  viw_grant_partnerid?: number;
}

// Aggregate types for charts
export interface DailySummary {
  date: string;
  totalRevenue: number;
  totalUnits: number;
}

export interface AppSummary {
  appId: number;
  appName: string;
  totalRevenue: number;
  totalUnits: number;
}

export interface CountrySummary {
  countryCode: string;
  totalRevenue: number;
  totalUnits: number;
}
