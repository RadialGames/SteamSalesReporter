/**
 * Tier 4: Display Cache Operations
 *
 * Pre-computed values for instant UI display.
 * This is the final tier - all dashboard stats, charts, and UI data.
 */

import { sql } from './sqlite';
import type { DisplayCache } from './sqlite-schema';
import {
  getDailyAggregates,
  getAppAggregates,
  getCountryAggregates,
  getAggregateStats,
} from './aggregates';

// Re-export the type
export type { DisplayCache };

/**
 * Set a display cache value
 */
export async function setDisplayCache(key: string, value: unknown): Promise<void> {
  const jsonValue = JSON.stringify(value);
  const computedAt = Date.now();
  await sql`
    INSERT OR REPLACE INTO display_cache (key, value, computed_at)
    VALUES (${key}, ${jsonValue}, ${computedAt})
  `;
}

/**
 * Get a display cache value
 */
export async function getDisplayCache<T = unknown>(key: string): Promise<T | null> {
  const result = (await sql`
    SELECT value FROM display_cache WHERE key = ${key}
  `) as { value: string }[];

  if (!result[0]?.value) return null;

  try {
    return JSON.parse(result[0].value) as T;
  } catch {
    return null;
  }
}

/**
 * Check if display cache exists and is fresh (within maxAge milliseconds)
 */
export async function isDisplayCacheFresh(
  key: string,
  maxAge: number = 24 * 60 * 60 * 1000
): Promise<boolean> {
  const result = (await sql`
    SELECT computed_at FROM display_cache WHERE key = ${key}
  `) as { computed_at: number }[];

  if (!result[0]?.computed_at) return false;

  const age = Date.now() - result[0].computed_at;
  return age < maxAge;
}

/**
 * Compute and store dashboard stats in display cache
 */
export async function computeDashboardStats(): Promise<void> {
  const stats = await getAggregateStats();
  await setDisplayCache('dashboard_stats', stats);
}

/**
 * Compute and store revenue chart data
 */
export async function computeRevenueChartData(): Promise<void> {
  const dailyAggregates = await getDailyAggregates();
  const chartData = dailyAggregates.map((d) => ({
    date: d.date,
    revenue: d.total_revenue,
    units: d.total_units,
  }));
  await setDisplayCache('revenue_chart_data', chartData);
}

/**
 * Compute and store top apps data
 */
export async function computeTopAppsData(limit: number = 10): Promise<void> {
  const appAggregates = await getAppAggregates();
  const topApps = appAggregates.slice(0, limit).map((a) => ({
    appId: a.app_id,
    appName: a.app_name,
    revenue: a.total_revenue,
    units: a.total_units,
  }));
  await setDisplayCache('top_apps', topApps);
}

/**
 * Compute and store country breakdown data
 */
export async function computeCountryBreakdownData(): Promise<void> {
  const countryAggregates = await getCountryAggregates();
  const breakdown = countryAggregates.map((c) => ({
    countryCode: c.country_code,
    revenue: c.total_revenue,
    units: c.total_units,
  }));
  await setDisplayCache('country_breakdown', breakdown);
}

/**
 * Compute all display cache values
 */
export async function computeAllDisplayCache(
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.('Computing dashboard stats...');
  await computeDashboardStats();
  // Yield to allow UI updates
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress?.('Computing revenue chart data...');
  await computeRevenueChartData();
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress?.('Computing top apps...');
  await computeTopAppsData();
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress?.('Computing country breakdown...');
  await computeCountryBreakdownData();
  await new Promise((resolve) => setTimeout(resolve, 0));

  onProgress?.('Display cache complete');
}

/**
 * Clear all display cache
 */
export async function clearDisplayCache(): Promise<void> {
  await sql`DELETE FROM display_cache`;
}
