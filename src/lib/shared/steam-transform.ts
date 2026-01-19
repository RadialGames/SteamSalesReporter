// Shared Steam API response transformation utilities
// Used by both browser and tauri service implementations

import type { SalesRecord, SteamDetailedSalesResponse, SteamSaleItem } from '$lib/services/types';

/**
 * Lookup maps built from Steam API response info arrays
 */
export interface LookupMaps {
  appNameMap: Map<number, string>;
  packageNameMap: Map<number, string>;
  bundleNameMap: Map<number, string>;
  partnerNameMap: Map<number, string>;
  countryInfoMap: Map<string, { name: string; region: string }>;
  gameItemInfoMap: Map<string, { description: string; category: string }>;
  keyRequestInfoMap: Map<number, { notes: string; gameCodeDescription: string }>;
  discountInfoMap: Map<number, string>;
}

/**
 * Build lookup maps from Steam API response info arrays
 */
export function buildLookupMaps(response: SteamDetailedSalesResponse['response']): LookupMaps {
  const appNameMap = new Map<number, string>();
  for (const app of response.app_info || []) {
    appNameMap.set(app.appid, app.app_name);
  }

  const packageNameMap = new Map<number, string>();
  for (const pkg of response.package_info || []) {
    packageNameMap.set(pkg.packageid, pkg.package_name);
  }

  const bundleNameMap = new Map<number, string>();
  for (const bundle of response.bundle_info || []) {
    bundleNameMap.set(bundle.bundleid, bundle.bundle_name);
  }

  const partnerNameMap = new Map<number, string>();
  for (const partner of response.partner_info || []) {
    partnerNameMap.set(partner.partnerid, partner.partner_name);
  }

  const countryInfoMap = new Map<string, { name: string; region: string }>();
  for (const country of response.country_info || []) {
    countryInfoMap.set(country.country_code, { 
      name: country.country_name, 
      region: country.region 
    });
  }

  const gameItemInfoMap = new Map<string, { description: string; category: string }>();
  for (const item of response.game_item_info || []) {
    gameItemInfoMap.set(`${item.appid}-${item.game_item_id}`, { 
      description: item.game_item_description, 
      category: item.game_item_category 
    });
  }

  const keyRequestInfoMap = new Map<number, { notes: string; gameCodeDescription: string }>();
  for (const kr of response.key_request_info || []) {
    keyRequestInfoMap.set(kr.key_request_id, { 
      notes: kr.key_request_notes, 
      gameCodeDescription: kr.game_code_description 
    });
  }

  const discountInfoMap = new Map<number, string>();
  for (const discount of response.combined_discount_info || []) {
    discountInfoMap.set(discount.combined_discount_id, discount.combined_discount_name);
  }

  return {
    appNameMap,
    packageNameMap,
    bundleNameMap,
    partnerNameMap,
    countryInfoMap,
    gameItemInfoMap,
    keyRequestInfoMap,
    discountInfoMap
  };
}

/**
 * Transform a single Steam API sale item to our SalesRecord format
 */
export function transformSaleItem(
  item: SteamSaleItem, 
  apiKeyId: string, 
  maps: LookupMaps
): SalesRecord {
  const primaryAppid = item.primary_appid || item.appid || 0;
  const grossSalesUsd = parseFloat(item.gross_sales_usd || '0');
  const grossReturnsUsd = parseFloat(item.gross_returns_usd || '0');
  const netSalesUsd = parseFloat(item.net_sales_usd || '0');
  const netTaxUsd = parseFloat(item.net_tax_usd || '0');
  const unitsSold = item.net_units_sold ?? item.gross_units_sold ?? item.gross_units_activated ?? 0;

  // Get lookup data
  const countryInfo = maps.countryInfoMap.get(item.country_code);
  const gameItemKey = item.appid && item.game_item_id ? `${item.appid}-${item.game_item_id}` : null;
  const gameItemInfo = gameItemKey ? maps.gameItemInfoMap.get(gameItemKey) : null;
  const keyRequestInfo = item.key_request_id ? maps.keyRequestInfoMap.get(item.key_request_id) : null;

  return {
    // API Key association
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
    appName: maps.appNameMap.get(primaryAppid),
    packageName: item.packageid ? maps.packageNameMap.get(item.packageid) : undefined,
    bundleName: item.bundleid ? maps.bundleNameMap.get(item.bundleid) : undefined,
    partnerName: item.partnerid ? maps.partnerNameMap.get(item.partnerid) : undefined,
    countryName: countryInfo?.name,
    region: countryInfo?.region,
    gameItemDescription: gameItemInfo?.description,
    gameItemCategory: gameItemInfo?.category,
    keyRequestNotes: keyRequestInfo?.notes,
    gameCodeDescription: keyRequestInfo?.gameCodeDescription,
    combinedDiscountName: item.combined_discount_id ? maps.discountInfoMap.get(item.combined_discount_id) : undefined,

    // Legacy fields for backwards compatibility with charts
    appId: primaryAppid,
    unitsSold
  };
}

/**
 * Transform an entire Steam API response to SalesRecord array
 */
export function transformSteamResponse(
  response: SteamDetailedSalesResponse, 
  apiKeyId: string
): SalesRecord[] {
  const results = response.response?.results || [];
  if (results.length === 0) return [];

  const maps = buildLookupMaps(response.response);
  return results.map(item => transformSaleItem(item, apiKeyId, maps));
}

/**
 * Parse max_id from Steam API response (handles string or number)
 */
export function parseMaxId(maxId: string | undefined): number {
  return parseInt(maxId || '0', 10) || 0;
}
