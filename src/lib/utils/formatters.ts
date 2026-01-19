// Shared formatting utilities for currency and numbers

export interface FormatCurrencyOptions {
  /** Use compact format with K/M suffixes for large numbers */
  compact?: boolean;
  /** Minimum fraction digits (default: 2) */
  minimumFractionDigits?: number;
  /** Maximum fraction digits (default: 2) */
  maximumFractionDigits?: number;
}

/**
 * Format a number as USD currency
 * 
 * @example
 * formatCurrency(1234.56) // "$1,234.56"
 * formatCurrency(1500000, { compact: true }) // "$1.50M"
 * formatCurrency(undefined) // "-"
 */
export function formatCurrency(
  value: number | undefined | null, 
  options: FormatCurrencyOptions = {}
): string {
  if (value === undefined || value === null) return '-';
  
  const { 
    compact = false, 
    minimumFractionDigits = 2, 
    maximumFractionDigits = 2 
  } = options;
  
  if (compact) {
    if (value >= 1000000) {
      return '$' + (value / 1000000).toFixed(2) + 'M';
    } else if (value >= 1000) {
      return '$' + (value / 1000).toFixed(2) + 'K';
    }
  }
  
  return '$' + value.toLocaleString('en-US', { 
    minimumFractionDigits, 
    maximumFractionDigits 
  });
}

export interface FormatNumberOptions {
  /** Show "0" instead of "-" for zero values */
  showZero?: boolean;
}

/**
 * Format a number with locale-specific separators
 * 
 * @example
 * formatNumber(1234567) // "1,234,567"
 * formatNumber(0) // "-"
 * formatNumber(0, { showZero: true }) // "0"
 * formatNumber(undefined) // "-"
 */
export function formatNumber(
  value: number | undefined | null, 
  options: FormatNumberOptions = {}
): string {
  const { showZero = false } = options;
  
  if (value === undefined || value === null) return '-';
  if (value === 0 && !showZero) return '-';
  
  return value.toLocaleString();
}

/**
 * Format a percentage value
 * 
 * @example
 * formatPercent(0.156) // "15.6%"
 * formatPercent(0.5, { decimals: 0 }) // "50%"
 */
export function formatPercent(
  value: number | undefined | null, 
  options: { decimals?: number } = {}
): string {
  if (value === undefined || value === null) return '-';
  
  const { decimals = 1 } = options;
  return (value * 100).toFixed(decimals) + '%';
}
