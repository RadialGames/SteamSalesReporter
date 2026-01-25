// CSV generation and export utilities

/**
 * Generate CSV content from headers and rows
 * Properly escapes all values to handle commas, quotes, and newlines.
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
  const escapedHeaders = headers.map(escapeCsvValue);
  const escapedRows = rows.map((row) => row.map(escapeCsvValue));
  return [escapedHeaders.join(','), ...escapedRows.map((row) => row.join(','))].join('\n');
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
