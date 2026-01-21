import { copyToClipboard, downloadFile } from '$lib/utils/csv-export';

/**
 * State for CSV export operations
 */
export interface CsvExportState {
  isExporting: boolean;
  copied: boolean;
}

/**
 * Hook for managing CSV export functionality
 * Provides consistent copy and download functionality across components
 */
export function useCsvExport(
  generateContent: () => string,
  getFilename: () => string = () => 'export.csv'
): CsvExportState & {
  copy: () => Promise<void>;
  download: () => void;
} {
  const state = $state<CsvExportState>({
    isExporting: false,
    copied: false,
  });

  async function copy() {
    try {
      const content = generateContent();
      const success = await copyToClipboard(content);
      if (success) {
        state.copied = true;

        // Reset copied state after 2 seconds
        setTimeout(() => {
          state.copied = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Error copying CSV to clipboard:', error);
      state.copied = false;
    }
  }

  function download() {
    try {
      state.isExporting = true;
      const content = generateContent();
      const filename = getFilename();
      downloadFile(content, filename);
    } catch (error) {
      console.error('Error downloading CSV:', error);
    } finally {
      state.isExporting = false;
    }
  }

  return {
    ...state,
    copy,
    download,
  };
}
