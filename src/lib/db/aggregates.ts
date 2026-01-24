/**
 * Tier 3: Aggregates Operations
 *
 * Pre-computed daily, app, and country aggregates for fast queries.
 * Uses SQL SUM/GROUP BY for efficient aggregation - no JS loops needed!
 */

import { sql, batch } from './sqlite';
import type {
  DailyAggregate,
  AppAggregate,
  CountryAggregate,
  GlobalUnitMetrics,
} from './sqlite-schema';
import type { DbProgressCallback } from './sqlite';

// Re-export types
export type { DailyAggregate, AppAggregate, CountryAggregate, GlobalUnitMetrics };

const GLOBAL_METRICS_CACHE_KEY = 'global_unit_metrics';

/**
 * Compute and store all aggregates from parsed sales records.
 * Uses SQL aggregation - much faster than loading all records into JS!
 */
export async function computeAndStoreAggregates(onProgress?: DbProgressCallback): Promise<void> {
  const startTime = Date.now();
  onProgress?.('Computing aggregates...', 10);

  // Check if we have any records
  const countResult = (await sql`SELECT COUNT(*) as count FROM parsed_sales`) as {
    count: number;
  }[];
  const totalRecords = countResult[0]?.count ?? 0;

  if (totalRecords === 0) {
    // Clear existing aggregates
    await sql`DELETE FROM daily_aggregates`;
    await sql`DELETE FROM app_aggregates`;
    await sql`DELETE FROM country_aggregates`;

    // Store empty global metrics
    const emptyMetrics: GlobalUnitMetrics = {
      grossSold: 0,
      grossReturned: 0,
      grossActivated: 0,
      grandTotal: 0,
      totalRecords: 0,
      computedAt: Date.now(),
    };
    await sql`
      INSERT OR REPLACE INTO display_cache (key, value, computed_at)
      VALUES (${GLOBAL_METRICS_CACHE_KEY}, ${JSON.stringify(emptyMetrics)}, ${Date.now()})
    `;
    onProgress?.('Complete!', 100);
    return;
  }

  // Update statistics to help SQLite choose optimal query plans
  onProgress?.('Updating query statistics...', 20);
  await sql`ANALYZE parsed_sales`;

  // Clear and compute aggregates in a SINGLE atomic transaction
  // This prevents data loss if computation fails after clearing
  onProgress?.('Computing all aggregates...', 30);
  const computeStart = Date.now();
  await batch((batchSql) => [
    // First: Clear existing aggregates
    batchSql`DELETE FROM daily_aggregates`,
    batchSql`DELETE FROM app_aggregates`,
    batchSql`DELETE FROM country_aggregates`,

    // Then: Compute and store daily aggregates
    // Using covering index idx_parsed_sales_date_covering for optimal performance
    batchSql`
      INSERT INTO daily_aggregates (date, total_revenue, total_units, record_count)
      SELECT
        date,
        COALESCE(SUM(gross_sales_usd), 0) as total_revenue,
        COALESCE(SUM(units_sold), 0) as total_units,
        COUNT(*) as record_count
      FROM parsed_sales
      GROUP BY date
    `,

    // Compute and store app aggregates
    // Using covering index idx_parsed_sales_app_id_covering for optimal performance
    batchSql`
      INSERT INTO app_aggregates (app_id, app_name, total_revenue, total_units, record_count, first_sale_date, last_sale_date)
      SELECT
        app_id,
        COALESCE(MAX(app_name), 'App ' || app_id) as app_name,
        COALESCE(SUM(gross_sales_usd), 0) as total_revenue,
        COALESCE(SUM(units_sold), 0) as total_units,
        COUNT(*) as record_count,
        MIN(date) as first_sale_date,
        MAX(date) as last_sale_date
      FROM parsed_sales
      GROUP BY app_id
    `,

    // Compute and store country aggregates
    // Using covering index idx_parsed_sales_country_covering for optimal performance
    batchSql`
      INSERT INTO country_aggregates (country_code, total_revenue, total_units, record_count)
      SELECT
        country_code,
        COALESCE(SUM(gross_sales_usd), 0) as total_revenue,
        COALESCE(SUM(units_sold), 0) as total_units,
        COUNT(*) as record_count
      FROM parsed_sales
      GROUP BY country_code
    `,
  ]);
  console.log(
    `Aggregate computation took ${Date.now() - computeStart}ms for ${totalRecords} records`
  );

  // Compute and store global unit metrics (separate from batch since we need the result)
  onProgress?.('Computing global metrics...', 90);
  const globalStart = Date.now();
  const globalResult = (await sql`
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

  const r = globalResult[0];
  const globalMetrics: GlobalUnitMetrics = {
    grossSold: r?.gross_sold ?? 0,
    grossReturned: r?.gross_returned ?? 0,
    grossActivated: r?.gross_activated ?? 0,
    grandTotal: (r?.gross_sold ?? 0) + (r?.gross_activated ?? 0) - (r?.gross_returned ?? 0),
    totalRecords: r?.total_records ?? 0,
    computedAt: Date.now(),
  };

  await sql`
    INSERT OR REPLACE INTO display_cache (key, value, computed_at)
    VALUES (${GLOBAL_METRICS_CACHE_KEY}, ${JSON.stringify(globalMetrics)}, ${Date.now()})
  `;
  console.log(`Global metrics took ${Date.now() - globalStart}ms`);
  onProgress?.('Complete!', 100);

  console.log(
    `Total aggregates computation took ${Date.now() - startTime}ms for ${totalRecords} records`
  );
  onProgress?.('Complete!', 100);
}

/**
 * Get daily aggregates
 */
export async function getDailyAggregates(): Promise<DailyAggregate[]> {
  return (await sql`
    SELECT date, total_revenue, total_units, record_count 
    FROM daily_aggregates 
    ORDER BY date
  `) as DailyAggregate[];
}

/**
 * Get app aggregates (sorted by revenue descending)
 */
export async function getAppAggregates(): Promise<AppAggregate[]> {
  return (await sql`
    SELECT app_id, app_name, total_revenue, total_units, record_count, first_sale_date, last_sale_date
    FROM app_aggregates 
    ORDER BY total_revenue DESC
  `) as AppAggregate[];
}

/**
 * Get country aggregates (sorted by revenue descending)
 */
export async function getCountryAggregates(): Promise<CountryAggregate[]> {
  return (await sql`
    SELECT country_code, total_revenue, total_units, record_count
    FROM country_aggregates 
    ORDER BY total_revenue DESC
  `) as CountryAggregate[];
}

/**
 * Get aggregate statistics
 */
export async function getAggregateStats(): Promise<{
  totalRevenue: number;
  totalUnits: number;
  totalRecords: number;
  uniqueApps: number;
  uniqueCountries: number;
  dateRange: { min: string; max: string } | null;
}> {
  const [statsResult, dateResult] = await Promise.all([
    sql`
      SELECT 
        COALESCE(SUM(total_revenue), 0) as total_revenue,
        COALESCE(SUM(total_units), 0) as total_units,
        COALESCE(SUM(record_count), 0) as total_records
      FROM app_aggregates
    ` as Promise<{ total_revenue: number; total_units: number; total_records: number }[]>,
    sql`
      SELECT MIN(date) as min_date, MAX(date) as max_date 
      FROM daily_aggregates
    ` as Promise<{ min_date: string | null; max_date: string | null }[]>,
  ]);

  const appsResult = (await sql`SELECT COUNT(*) as count FROM app_aggregates`) as {
    count: number;
  }[];
  const countriesResult = (await sql`SELECT COUNT(*) as count FROM country_aggregates`) as {
    count: number;
  }[];

  const stats = statsResult[0];
  const dates = dateResult[0];

  return {
    totalRevenue: stats?.total_revenue ?? 0,
    totalUnits: stats?.total_units ?? 0,
    totalRecords: stats?.total_records ?? 0,
    uniqueApps: appsResult[0]?.count ?? 0,
    uniqueCountries: countriesResult[0]?.count ?? 0,
    dateRange: dates?.min_date
      ? { min: dates.min_date, max: dates.max_date || dates.min_date }
      : null,
  };
}

/**
 * Clear all aggregates
 */
export async function clearAggregates(): Promise<void> {
  await batch((batchSql) => [
    batchSql`DELETE FROM daily_aggregates`,
    batchSql`DELETE FROM app_aggregates`,
    batchSql`DELETE FROM country_aggregates`,
  ]);
}

/**
 * Get pre-computed global unit metrics from cache
 */
export async function getGlobalUnitMetrics(): Promise<GlobalUnitMetrics | null> {
  const result = (await sql`
    SELECT value FROM display_cache WHERE key = ${GLOBAL_METRICS_CACHE_KEY}
  `) as { value: string }[];

  if (!result[0]?.value) return null;

  try {
    return JSON.parse(result[0].value) as GlobalUnitMetrics;
  } catch {
    return null;
  }
}
