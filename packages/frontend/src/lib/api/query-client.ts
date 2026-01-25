// Tauri API client for database queries

import { invoke } from '@tauri-apps/api/core';

// Check if running in Tauri
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function getInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(error);
}

// Helper to handle Tauri errors gracefully
async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error('Tauri APIs are only available in the Tauri application. Please run `npm run dev` to start the Tauri app.');
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const errorMessage = getInvokeErrorMessage(error);
    console.error(`[query-client] Error in ${command}:`, error);
    console.error(`[query-client] Error message:`, errorMessage);
    console.error(`[query-client] Args:`, args);
    throw new Error(errorMessage);
  }
}

// ==================== Query Parameters ====================

export interface QueryFilters {
  start_date?: string;
  end_date?: string;
  app_ids?: number[];
  country_code?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: string;
}

// ==================== Response Types ====================

export interface SalesRecord {
  id: number;
  date: string;
  lineItemType: string;
  appId: number | null;
  appName: string | null;
  packageId: number | null;
  packageName: string | null;
  countryCode: string | null;
  countryName: string | null;
  region: string | null;
  platform: string | null;
  currency: string | null;
  grossUnitsSold: number;
  grossUnitsReturned: number;
  netUnitsSold: number;
  grossSalesUsd: number;
  netSalesUsd: number;
  discountPercentage: number | null;
}

export interface SalesResponse {
  records: SalesRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface DashboardStats {
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  appCount: number;
  countryCount: number;
  dateRange: { min: string; max: string } | null;
}

export interface DailySummary {
  date: string;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export interface AppSummary {
  appId: number;
  appName: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  firstSale: string;
  lastSale: string;
}

export interface CountrySummary {
  countryCode: string;
  countryName: string | null;
  region: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export interface AppLookup {
  appId: number;
  appName: string;
}

export interface CountryLookup {
  countryCode: string;
  countryName: string;
  region: string | null;
}

export interface PackageLookup {
  packageId: number;
  packageName: string;
}

export interface PlatformSummary {
  platform: string | null;
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
}

export interface ProductStats {
  totalRevenue: number;
  totalUnits: number;
  recordCount: number;
  dateRange: { min: string; max: string } | null;
  daily: DailySummary[];
  byCountry: CountrySummary[];
  byPlatform: PlatformSummary[];
}

export interface LaunchDay {
  day: number;
  revenue: number;
  units: number;
}

export interface LaunchComparisonApp {
  appId: number | null;
  packageId: number | null;
  appName: string | null;
  packageName: string | null;
  launchDate: string;
  days: LaunchDay[];
}

// ==================== Query Functions ====================

export async function getStats(filters: QueryFilters = {}): Promise<DashboardStats> {
  return safeInvoke<DashboardStats>('query_stats', { filters });
}

export async function getSales(filters: QueryFilters = {}): Promise<SalesResponse> {
  return safeInvoke<SalesResponse>('query_sales', { filters });
}

export async function getDailySummaries(filters: QueryFilters = {}): Promise<DailySummary[]> {
  return safeInvoke<DailySummary[]>('query_daily_summaries', { filters });
}

export async function getAppSummaries(filters: QueryFilters = {}): Promise<AppSummary[]> {
  return safeInvoke<AppSummary[]>('query_app_summaries', { filters });
}

export async function getCountrySummaries(filters: QueryFilters = {}): Promise<CountrySummary[]> {
  return safeInvoke<CountrySummary[]>('query_country_summaries', { filters });
}

export async function getAppsLookup(): Promise<AppLookup[]> {
  return safeInvoke<AppLookup[]>('query_apps_lookup');
}

export async function getCountriesLookup(): Promise<CountryLookup[]> {
  return safeInvoke<CountryLookup[]>('query_countries_lookup');
}

export async function getDatesList(): Promise<string[]> {
  return safeInvoke<string[]>('query_dates_list');
}

export async function getRawDataByDate(date: string): Promise<SalesRecord[]> {
  return safeInvoke<SalesRecord[]>('query_raw_data_by_date', { date });
}

export async function getPackagesLookup(): Promise<PackageLookup[]> {
  return safeInvoke<PackageLookup[]>('query_packages_lookup');
}

export async function getPackagesByApp(appId: number): Promise<PackageLookup[]> {
  return safeInvoke<PackageLookup[]>('query_packages_by_app', { appId });
}

export async function getProductStats(
  productType: 'app' | 'package',
  productId: number
): Promise<ProductStats> {
  return safeInvoke<ProductStats>('query_product_stats', {
    productType,
    productId,
  });
}

export async function getLaunchComparison(maxDays: number, productType: 'app' | 'package' = 'app'): Promise<LaunchComparisonApp[]> {
  return safeInvoke<LaunchComparisonApp[]>('query_launch_comparison', {
    maxDays,
    productType,
  });
}
