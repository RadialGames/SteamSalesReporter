// Date utility functions for Steam sales data sync

/**
 * Sort dates prioritizing new (unseen) dates first
 * 
 * This is used during data sync to fetch new dates before updating existing ones,
 * so users see fresh data faster.
 * 
 * @param dates - Array of date strings to sort
 * @param existingDates - Set of dates already in the database
 * @returns Sorted array with new dates first, then existing dates, both in chronological order
 * 
 * @example
 * const sorted = sortDatesByPriority(
 *   ['2024-01-03', '2024-01-01', '2024-01-02'],
 *   new Set(['2024-01-01'])
 * );
 * // Returns: ['2024-01-02', '2024-01-03', '2024-01-01']
 * // New dates (01-02, 01-03) come first, then existing (01-01)
 */
export function sortDatesByPriority(
  dates: string[], 
  existingDates: Set<string>
): string[] {
  return [...dates].sort((a, b) => {
    const aExists = existingDates.has(a);
    const bExists = existingDates.has(b);
    
    // New dates come first
    if (aExists && !bExists) return 1;  // b (new) comes first
    if (!aExists && bExists) return -1; // a (new) comes first
    
    // Within same category, sort chronologically
    return a.localeCompare(b);
  });
}

/**
 * Parse a highwatermark value that may be a string or number
 * 
 * The Steam API sometimes returns highwatermarks as strings.
 * 
 * @param value - The raw highwatermark value
 * @param fallback - Value to return if parsing fails (default: 0)
 * @returns Parsed number value
 * 
 * @example
 * parseHighwatermark('12345', 0) // 12345
 * parseHighwatermark(12345, 0)   // 12345
 * parseHighwatermark(undefined, 0) // 0
 */
export function parseHighwatermark(
  value: string | number | undefined | null,
  fallback: number = 0
): number {
  if (value === undefined || value === null) return fallback;
  
  if (typeof value === 'number') return value;
  
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Get the ISO date string (YYYY-MM-DD) for today
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get the ISO date string for N days ago
 * 
 * @param days - Number of days to subtract
 * @returns ISO date string
 * 
 * @example
 * getDaysAgoDateString(7) // Returns date string for 1 week ago
 */
export function getDaysAgoDateString(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}
