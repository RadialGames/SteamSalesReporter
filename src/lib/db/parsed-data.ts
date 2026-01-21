/**
 * Tier 2: Parsed Sales Records Operations
 *
 * Stores typed, queryable sales records extracted from raw JSON.
 * This is the queryable layer for filtering, sorting, and aggregation.
 */

import { sql, batch } from './sqlite';
import type { ParsedSalesRecord } from './sqlite-schema';
import type { Filters, SalesRecord } from '$lib/services/types';
import type { UnitMetrics } from '$lib/utils/calculations';

// Re-export the ParsedSalesRecord type
export type { ParsedSalesRecord };

/**
 * Convert a SalesRecord (camelCase) to ParsedSalesRecord (snake_case for DB)
 */
function toDbRecord(record: SalesRecord & { id: string; apiKeyId: string }): ParsedSalesRecord {
  return {
    id: record.id,
    api_key_id: record.apiKeyId,
    date: record.date,
    line_item_type: record.lineItemType,
    partnerid: record.partnerid,
    primary_appid: record.primaryAppid,
    packageid: record.packageid,
    bundleid: record.bundleid,
    appid: record.appid,
    game_item_id: record.gameItemId,
    country_code: record.countryCode,
    platform: record.platform,
    currency: record.currency,
    base_price: record.basePrice,
    sale_price: record.salePrice,
    avg_sale_price_usd: record.avgSalePriceUsd,
    package_sale_type: record.packageSaleType,
    gross_units_sold: record.grossUnitsSold ?? 0,
    gross_units_returned: record.grossUnitsReturned ?? 0,
    gross_units_activated: record.grossUnitsActivated ?? 0,
    net_units_sold: record.netUnitsSold ?? 0,
    gross_sales_usd: record.grossSalesUsd ?? 0,
    gross_returns_usd: record.grossReturnsUsd ?? 0,
    net_sales_usd: record.netSalesUsd ?? 0,
    net_tax_usd: record.netTaxUsd ?? 0,
    combined_discount_id: record.combinedDiscountId,
    total_discount_percentage: record.totalDiscountPercentage,
    additional_revenue_share_tier: record.additionalRevenueShareTier,
    key_request_id: record.keyRequestId,
    viw_grant_partnerid: record.viwGrantPartnerid,
    app_name: record.appName,
    package_name: record.packageName,
    bundle_name: record.bundleName,
    partner_name: record.partnerName,
    country_name: record.countryName,
    region: record.region,
    game_item_description: record.gameItemDescription,
    game_item_category: record.gameItemCategory,
    key_request_notes: record.keyRequestNotes,
    game_code_description: record.gameCodeDescription,
    combined_discount_name: record.combinedDiscountName,
    app_id: record.appId,
    units_sold: record.unitsSold ?? 0,
  };
}

/**
 * Convert a ParsedSalesRecord (snake_case) back to SalesRecord format (camelCase)
 * Creates a clean object without any potential prototype pollution or non-serializable properties
 */
