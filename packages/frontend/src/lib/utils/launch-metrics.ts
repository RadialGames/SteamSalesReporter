// Launch day metrics calculation utilities
// Aggregates sales data by day offset from product launch

import { calculateNetUnitsFromValues } from '$lib/utils/calculations';

/** Record shape for launch metrics (query-client SalesRecord + optional raw-data fields) */
export interface LaunchMetricsRecord {
  date: string;
  netSalesUsd?: number;
  grossUnitsSold?: number;
  grossUnitsReturned?: number;
  grossUnitsActivated?: number;
  bundleid?: number | null;
}

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

// Cache for parsed dates to avoid repeated Date object creation
const dateCache = new Map<string, number>();

function getDateTimestamp(dateStr: string): number {
  let ts = dateCache.get(dateStr);
  if (ts === undefined) {
    ts = new Date(dateStr).getTime();
    dateCache.set(dateStr, ts);
  }
  return ts;
}

// Milliseconds in a day
const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
  records: LaunchMetricsRecord[],
  maxDays: number
): LaunchMetricsResult {
  // OPTIMIZATION: Convert reactive proxy array to plain array to avoid proxy overhead
  const plainRecords = Array.isArray(records) ? [...records] : records;

  // Find launch day: earliest date with netSalesUsd > 0
  // Use a single pass to find the minimum date instead of filter+map+sort
  let launchDate: string | null = null;
  let launchTime = Infinity;

  for (let i = 0; i < plainRecords.length; i++) {
    const record = plainRecords[i];
    if (record.netSalesUsd && record.netSalesUsd > 0) {
      const ts = getDateTimestamp(record.date);
      if (ts < launchTime) {
        launchTime = ts;
        launchDate = record.date;
      }
    }
  }

  if (launchDate === null) {
    return { launchDate: null, days: [] };
  }

  // Group records by day offset from launch
  const dayMap = new Map<number, DayData>();

  for (let i = 0; i < plainRecords.length; i++) {
    const record = plainRecords[i];
    const recordTime = getDateTimestamp(record.date);
    const dayOffset = Math.floor((recordTime - launchTime) / MS_PER_DAY);

    // Only include days within maxDays range
    if (dayOffset < 0 || dayOffset >= maxDays) continue;

    let dayData = dayMap.get(dayOffset);
    if (!dayData) {
      // Calculate the actual date for this day offset
      const dayDate = new Date(launchTime + dayOffset * MS_PER_DAY);
      const dateStr = dayDate.toISOString().split('T')[0];

      dayData = {
        day: dayOffset,
        date: dateStr,
        sold: 0,
        returned: 0,
        activated: 0,
        bundle: 0,
        netRevenue: 0,
      };
      dayMap.set(dayOffset, dayData);
    }

    dayData.sold += record.grossUnitsSold ?? 0;
    dayData.returned += record.grossUnitsReturned ?? 0;
    dayData.activated += record.grossUnitsActivated ?? 0;
    dayData.netRevenue += record.netSalesUsd ?? 0;

    // Count units from bundle sales (where bundleid exists)
    if (record.bundleid != null) {
      dayData.bundle += (record.grossUnitsSold ?? 0) + (record.grossUnitsActivated ?? 0);
    }
  }

  // Convert to array and sort by day (small array, fast sort)
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
      netRevenue: acc.netRevenue + d.netRevenue,
    }),
    { sold: 0, returned: 0, activated: 0, bundle: 0, netRevenue: 0 }
  );
}

/**
 * Calculate net units for a single day using centralized formula
 */
export function calculateDayNetUnits(day: DayData): number {
  return calculateNetUnitsFromValues(day.sold, day.activated, day.returned);
}

/**
 * Calculate net units from totals using centralized formula
 */
export function calculateTotalsNetUnits(totals: DayTotals): number {
  return calculateNetUnitsFromValues(totals.sold, totals.activated, totals.returned);
}
