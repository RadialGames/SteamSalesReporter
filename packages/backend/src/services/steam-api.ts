// Steam Partner API client for the backend
// Makes direct requests to Steam API (no proxy needed)

const STEAM_API_BASE = 'https://partner.steam-api.com';

// Types matching Steam API responses
export interface SteamChangedDatesResponse {
  response: {
    dates?: string[];
    result_highwatermark?: number | string;
  };
}

export interface SteamSaleItem {
  id?: number;
  date: string;
  line_item_type: string;
  partnerid?: number;
  primary_appid?: number;
  packageid?: number;
  bundleid?: number;
  appid?: number;
  game_item_id?: number;
  country_code: string;
  platform?: string;
  currency?: string;
  base_price?: string;
  sale_price?: string;
  avg_sale_price_usd?: string;
  package_sale_type?: string;
  gross_units_sold?: number;
  gross_units_returned?: number;
  gross_units_activated?: number;
  net_units_sold?: number;
  gross_sales_usd?: string;
  gross_returns_usd?: string;
  net_sales_usd?: string;
  net_tax_usd?: string;
  combined_discount_id?: number;
  total_discount_percentage?: number;
  additional_revenue_share_tier?: number;
  key_request_id?: number;
  viw_grant_partnerid?: number;
}

export interface SteamDetailedSalesResponse {
  response: {
    results?: SteamSaleItem[];
    max_id?: string;
    app_info?: { appid: number; app_name: string }[];
    package_info?: { packageid: number; package_name: string }[];
    bundle_info?: { bundleid: number; bundle_name: string }[];
    partner_info?: { partnerid: number; partner_name: string }[];
    country_info?: { country_code: string; country_name: string; region: string }[];
    game_item_info?: {
      appid: number;
      game_item_id: number;
      game_item_description: string;
      game_item_category: string;
    }[];
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

// Error class for API errors
export class SteamApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'SteamApiError';
  }
}

// Fetch with retry logic
async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'SteamSalesAnalyzer/1.0',
          Accept: 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        if (retryable && attempt < maxRetries - 1) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new SteamApiError(
          `Steam API error: ${response.status} ${response.statusText}`,
          response.status,
          retryable
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error as Error;
      if (error instanceof SteamApiError && !error.retryable) {
        throw error;
      }
      // Network errors are retryable
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Unknown error during Steam API request');
}

/**
 * Fetch changed dates since last sync
 */
export async function fetchChangedDates(
  apiKey: string,
  highwatermark: number,
  signal?: AbortSignal
): Promise<{ dates: string[]; newHighwatermark: number }> {
  const params = new URLSearchParams({
    key: apiKey,
    highwatermark: highwatermark.toString(),
  });

  const url = `${STEAM_API_BASE}/IPartnerFinancialsService/GetChangedDatesForPartner/v1?${params}`;
  const response = await fetchWithRetry<SteamChangedDatesResponse>(url, { signal });

  const dates = response.response?.dates || [];
  const rawHighwatermark = response.response?.result_highwatermark;
  const newHighwatermark =
    typeof rawHighwatermark === 'string'
      ? parseInt(rawHighwatermark, 10)
      : (rawHighwatermark ?? highwatermark);

  return { dates, newHighwatermark };
}

/**
 * Fetch detailed sales for a single date (handles pagination)
 */
export async function fetchDetailedSales(
  apiKey: string,
  date: string,
  signal?: AbortSignal
): Promise<SteamDetailedSalesResponse[]> {
  const pages: SteamDetailedSalesResponse[] = [];
  let pageHighwatermark = 0;
  let hasMore = true;

  while (hasMore) {
    if (signal?.aborted) {
      throw new Error('Request cancelled');
    }

    const params = new URLSearchParams({
      key: apiKey,
      date,
      highwatermark_id: pageHighwatermark.toString(),
    });

    const url = `${STEAM_API_BASE}/IPartnerFinancialsService/GetDetailedSales/v1?${params}`;
    const response = await fetchWithRetry<SteamDetailedSalesResponse>(url, { signal });

    pages.push(response);

    const results = response.response?.results || [];
    const maxIdStr = response.response?.max_id || '0';
    const maxId = parseInt(maxIdStr, 10) || 0;

    hasMore = maxId > pageHighwatermark && results.length > 0;
    pageHighwatermark = maxId;
  }

  return pages;
}

/**
 * Convert USD string to cents (integer)
 */
export function usdToCents(usd: string | undefined): number {
  if (!usd) return 0;
  const parsed = parseFloat(usd);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

/**
 * Convert price string to cents (handles various formats)
 */
export function priceToCents(price: string | undefined): number | null {
  if (!price) return null;
  const parsed = parseFloat(price);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}