function fromDbRecord(record: ParsedSalesRecord): SalesRecord {
  // Create a clean object using Object.create(null) to avoid prototype pollution
  const cleanRecord = Object.create(null) as SalesRecord;

  // Explicitly assign only the properties we want
  cleanRecord.id = record.id;
  cleanRecord.apiKeyId = record.api_key_id;
  cleanRecord.date = record.date;
  cleanRecord.lineItemType = record.line_item_type;
  cleanRecord.partnerid = record.partnerid;
  cleanRecord.primaryAppid = record.primary_appid;
  cleanRecord.packageid = record.packageid;
  cleanRecord.bundleid = record.bundleid;
  cleanRecord.appid = record.appid;
  cleanRecord.gameItemId = record.game_item_id;
  cleanRecord.countryCode = record.country_code;
  cleanRecord.platform = record.platform;
  cleanRecord.currency = record.currency;
  cleanRecord.basePrice = record.base_price;
  cleanRecord.salePrice = record.sale_price;
  cleanRecord.avgSalePriceUsd = record.avg_sale_price_usd;
  cleanRecord.packageSaleType = record.package_sale_type;
  cleanRecord.grossUnitsSold = record.gross_units_sold;
  cleanRecord.grossUnitsReturned = record.gross_units_returned;
  cleanRecord.grossUnitsActivated = record.gross_units_activated;
  cleanRecord.netUnitsSold = record.net_units_sold;
  cleanRecord.grossSalesUsd = record.gross_sales_usd;
  cleanRecord.grossReturnsUsd = record.gross_returns_usd;
  cleanRecord.netSalesUsd = record.net_sales_usd;
  cleanRecord.netTaxUsd = record.net_tax_usd;
  cleanRecord.combinedDiscountId = record.combined_discount_id;
  cleanRecord.totalDiscountPercentage = record.total_discount_percentage;
  cleanRecord.additionalRevenueShareTier = record.additional_revenue_share_tier;
  cleanRecord.keyRequestId = record.key_request_id;
  cleanRecord.viwGrantPartnerid = record.viw_grant_partnerid;
  cleanRecord.appName = record.app_name;
  cleanRecord.packageName = record.package_name;
  cleanRecord.bundleName = record.bundle_name;
  cleanRecord.partnerName = record.partner_name;
  cleanRecord.countryName = record.country_name;
  cleanRecord.region = record.region;
  cleanRecord.gameItemDescription = record.game_item_description;
  cleanRecord.gameItemCategory = record.game_item_category;
  cleanRecord.keyRequestNotes = record.key_request_notes;
  cleanRecord.gameCodeDescription = record.game_code_description;
  cleanRecord.combinedDiscountName = record.combined_discount_name;
  cleanRecord.appId = record.app_id;
  cleanRecord.unitsSold = record.units_sold;

  return cleanRecord;
}

/**
 * Store parsed sales records (bulk operation)
 */
export async function storeParsedRecords(
  records: (SalesRecord & { id: string; apiKeyId: string })[]
): Promise<void> {
  if (records.length === 0) return;

  // Validate all records before processing
  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    if (!record.id || record.id.trim() === '') {
      throw new Error(`Record ${i} missing or invalid id: ${JSON.stringify(record)}`);
    }
    if (!record.apiKeyId || record.apiKeyId.trim() === '') {
      throw new Error(`Record ${i} missing or invalid apiKeyId: ${JSON.stringify(record)}`);
    }
    if (!record.date) {
      throw new Error(`Record ${i} missing date: ${JSON.stringify(record)}`);
    }
    if (!record.countryCode) {
      throw new Error(`Record ${i} missing countryCode: ${JSON.stringify(record)}`);
    }
    if (!record.lineItemType) {
      throw new Error(`Record ${i} missing lineItemType: ${JSON.stringify(record)}`);
    }
    if (!record.partnerid) {
      throw new Error(`Record ${i} missing partnerid: ${JSON.stringify(record)}`);
    }
  }

  // Convert to DB format and batch insert
  const dbRecords = records.map(toDbRecord);

  // Use batch for atomic insert
  await batch((batchSql) =>
    dbRecords.map(
      (r) => batchSql`
      INSERT OR REPLACE INTO parsed_sales (
        id, api_key_id, date, line_item_type, partnerid, primary_appid, packageid, bundleid,
        appid, game_item_id, country_code, platform, currency, base_price, sale_price,
        avg_sale_price_usd, package_sale_type, gross_units_sold, gross_units_returned,
        gross_units_activated, net_units_sold, gross_sales_usd, gross_returns_usd, net_sales_usd,
        net_tax_usd, combined_discount_id, total_discount_percentage, additional_revenue_share_tier,
        key_request_id, viw_grant_partnerid, app_name, package_name, bundle_name, partner_name,
        country_name, region, game_item_description, game_item_category, key_request_notes,
        game_code_description, combined_discount_name, app_id, units_sold
      ) VALUES (
        ${r.id}, ${r.api_key_id}, ${r.date}, ${r.line_item_type}, ${r.partnerid}, ${r.primary_appid},
        ${r.packageid}, ${r.bundleid}, ${r.appid}, ${r.game_item_id}, ${r.country_code}, ${r.platform},
        ${r.currency}, ${r.base_price}, ${r.sale_price}, ${r.avg_sale_price_usd}, ${r.package_sale_type},
        ${r.gross_units_sold}, ${r.gross_units_returned}, ${r.gross_units_activated}, ${r.net_units_sold},
        ${r.gross_sales_usd}, ${r.gross_returns_usd}, ${r.net_sales_usd}, ${r.net_tax_usd},
        ${r.combined_discount_id}, ${r.total_discount_percentage}, ${r.additional_revenue_share_tier},
        ${r.key_request_id}, ${r.viw_grant_partnerid}, ${r.app_name}, ${r.package_name}, ${r.bundle_name},
        ${r.partner_name}, ${r.country_name}, ${r.region}, ${r.game_item_description},
        ${r.game_item_category}, ${r.key_request_notes}, ${r.game_code_description},
        ${r.combined_discount_name}, ${r.app_id}, ${r.units_sold}
      )
    `
    )
  );
}

