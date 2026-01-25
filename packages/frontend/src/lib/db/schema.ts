// Type definitions for the CLI tool's SQLite database schema
// Based on steam-financial-cli database structure

export interface SalesDataRow {
  date: string;
  line_item_type?: string;
  partnerid?: number;
  primary_appid?: number;
  packageid?: number;
  bundleid?: number;
  appid?: number;
  game_item_id?: number;
  country_code?: string;
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

// Helper to convert USD string to number
export function parseUsd(usd: string | undefined | null): number {
  if (!usd) return 0;
  const parsed = parseFloat(usd);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper to parse integer
export function parseIntSafe(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}
