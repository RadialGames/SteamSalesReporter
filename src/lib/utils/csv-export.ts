// CSV generation and export utilities

/**
 * Generate CSV content from headers and rows
 * 
 * @param headers - Array of column header strings
 * @param rows - 2D array of row data (each inner array is a row)
 * @returns CSV formatted string
 * 
 * @example
 * const csv = generateCsv(
 *   ['Name', 'Value'],
 *   [['Item 1', '100'], ['Item 2', '200']]
 * );
 */
export function generateCsv(headers: string[], rows: string[][]): string {
  return [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');
}

/**
 * Escape a value for CSV (handles quotes and special characters)
 * 
 * @param value - The value to escape
 * @returns Properly escaped CSV value
 * 
 * @example
 * escapeCsvValue('Hello, World') // '"Hello, World"'
 * escapeCsvValue('Say "Hi"') // '"Say ""Hi"""'
 */
export function escapeCsvValue(value: string): string {
  // If value contains comma, newline, or quote, wrap in quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    // Escape existing quotes by doubling them
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Copy text content to clipboard
 * 
 * @param content - The text content to copy
 * @returns Promise resolving to true if successful, false otherwise
 * 
 * @example
 * const success = await copyToClipboard(csvContent);
 * if (success) showNotification('Copied!');
 */
export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

/**
 * Download content as a file
 * 
 * @param content - The file content
 * @param filename - Name of the file to download
 * @param mimeType - MIME type (default: 'text/csv;charset=utf-8;')
 * 
 * @example
 * downloadFile(csvContent, 'report.csv');
 * downloadFile(jsonContent, 'data.json', 'application/json');
 */
export function downloadFile(
  content: string, 
  filename: string, 
  mimeType: string = 'text/csv;charset=utf-8;'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Sanitize a string for use in a filename
 * Replaces non-alphanumeric characters with underscores
 * 
 * @param name - The string to sanitize
 * @returns Filename-safe string
 * 
 * @example
 * sanitizeFilename('My Product: Special Edition!') // 'My_Product__Special_Edition_'
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_');
}
