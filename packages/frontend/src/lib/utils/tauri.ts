// Tauri utilities

import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Check if the app is running in Tauri
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Window drag handler for Tauri
 */
export async function startWindowDrag(
  event: MouseEvent,
  excludeSelectors: string[] = []
): Promise<void> {
  if (!isTauri()) return;

  // Check if the click target matches any exclude selectors
  const target = event.target as HTMLElement;
  if (target) {
    for (const selector of excludeSelectors) {
      if (target.closest(selector)) {
        return;
      }
    }
  }

  try {
    const window = getCurrentWindow();
    await window.startDragging();
  } catch (error) {
    // Ignore errors - window dragging may not be available in all contexts
  }
}

/**
 * Create a window drag handler
 */
export function createWindowDragHandler(
  excludeSelectors: string[] = []
): (event: MouseEvent) => Promise<void> {
  return async (event: MouseEvent) => {
    await startWindowDrag(event, excludeSelectors);
  };
}
