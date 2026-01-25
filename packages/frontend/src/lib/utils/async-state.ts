import { onMount, onDestroy } from 'svelte';

/**
 * Result of an async operation
 */
export interface AsyncState<T> {
  isLoading: boolean;
  data: T | null;
  error: Error | null;
  hasData: boolean;
}

/**
 * Options for async data loading
 */
export interface AsyncDataOptions<T> {
  onError?: (error: Error) => void;
  onSuccess?: (data: T) => void;
  initialData?: T | null;
}

/**
 * Hook for managing async data loading state
 * Provides consistent loading, error, and data states across components
 * Includes mounted state tracking to prevent updates after unmount
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions<T> = {}
): AsyncState<T> {
  const { onError, onSuccess, initialData = null } = options;

  // Track mounted state to prevent updates after unmount
  let isMounted = true;

  const state = $state<AsyncState<T>>({
    isLoading: true,
    data: initialData,
    error: null,
    hasData: false,
  });

  onMount(async () => {
    state.isLoading = true;
    state.error = null;

    try {
      const data = await loader();
      // Only update state if still mounted
      if (isMounted) {
        state.data = data;
        state.hasData = Array.isArray(data) ? data.length > 0 : data != null;
        onSuccess?.(data);
      }
    } catch (error) {
      // Only update state if still mounted
      if (isMounted) {
        const err = error instanceof Error ? error : new Error(String(error));
        state.error = err;
        state.hasData = false;
        onError?.(err);
      }
    } finally {
      // Only update state if still mounted
      if (isMounted) {
        state.isLoading = false;
      }
    }
  });

  onDestroy(() => {
    isMounted = false;
  });

  return state;
}

/**
 * Hook for reloading async data on demand
 * Extends useAsyncData with a reload function
 * Includes mounted state tracking to prevent updates after unmount
 */
export function useReloadableAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions<T> = {}
): AsyncState<T> & { reload: () => Promise<void> } {
  const { onError, onSuccess, initialData = null } = options;

  // Track mounted state to prevent updates after unmount
  let isMounted = true;

  const state = $state<AsyncState<T>>({
    isLoading: true,
    data: initialData,
    error: null,
    hasData: false,
  });

  const loadData = async () => {
    if (!isMounted) return;

    state.isLoading = true;
    state.error = null;

    try {
      const data = await loader();
      // Only update state if still mounted
      if (isMounted) {
        state.data = data;
        state.hasData = Array.isArray(data) ? data.length > 0 : data != null;
        onSuccess?.(data);
      }
    } catch (error) {
      // Only update state if still mounted
      if (isMounted) {
        const err = error instanceof Error ? error : new Error(String(error));
        state.error = err;
        state.hasData = false;
        onError?.(err);
      }
    } finally {
      // Only update state if still mounted
      if (isMounted) {
        state.isLoading = false;
      }
    }
  };

  onMount(loadData);

  onDestroy(() => {
    isMounted = false;
  });

  return {
    ...state,
    reload: loadData,
  };
}
