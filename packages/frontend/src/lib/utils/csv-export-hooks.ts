import { copyToClipboard, downloadFile } from '$lib/utils/csv-export';

/**
 * State for CSV export operations
 */
export interface CsvExportState {
  isExporting: boolean;
  copied: boolean;
}

/**
 * Creates CSV export functions that work with component state
 * The component should create state using $state and pass setters to these functions
 */
export function createCsvExportFunctions(
  generateContent: () => string,
  getFilename: () => string = () => 'export.csv'
) {
  // Track timeout for cleanup - stored in closure per instance
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copy(setCopied: (value: boolean) => void) {
    try {
      const content = generateContent();
      const success = await copyToClipboard(content);
      if (success) {
        setCopied(true);

        // Clear any existing timeout before creating a new one
        if (copiedTimeout) {
          clearTimeout(copiedTimeout);
        }

        // Reset copied state after 2 seconds
        copiedTimeout = setTimeout(() => {
          setCopied(false);
          copiedTimeout = null;
        }, 2000);
      }
    } catch (error) {
      console.error('Error copying CSV to clipboard:', error);
      setCopied(false);
    }
  }

  async function download(setExporting: (value: boolean) => void) {
    try {
      setExporting(true);
      const content = generateContent();
      const filename = getFilename();
      await downloadFile(content, filename);
    } catch (error) {
      console.error('Error downloading CSV:', error);
    } finally {
      setExporting(false);
    }
  }

  return {
    copy,
    download,
  };
}
