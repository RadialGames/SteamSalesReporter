// CSV generation and export utilities

/**
 * Generate CSV content from headers and rows
 * Properly escapes all values to handle commas, quotes, and newlines.
 *
 * @param headers - Array of column header strings
 * @param rows - 2D array of row data (each inner array is a row)
 *                Values will be converted to strings and escaped automatically
 * @returns CSV formatted string
 *
 * @example
 * const csv = generateCsv(
 *   ['Name', 'Value'],
 *   [['Item 1', '100'], ['Item 2', '200']]
 * );
 */
export function generateCsv(
  headers: (string | number | null | undefined)[],
  rows: (string | number | null | undefined)[][]
): string {
  // Escape all header values
  const escapedHeaders = headers.map(escapeCsvValue);
  
  // Escape all row values
  const escapedRows = rows.map((row) => row.map(escapeCsvValue));
  
  // Join headers and rows with commas, then join rows with newlines
  const headerLine = escapedHeaders.join(',');
  const rowLines = escapedRows.map((row) => row.join(','));
  
  const csvContent = [headerLine, ...rowLines].join('\n');
  
  // Add UTF-8 BOM for better Excel compatibility (especially for special characters)
  // Excel recognizes UTF-8 BOM and will parse the CSV correctly
  return '\uFEFF' + csvContent;
}

/**
 * Escape a value for CSV (handles quotes and special characters)
 * Follows RFC 4180 CSV standard for proper escaping
 *
 * @param value - The value to escape (will be converted to string)
 * @returns Properly escaped CSV value
 *
 * @example
 * escapeCsvValue('Hello, World') // '"Hello, World"'
 * escapeCsvValue('Say "Hi"') // '"Say ""Hi"""'
 * escapeCsvValue('Product, "Special Edition"') // '"Product, ""Special Edition"""'
 */
export function escapeCsvValue(value: string | number | null | undefined): string {
  // Convert to string, handling null/undefined
  const str = value == null ? '' : String(value);
  
  // RFC 4180: Fields containing comma, quote, or newline must be enclosed in quotes
  // Also handle carriage return and carriage return + line feed
  const needsQuoting = 
    str.includes(',') || 
    str.includes('"') || 
    str.includes('\n') || 
    str.includes('\r');
  
  if (needsQuoting) {
    // Escape existing quotes by doubling them (RFC 4180 standard)
    // Use a global regex to replace all occurrences
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  }
  
  return str;
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
 * In Tauri apps, uses the native save dialog. Falls back to browser download if not in Tauri.
 *
 * @param content - The file content
 * @param filename - Name of the file to download
 * @param mimeType - MIME type (default: 'text/csv;charset=utf-8;')
 *
 * @example
 * downloadFile(csvContent, 'report.csv');
 * downloadFile(jsonContent, 'data.json', 'application/json');
 */
export async function downloadFile(
  content: string,
  filename: string,
  mimeType: string = 'text/csv;charset=utf-8;'
): Promise<void> {
  // Check if we're in a Tauri environment
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    
    // Use Tauri's save dialog
    const filePath = await save({
      defaultPath: filename,
      filters: [{
        name: 'CSV Files',
        extensions: ['csv']
      }]
    });
    
    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } catch (error) {
    // If Tauri APIs are not available (e.g., in web mode), fall back to browser download
    console.log('Tauri APIs not available, using browser download fallback:', error);
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);

    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      
      // Use a small delay to ensure the link is properly attached
      await new Promise(resolve => setTimeout(resolve, 10));
      
      link.click();
      
      // Clean up after a short delay to ensure download starts
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (browserError) {
      console.error('Browser download also failed:', browserError);
      throw browserError;
    }
  }
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
