import { onMount } from 'svelte';

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
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions<T> = {}
): AsyncState<T> {
  const { onError, onSuccess, initialData = null } = options;

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
      state.data = data;
      state.hasData = Array.isArray(data) ? data.length > 0 : data != null;
      onSuccess?.(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      state.error = err;
      state.hasData = false;
      onError?.(err);
    } finally {
      state.isLoading = false;
    }
  });

  return state;
}

/**
 * Hook for reloading async data on demand
 * Extends useAsyncData with a reload function
 */
export function useReloadableAsyncData<T>(
  loader: () => Promise<T>,
  options: AsyncDataOptions<T> = {}
): AsyncState<T> & { reload: () => Promise<void> } {
  const { onError, onSuccess, initialData = null } = options;

  const state = $state<AsyncState<T>>({
    isLoading: true,
    data: initialData,
    error: null,
    hasData: false,
  });

  const loadData = async () => {
    state.isLoading = true;
    state.error = null;

    try {
      const data = await loader();
      state.data = data;
      state.hasData = Array.isArray(data) ? data.length > 0 : data != null;
      onSuccess?.(data);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      state.error = err;
      state.hasData = false;
      onError?.(err);
    } finally {
      state.isLoading = false;
    }
  };

  onMount(loadData);

  return {
    ...state,
    reload: loadData,
  };
}
