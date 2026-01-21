// Common loading state management utilities

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

/**
 * Creates a loading state with async operation wrapper
 */
export function createLoadingState(): LoadingState & {
  executeAsync: <T>(operation: () => Promise<T>) => Promise<T | null>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
} {
  const state = $state<LoadingState>({
    isLoading: false,
    error: null,
  });

  return {
    get isLoading() {
      return state.isLoading;
    },
    get error() {
      return state.error;
    },
    executeAsync: async <T>(operation: () => Promise<T>): Promise<T | null> => {
      state.isLoading = true;
      state.error = null;
      try {
        const result = await operation();
        return result;
      } catch (error) {
        state.error = error instanceof Error ? error.message : 'An error occurred';
        console.error(error);
        return null;
      } finally {
        state.isLoading = false;
      }
    },
    setLoading: (loading: boolean) => {
      state.isLoading = loading;
    },
    setError: (error: string | null) => {
      state.error = error;
    },
    reset: () => {
      state.isLoading = false;
      state.error = null;
    },
  };
}

/**
 * Loading spinner component template
 */
export const loadingSpinner = '<span class="inline-block animate-spin">&#10226;</span>';

/**
 * Loading skeleton component template
 */
export function loadingSkeleton(width = 'w-20', height = 'h-6') {
  return `<div class="${height} ${width} bg-white/20 rounded animate-pulse"></div>`;
}
