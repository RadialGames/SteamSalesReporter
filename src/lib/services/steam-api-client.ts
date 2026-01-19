// Steam API client for browser mode
// Uses Vite proxy for API calls

import type { SalesRecord, SteamDetailedSalesResponse, SteamChangedDatesResponse } from './types';

// Custom error for cancelled operations
export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled by user');
    this.name = 'SyncCancelledError';
  }
}

/**
 * Make a request to the Steam Partner API via Vite proxy
 */
export async function fetchFromSteamApi<T>(
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<T> {
  const queryString = new URLSearchParams(params).toString();
  // Note: partner.steam-api.com doesn't use /webapi/ prefix
  const url = `/api/steam/${endpoint}?${queryString}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch all sales for a single date (handles pagination)
 */
export async function fetchSalesForDate(
  apiKey: string,
  apiKeyId: string,
  date: string,
  signal?: AbortSignal
): Promise<SalesRecord[]> {
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
        highwatermark_id: pageHighwatermark.toString(),
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
      countryInfoMap.set(country.country_code, {
        name: country.country_name,
        region: country.region,
      });
    }

    const gameItemInfoMap = new Map<string, { description: string; category: string }>();
    for (const item of salesResponse.response?.game_item_info || []) {
      gameItemInfoMap.set(`${item.appid}-${item.game_item_id}`, {
        description: item.game_item_description,
        category: item.game_item_category,
      });
    }

    const keyRequestInfoMap = new Map<number, { notes: string; gameCodeDescription: string }>();
    for (const kr of salesResponse.response?.key_request_info || []) {
      keyRequestInfoMap.set(kr.key_request_id, {
        notes: kr.key_request_notes,
        gameCodeDescription: kr.game_code_description,
      });
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
      const unitsSold =
        item.net_units_sold ?? item.gross_units_sold ?? item.gross_units_activated ?? 0;

      // Get lookup data
      const countryInfo = countryInfoMap.get(item.country_code);
      const gameItemKey =
        item.appid && item.game_item_id ? `${item.appid}-${item.game_item_id}` : null;
      const gameItemInfo = gameItemKey ? gameItemInfoMap.get(gameItemKey) : null;
      const keyRequestInfo = item.key_request_id
        ? keyRequestInfoMap.get(item.key_request_id)
        : null;

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
        combinedDiscountName: item.combined_discount_id
          ? discountInfoMap.get(item.combined_discount_id)
          : undefined,

        // Legacy fields for backwards compatibility with charts
        appId: primaryAppid,
        unitsSold,
      });
    }

    // Check if there's more data
    hasMore = maxId > pageHighwatermark && results.length > 0;
    pageHighwatermark = maxId;
  }

  return dateSales;
}

/**
 * Fetch changed dates since last sync
 */
export async function fetchChangedDates(
  apiKey: string,
  highwatermark: number,
  signal?: AbortSignal
): Promise<{ dates: string[]; newHighwatermark: number }> {
  const response = await fetchFromSteamApi<SteamChangedDatesResponse>(
    'IPartnerFinancialsService/GetChangedDatesForPartner/v1',
    {
      key: apiKey,
      highwatermark: highwatermark.toString(),
    },
    signal
  );

  const dates = response.response?.dates || [];
  const rawHighwatermark = response.response?.result_highwatermark;
  const newHighwatermark =
    typeof rawHighwatermark === 'string'
      ? parseInt(rawHighwatermark, 10)
      : (rawHighwatermark ?? highwatermark);

  return { dates, newHighwatermark };
}
