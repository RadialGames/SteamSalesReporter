/**
 * Z-Index Constants
 *
 * Centralized z-index management to prevent conflicts between overlapping UI elements.
 * Use these constants instead of hardcoded z-index values.
 *
 * Layers (from back to front):
 * - Base content: z-0 to z-10
 * - Dropdowns/Tooltips: z-20 to z-30
 * - Fixed headers/Floating buttons: z-40 to z-50
 * - Modal backdrops: z-[100]
 * - Modal content: z-[101]
 * - Toast notifications: z-[200]
 * - Critical alerts: z-[300]
 */

// CSS class values for Tailwind
export const Z_INDEX = {
  // Background layers
  BASE: 'z-0',
  CONTENT: 'z-10',

  // Interactive overlays
  DROPDOWN: 'z-20',
  TOOLTIP: 'z-30',

  // Fixed UI elements
  HEADER: 'z-40',
  FLOATING_BUTTON: 'z-50',

  // Modals (use arbitrary values for higher z-index)
  MODAL_BACKDROP: 'z-[100]',
  MODAL_CONTENT: 'z-[101]',

  // Notifications
  TOAST: 'z-[200]',

  // Critical overlays (errors, alerts)
  CRITICAL: 'z-[300]',
} as const;

// Numeric values for JavaScript manipulation (e.g., inline styles)
export const Z_INDEX_VALUES = {
  BASE: 0,
  CONTENT: 10,
  DROPDOWN: 20,
  TOOLTIP: 30,
  HEADER: 40,
  FLOATING_BUTTON: 50,
  MODAL_BACKDROP: 100,
  MODAL_CONTENT: 101,
  TOAST: 200,
  CRITICAL: 300,
} as const;

/**
 * Get the modal z-index class for Tailwind.
 * Use this for modal backdrop and content containers.
 */
export function getModalZIndex(): string {
  return Z_INDEX.MODAL_BACKDROP;
}

/**
 * Get z-index for stacked modals.
 * When multiple modals need to stack, increment the base z-index.
 *
 * @param stackLevel - 0 for first modal, 1 for modal on top of modal, etc.
 */
export function getStackedModalZIndex(stackLevel: number = 0): number {
  return Z_INDEX_VALUES.MODAL_BACKDROP + stackLevel * 2;
}
