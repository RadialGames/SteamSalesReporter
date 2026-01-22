import { onDestroy } from 'svelte';
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
 * Includes proper cleanup of timeouts on component destroy
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

  // Track timeout for cleanup
  let copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  // Cleanup on destroy
  onDestroy(() => {
    if (copiedTimeout) {
      clearTimeout(copiedTimeout);
      copiedTimeout = null;
    }
  });

  async function copy() {
    try {
      const content = generateContent();
      const success = await copyToClipboard(content);
      if (success) {
        state.copied = true;

        // Clear any existing timeout before creating a new one
        if (copiedTimeout) {
          clearTimeout(copiedTimeout);
        }

        // Reset copied state after 2 seconds
        copiedTimeout = setTimeout(() => {
          state.copied = false;
          copiedTimeout = null;
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
