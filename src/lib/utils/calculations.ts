/**
 * Centralized Calculation Functions
 *
 * This module provides the single source of truth for all unit and revenue calculations.
 * All other modules should import and use these functions instead of inline calculations.
 *
 * The canonical formula for net units is:
 *   netUnits = grossUnitsSold + grossUnitsActivated - grossUnitsReturned
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Raw unit metrics from a single record or aggregated values
 */
export interface UnitMetrics {
  grossSold: number;
  grossReturned: number;
  grossActivated: number;
}

/**
 * Complete metrics including calculated values
 */
export interface CalculatedMetrics extends UnitMetrics {
  netUnits: number;
}

/**
 * Revenue metrics
 */
export interface RevenueMetrics {
  grossRevenue: number;
  netRevenue?: number;
}

// ============================================================================
// Unit Calculations
// ============================================================================

/**
 * Calculate net units from raw unit metrics.
 * This is THE canonical formula for unit calculation.
 *
 * Formula: grossSold + grossActivated - grossReturned
 *
 * @param metrics - Raw unit metrics (sold, returned, activated)
 * @returns Net units after accounting for activations and returns
 */
export function calculateNetUnits(metrics: UnitMetrics): number {
  return metrics.grossSold + metrics.grossActivated - metrics.grossReturned;
}

/**
 * Calculate net units from individual values (convenience overload).
 * Uses Math.abs() because Steam's API may return negative values.
 *
 * @param grossSold - Gross units sold
 * @param grossActivated - Gross units activated (e.g., key redemptions)
 * @param grossReturned - Gross units returned/refunded
 * @returns Net units after accounting for activations and returns
 */
export function calculateNetUnitsFromValues(
  grossSold: number,
  grossActivated: number,
  grossReturned: number
): number {
  return Math.abs(grossSold) + Math.abs(grossActivated) - Math.abs(grossReturned);
}

/**
 * Extract unit metrics from a record-like object with nullable fields.
 * Handles null/undefined values by defaulting to 0.
 * Uses Math.abs() because Steam's API may return negative values for returns.
 *
 * @param record - Object with optional grossUnitsSold, grossUnitsActivated, grossUnitsReturned
 * @returns Normalized UnitMetrics with guaranteed positive numbers
 */
export function extractUnitMetrics(record: {
  grossUnitsSold?: number | null;
  grossUnitsActivated?: number | null;
  grossUnitsReturned?: number | null;
}): UnitMetrics {
  return {
    grossSold: Math.abs(record.grossUnitsSold ?? 0),
    grossActivated: Math.abs(record.grossUnitsActivated ?? 0),
    grossReturned: Math.abs(record.grossUnitsReturned ?? 0),
  };
}

/**
 * Calculate net units directly from a record-like object.
 * Combines extractUnitMetrics and calculateNetUnits for convenience.
 *
 * @param record - Object with optional grossUnitsSold, grossUnitsActivated, grossUnitsReturned
 * @returns Net units
 */
export function calculateNetUnitsFromRecord(record: {
  grossUnitsSold?: number | null;
  grossUnitsActivated?: number | null;
  grossUnitsReturned?: number | null;
}): number {
  return calculateNetUnits(extractUnitMetrics(record));
}

// ============================================================================
// Aggregation Functions
// ============================================================================

/**
 * Sum unit metrics from multiple records.
 * Uses Math.abs() because Steam's API may return negative values.
 *
 * @param records - Array of records with unit metrics
 * @returns Aggregated UnitMetrics with positive values
 */
export function sumUnitMetrics(
  records: Array<{
    grossUnitsSold?: number | null;
    grossUnitsActivated?: number | null;
    grossUnitsReturned?: number | null;
  }>
): UnitMetrics {
  return records.reduce(
    (acc, record) => ({
      grossSold: acc.grossSold + Math.abs(record.grossUnitsSold ?? 0),
      grossActivated: acc.grossActivated + Math.abs(record.grossUnitsActivated ?? 0),
      grossReturned: acc.grossReturned + Math.abs(record.grossUnitsReturned ?? 0),
    }),
    { grossSold: 0, grossActivated: 0, grossReturned: 0 }
  );
}

/**
 * Add unit metrics to an accumulator (for reduce operations).
 * Uses Math.abs() because Steam's API may return negative values.
 *
 * @param acc - Accumulator metrics
 * @param record - Record to add
 * @returns Updated accumulator with positive values
 */
export function addUnitMetrics(
  acc: UnitMetrics,
  record: {
    grossUnitsSold?: number | null;
    grossUnitsActivated?: number | null;
    grossUnitsReturned?: number | null;
  }
): UnitMetrics {
  return {
    grossSold: acc.grossSold + Math.abs(record.grossUnitsSold ?? 0),
    grossActivated: acc.grossActivated + Math.abs(record.grossUnitsActivated ?? 0),
    grossReturned: acc.grossReturned + Math.abs(record.grossUnitsReturned ?? 0),
  };
}

/**
 * Create an empty UnitMetrics object for use as initial accumulator.
 */
export function emptyUnitMetrics(): UnitMetrics {
  return { grossSold: 0, grossActivated: 0, grossReturned: 0 };
}

// ============================================================================
// Revenue Calculations
// ============================================================================

/**
 * Sum gross revenue from records.
 *
 * @param records - Array of records with grossSalesUsd
 * @returns Total gross revenue
 */
export function sumGrossRevenue(records: Array<{ grossSalesUsd?: number | null }>): number {
  return records.reduce((sum, record) => sum + (record.grossSalesUsd ?? 0), 0);
}

/**
 * Sum net revenue from records.
 *
 * @param records - Array of records with netSalesUsd
 * @returns Total net revenue
 */
export function sumNetRevenue(records: Array<{ netSalesUsd?: number | null }>): number {
  return records.reduce((sum, record) => sum + (record.netSalesUsd ?? 0), 0);
}