/**
 * Get parsed records with filters (paginated)
 * Note: Filters are applied in-memory for simplicity with sqlocal's tagged template API
 */
export async function getParsedRecords(
  page: number = 1,
  pageSize: number = 1000,
  filters?: Filters
): Promise<{
  data: SalesRecord[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  // Get all records (we'll filter in memory for complex filters)
  // For simple cases, use direct SQL
  let results: ParsedSalesRecord[];
  let total: number;

  if (!filters || Object.keys(filters).length === 0) {
    // No filters - use simple pagination
    const countResult = (await sql`SELECT COUNT(*) as count FROM parsed_sales`) as {
      count: number;
    }[];
    total = countResult[0]?.count ?? 0;

    const offset = (page - 1) * pageSize;
    results = (await sql`
      SELECT * FROM parsed_sales ORDER BY date DESC LIMIT ${pageSize} OFFSET ${offset}
    `) as ParsedSalesRecord[];
  } else if (filters.startDate && filters.endDate && !filters.appIds && !filters.countryCode) {
    // Date range only
    const countResult = (await sql`
      SELECT COUNT(*) as count FROM parsed_sales 
      WHERE date >= ${filters.startDate} AND date <= ${filters.endDate}
    `) as { count: number }[];
    total = countResult[0]?.count ?? 0;

    const offset = (page - 1) * pageSize;
    results = (await sql`
      SELECT * FROM parsed_sales 
      WHERE date >= ${filters.startDate} AND date <= ${filters.endDate}
      ORDER BY date DESC LIMIT ${pageSize} OFFSET ${offset}
    `) as ParsedSalesRecord[];
  } else if (filters.appIds && filters.appIds.length === 1 && !filters.startDate) {
    // Single app filter only
    const appId = filters.appIds[0];
    const countResult = (await sql`
      SELECT COUNT(*) as count FROM parsed_sales WHERE app_id = ${appId}
    `) as { count: number }[];
    total = countResult[0]?.count ?? 0;

    const offset = (page - 1) * pageSize;
    results = (await sql`
      SELECT * FROM parsed_sales WHERE app_id = ${appId}
      ORDER BY date DESC LIMIT ${pageSize} OFFSET ${offset}
    `) as ParsedSalesRecord[];
  } else {
    // Complex filters - fetch all and filter in memory

    const allRecords = (await sql`
      SELECT * FROM parsed_sales ORDER BY date DESC
    `) as ParsedSalesRecord[];

    let filtered = allRecords;

    if (filters.startDate) {
      filtered = filtered.filter((r) => r.date >= filters.startDate!);
    }
    if (filters.endDate) {
      filtered = filtered.filter((r) => r.date <= filters.endDate!);
    }
    if (filters.countryCode) {
      filtered = filtered.filter((r) => r.country_code === filters.countryCode);
    }
    if (filters.appIds && filters.appIds.length > 0) {
      const appIdSet = new Set(filters.appIds);
      filtered = filtered.filter((r) => appIdSet.has(r.app_id));
    }
    if (filters.packageIds && filters.packageIds.length > 0) {
      const packageIdSet = new Set(filters.packageIds);
      filtered = filtered.filter((r) => r.packageid != null && packageIdSet.has(r.packageid));
    }
    if (filters.apiKeyIds && filters.apiKeyIds.length > 0) {
      const apiKeyIdSet = new Set(filters.apiKeyIds);
      filtered = filtered.filter((r) => apiKeyIdSet.has(r.api_key_id));
    }

    total = filtered.length;
    const offset = (page - 1) * pageSize;
    results = filtered.slice(offset, offset + pageSize);
  }

  return {
    data: results.map(fromDbRecord),
    total,
    page,
    pageSize,
    hasMore: (page - 1) * pageSize + results.length < total,
  };
}

/**
 * Get total count of parsed records
 */
export async function getParsedRecordsCount(): Promise<number> {
  const result = (await sql`SELECT COUNT(*) as count FROM parsed_sales`) as { count: number }[];
  return result[0]?.count ?? 0;
}

/**
 * Delete parsed records for a specific API key
 */
export async function deleteParsedRecordsForApiKey(apiKeyId: string): Promise<number> {
  // Get count first
  const countResult = (await sql`
    SELECT COUNT(*) as count FROM parsed_sales WHERE api_key_id = ${apiKeyId}
  `) as { count: number }[];
  const count = countResult[0]?.count ?? 0;

  // Delete records
  await sql`DELETE FROM parsed_sales WHERE api_key_id = ${apiKeyId}`;

  return count;
}

/**
 * Get unique apps from parsed records
 */
export async function getUniqueApps(): Promise<{ appId: number; appName: string }[]> {
  const results = (await sql`
    SELECT DISTINCT app_id, app_name 
    FROM parsed_sales 
    ORDER BY app_name
  `) as { app_id: number; app_name: string | null }[];

  return results.map((r) => ({
    appId: r.app_id,
    appName: r.app_name || `App ${r.app_id}`,
  }));
}

/**
 * Get unique countries from parsed records
 */
export async function getUniqueCountries(): Promise<string[]> {
  const results = (await sql`
    SELECT DISTINCT country_code 
    FROM parsed_sales 
    ORDER BY country_code
  `) as { country_code: string }[];

  return results.map((r) => r.country_code);
}

/**
 * Get unique API key IDs from parsed records
 */
export async function getUniqueApiKeyIds(): Promise<string[]> {
  const results = (await sql`
    SELECT DISTINCT api_key_id 
    FROM parsed_sales 
    ORDER BY api_key_id
  `) as { api_key_id: string }[];

  return results.map((r) => r.api_key_id);
}

/**
 * Get date range from parsed records
 */
export async function getDateRange(): Promise<{ min: string; max: string } | null> {
  const result = (await sql`
    SELECT MIN(date) as min_date, MAX(date) as max_date 
    FROM parsed_sales
  `) as { min_date: string | null; max_date: string | null }[];

  if (!result[0]?.min_date) return null;

  return {
    min: result[0].min_date,
    max: result[0].max_date || result[0].min_date,
  };
}

/**
 * Compute stats from filtered parsed records using SQL aggregation
 */
export async function computeFilteredStats(filters?: Filters): Promise<{
  totalRevenue: number;
  totalUnits: number;
  totalRecords: number;
  uniqueApps: number;
  uniqueCountries: number;
}> {
  // For no filters, use direct SQL aggregation
  if (!filters || Object.keys(filters).length === 0) {
    const result = (await sql`
      SELECT 
        COALESCE(SUM(gross_sales_usd), 0) as total_revenue,
        COALESCE(SUM(ABS(gross_units_sold) + ABS(gross_units_activated) - ABS(gross_units_returned)), 0) as total_units,
        COUNT(*) as total_records,
        COUNT(DISTINCT app_id) as unique_apps,
        COUNT(DISTINCT country_code) as unique_countries
      FROM parsed_sales
    `) as {
      total_revenue: number;
      total_units: number;
      total_records: number;
      unique_apps: number;
      unique_countries: number;
    }[];

    const r = result[0];
    return {
      totalRevenue: r?.total_revenue ?? 0,
      totalUnits: r?.total_units ?? 0,
      totalRecords: r?.total_records ?? 0,
      uniqueApps: r?.unique_apps ?? 0,
      uniqueCountries: r?.unique_countries ?? 0,
    };
  }

  // For filtered stats, we need to filter in memory then aggregate
  const { data } = await getParsedRecords(1, 1000000, filters);

  let totalRevenue = 0;
  let totalUnits = 0;
  const uniqueApps = new Set<number>();
  const uniqueCountries = new Set<string>();

  for (const record of data) {
    totalRevenue += record.grossSalesUsd ?? 0;
    const sold = Math.abs(record.grossUnitsSold ?? 0);
    const activated = Math.abs(record.grossUnitsActivated ?? 0);
    const returned = Math.abs(record.grossUnitsReturned ?? 0);
    totalUnits += sold + activated - returned;
    uniqueApps.add(record.appId);
    uniqueCountries.add(record.countryCode);
  }

  return {
    totalRevenue,
    totalUnits,
    totalRecords: data.length,
    uniqueApps: uniqueApps.size,
    uniqueCountries: uniqueCountries.size,
  };
}

/**
 * Raw unit metrics for debugging data consistency
 */
export interface RawUnitMetrics extends UnitMetrics {
  grandTotal: number;
  totalRecords: number;
}

/**
 * Get raw unit metrics using SQL aggregation.
 * Uses ABS() to ensure all values are positive (Steam may return negative returns).
 */
export async function getRawUnitMetrics(filters?: Filters): Promise<RawUnitMetrics> {
  // For no filters, use direct SQL aggregation
  if (!filters || Object.keys(filters).length === 0) {
    const result = (await sql`
      SELECT 
        COALESCE(SUM(ABS(gross_units_sold)), 0) as gross_sold,
        COALESCE(SUM(ABS(gross_units_returned)), 0) as gross_returned,
        COALESCE(SUM(ABS(gross_units_activated)), 0) as gross_activated,
        COUNT(*) as total_records
      FROM parsed_sales
    `) as {
      gross_sold: number;
      gross_returned: number;
      gross_activated: number;
      total_records: number;
    }[];

    const r = result[0];
    const grossSold = r?.gross_sold ?? 0;
    const grossReturned = r?.gross_returned ?? 0;
    const grossActivated = r?.gross_activated ?? 0;
    const grandTotal = grossSold + grossActivated - grossReturned;

    return {
      grossSold,
      grossReturned,
      grossActivated,
      grandTotal,
      totalRecords: r?.total_records ?? 0,
    };
  }

  // For filtered stats, we need to filter in memory then aggregate
  const { data } = await getParsedRecords(1, 1000000, filters);

  let grossSold = 0;
  let grossReturned = 0;
  let grossActivated = 0;

  for (const record of data) {
    const sold = Math.abs(record.grossUnitsSold ?? 0);
    const returned = Math.abs(record.grossUnitsReturned ?? 0);
    const activated = Math.abs(record.grossUnitsActivated ?? 0);

    grossSold += sold;
    grossReturned += returned;
    grossActivated += activated;
  }

  const grandTotal = grossSold + grossActivated - grossReturned;

  return {
    grossSold,
    grossReturned,
    grossActivated,
    grandTotal,
    totalRecords: data.length,
  };
}

/**
 * Stream parsed records in batches (for compatibility with existing code)
 * Note: With SQL, we can often avoid streaming by using SQL aggregation instead.
 */
export async function streamParsedRecords(
  batchSize: number,
  callback: (
    batch: SalesRecord[],
    progress: { processed: number; total: number }
  ) => Promise<void> | void,
  filters?: Filters
): Promise<void> {
  const total = await getParsedRecordsCount();
  let processed = 0;
  let page = 1;

  while (processed < total) {
    const result = await getParsedRecords(page, batchSize, filters);

    if (result.data.length === 0) break;

    processed += result.data.length;
    await callback(result.data, { processed, total });

    if (!result.hasMore) break;
    page++;

    // Yield to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
