// Launch day metrics calculation utilities
// Aggregates sales data by day offset from product launch

import type { SalesRecord } from '$lib/services/types';

/**
 * Data for a single day relative to launch
 */
export interface DayData {
  /** Day offset from launch (0 = launch day) */
  day: number;
  /** ISO date string (YYYY-MM-DD) */
  date: string;
  /** Gross units sold */
  sold: number;
  /** Gross units returned */
  returned: number;
  /** Gross units activated (retail keys) */
  activated: number;
  /** Units from bundle sales */
  bundle: number;
  /** Net revenue in USD */
  netRevenue: number;
}

/**
 * Result from launch day calculation
 */
export interface LaunchMetricsResult {
  /** Launch date (first date with revenue) or null if no revenue */
  launchDate: string | null;
  /** Day-by-day aggregated data */
  days: DayData[];
}

/**
 * Calculate day-by-day metrics from launch date
 * 
 * Launch date is determined as the earliest date with positive netSalesUsd.
 * Records are aggregated by day offset from the launch date.
 * 
 * @param records - Sales records to analyze
 * @param maxDays - Maximum number of days from launch to include
 * @returns Launch date and day-by-day aggregated data
 * 
 * @example
 * const { launchDate, days } = calculateLaunchDays(records, 30);
 * // days[0] = Day 0 (launch day)
 * // days[1] = Day 1, etc.
 */
export function calculateLaunchDays(
  records: SalesRecord[], 
  maxDays: number
): LaunchMetricsResult {
  // Find launch day: earliest date with netSalesUsd > 0
  const datesWithRevenue = records
    .filter(r => r.netSalesUsd && r.netSalesUsd > 0)
    .map(r => r.date)
    .sort();
  
  if (datesWithRevenue.length === 0) {
    return { launchDate: null, days: [] };
  }

  const launchDate = datesWithRevenue[0];
  const launchTime = new Date(launchDate).getTime();

  // Group records by day offset from launch
  const dayMap = new Map<number, DayData>();

  for (const record of records) {
    const recordTime = new Date(record.date).getTime();
    const dayOffset = Math.floor((recordTime - launchTime) / (1000 * 60 * 60 * 24));
    
    // Only include days within maxDays range
    if (dayOffset < 0 || dayOffset >= maxDays) continue;

    if (!dayMap.has(dayOffset)) {
      // Calculate the actual date for this day offset
      const dayDate = new Date(launchTime + dayOffset * 24 * 60 * 60 * 1000);
      const dateStr = dayDate.toISOString().split('T')[0];
      
      dayMap.set(dayOffset, {
        day: dayOffset,
        date: dateStr,
        sold: 0,
        returned: 0,
        activated: 0,
        bundle: 0,
        netRevenue: 0
      });
    }

    const dayData = dayMap.get(dayOffset)!;
    dayData.sold += record.grossUnitsSold ?? 0;
    dayData.returned += record.grossUnitsReturned ?? 0;
    dayData.activated += record.grossUnitsActivated ?? 0;
    dayData.netRevenue += record.netSalesUsd ?? 0;
    
    // Count units from bundle sales (where bundleid exists)
    if (record.bundleid != null) {
      dayData.bundle += (record.grossUnitsSold ?? 0) + (record.grossUnitsActivated ?? 0);
    }
  }

  // Convert to array and sort by day
  const days = Array.from(dayMap.values()).sort((a, b) => a.day - b.day);

  return { launchDate, days };
}

/**
 * Calculate totals across all days
 */
export interface DayTotals {
  sold: number;
  returned: number;
  activated: number;
  bundle: number;
  netRevenue: number;
}

/**
 * Sum up totals from day data array
 */
export function calculateDayTotals(days: DayData[]): DayTotals {
  return days.reduce(
    (acc, d) => ({
      sold: acc.sold + d.sold,
      returned: acc.returned + d.returned,
      activated: acc.activated + d.activated,
      bundle: acc.bundle + d.bundle,
      netRevenue: acc.netRevenue + d.netRevenue
    }),
    { sold: 0, returned: 0, activated: 0, bundle: 0, netRevenue: 0 }
  );
}
