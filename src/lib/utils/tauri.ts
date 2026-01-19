// Tauri-specific utilities
// These are no-ops when not running in Tauri

/**
 * Check if the app is running in Tauri
 */
export function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

/**
 * Start dragging the window from a mouse event.
 * 
 * This enables frameless window dragging in Tauri apps.
 * Does nothing when not running in Tauri.
 * 
 * Usage: Add `onmousedown={startWindowDrag}` to draggable elements.
 * 
 * @param event - The mouse event that triggered the drag
 * @param excludeSelectors - CSS selectors for elements that should NOT trigger drag
 *                           (defaults to interactive elements like buttons, inputs, etc.)
 * 
 * @example
 * // Basic usage on a header
 * <div onmousedown={startWindowDrag}>Drag me</div>
 * 
 * @example
 * // Custom exclusions
 * <div onmousedown={(e) => startWindowDrag(e, ['button', 'a', '.no-drag'])}>
 *   Drag me (except buttons, links, and .no-drag elements)
 * </div>
 */
export async function startWindowDrag(
  event: MouseEvent,
  excludeSelectors: string[] = ['button', 'a', 'input', 'select', 'textarea', '.glass-card', '[data-no-drag]']
): Promise<void> {
  // Check if clicking on an element that should not trigger drag
  const target = event.target as HTMLElement;
  const excludeSelector = excludeSelectors.join(', ');
  
  if (target.closest(excludeSelector)) {
    return;
  }
  
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch (error) {
      // Silently fail if Tauri API is not available
      console.warn('Failed to start window drag:', error);
    }
  }
}

/**
 * Create a window drag handler with custom exclusions.
 * Useful for creating reusable handlers in components.
 * 
 * @param excludeSelectors - CSS selectors for elements that should NOT trigger drag
 * @returns A mouse event handler for window dragging
 * 
 * @example
 * const handleDrag = createWindowDragHandler(['button', '.interactive']);
 * <div onmousedown={handleDrag}>Drag me</div>
 */
export function createWindowDragHandler(
  excludeSelectors: string[] = ['button', 'a', 'input', 'select', 'textarea', '.glass-card', '[data-no-drag]']
): (event: MouseEvent) => Promise<void> {
  return (event: MouseEvent) => startWindowDrag(event, excludeSelectors);
}
