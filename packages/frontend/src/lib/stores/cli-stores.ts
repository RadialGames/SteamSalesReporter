/**
 * Stores for CLI management
 */

import { writable } from 'svelte/store';
import * as cliApi from '$lib/api/cli-client';
import type { CliStatus } from '$lib/api/cli-client';

// ==================== CLI Status Store ====================

function createCliStatusStore() {
  const status = writable<CliStatus | null>(null);
  const loading = writable(false);
  const error = writable<string | null>(null);

  return {
    subscribe: status.subscribe,
    loading: { subscribe: loading.subscribe },
    error: { subscribe: error.subscribe },

    async load() {
      console.log('[cliStatusStore] Starting load...');
      loading.set(true);
      error.set(null);
      try {
        console.log('[cliStatusStore] Calling cliApi.getCliStatus()...');
        const data = await cliApi.getCliStatus();
        console.log('[cliStatusStore] Got status data:', data);
        status.set(data);
        console.log('[cliStatusStore] Status set in store');
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Failed to load CLI status';
        console.error('[cliStatusStore] Error loading status:', errorMsg, e);
        error.set(errorMsg);
      } finally {
        loading.set(false);
        console.log('[cliStatusStore] Load complete');
      }
    },
  };
}

export const cliStatusStore = createCliStatusStore();

// ==================== CLI Operations Store ====================

function createCliOperationsStore() {
  const downloading = writable(false);
  const initializing = writable(false);
  const fetching = writable(false);
  const error = writable<string | null>(null);

  return {
    downloading: { subscribe: downloading.subscribe },
    initializing: { subscribe: initializing.subscribe },
    fetching: { subscribe: fetching.subscribe },
    error: { subscribe: error.subscribe },

    async downloadCli(version?: string) {
      downloading.set(true);
      error.set(null);
      try {
        await cliApi.downloadCli(version);
        await cliStatusStore.load();
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to download CLI tool');
        throw e;
      } finally {
        downloading.set(false);
      }
    },

    async initCli(apiKey: string) {
      initializing.set(true);
      error.set(null);
      try {
        await cliApi.initCli(apiKey);
        await cliStatusStore.load();
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to initialize CLI');
        throw e;
      } finally {
        initializing.set(false);
      }
    },

    async fetchData(options: { force?: boolean } = {}) {
      fetching.set(true);
      error.set(null);
      try {
        await cliApi.fetchData(options);
        await cliStatusStore.load();
        // Database is now always available via Tauri commands - no need to load it
      } catch (e) {
        error.set(e instanceof Error ? e.message : 'Failed to fetch data');
        throw e;
      } finally {
        fetching.set(false);
      }
    },
  };
}

export const cliOperationsStore = createCliOperationsStore();
