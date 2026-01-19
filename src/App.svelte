<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ApiKeyModal from '$lib/components/ApiKeyModal.svelte';
  import RefreshProgressModal from '$lib/components/RefreshProgressModal.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import { services } from '$lib/services';
  import { initializeDatabase } from '$lib/db/dexie';
  import { salesStore, settingsStore, isLoading, errorMessage } from '$lib/stores/sales';
  import type { ApiKeyInfo } from '$lib/services/types';
  import {
    type SyncSessionState,
    type SyncProgress,
    createSyncSessionState,
    runSync,
    isCancellationError,
  } from '$lib/services/sync-orchestrator';

  let showApiKeyModal = $state(false);
  let showProgressModal = $state(false);
  let refreshProgress = $state<SyncProgress>({
    phase: 'init',
    message: 'Preparing...',
    current: 0,
    total: 0,
    recordsFetched: 0,
  });
  let abortController: AbortController | null = $state(null);
  let isInitialized = $state(false);
  let stars: { x: number; y: number; delay: number }[] = $state([]);
  let apiKeys = $state<ApiKeyInfo[]>([]);

  // Session state - persists across pause/resume but cleared on modal close
  let syncSessionState: SyncSessionState | null = $state(null);

  let loadingMessage = $state('Initializing...');
  let loadingProgress = $state(0);

  async function loadApiKeys() {
    const keys = await services.getAllApiKeys();
    apiKeys = Array.isArray(keys) ? keys : [];
  }

  onMount(async () => {
    // Generate random stars for background
    stars = Array.from({ length: 50 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2,
    }));

    // Initialize database and clean up invalid records with progress
    loadingMessage = 'Initializing database...';
    loadingProgress = 1; // Show progress bar immediately

    const { cleanedRecords, databaseWiped } = await initializeDatabase((message, progress) => {
      loadingMessage = message;
      // Map initialization progress (0-100) to first 50% of overall progress
      loadingProgress = Math.round(progress * 0.5);
    });

    if (databaseWiped) {
      console.log(
        `Database wiped due to old data format. ${cleanedRecords} records cleared. Please refresh your data.`
      );
    }

    // Check if API keys exist
    loadingMessage = 'Checking settings...';
    loadingProgress = 55;
    await loadApiKeys();

    if (apiKeys.length === 0 || !apiKeys[0]) {
      showApiKeyModal = true;
      isInitialized = true;
    } else {
      // Use first key for settingsStore (legacy compatibility)
      const firstKeyInfo = apiKeys[0];
      const firstKey = await services.getApiKey(firstKeyInfo.id);
      if (firstKey) {
        settingsStore.setApiKey(firstKey);
      }

      // Load existing data from database with progress indication
      loadingMessage = 'Loading sales data...';
      loadingProgress = 60;

      try {
        const existingData = await services.getSalesFromDb({});
        loadingProgress = 85;

        if (existingData.length > 0) {
          loadingMessage = `Processing ${existingData.length.toLocaleString()} records...`;
          // Give UI time to update before potentially heavy store operation
          await new Promise((resolve) => setTimeout(resolve, 0));
          salesStore.setData(existingData);
          loadingProgress = 100;
        } else {
          loadingProgress = 100;
        }
      } catch (error) {
        console.error('Error loading data:', error);
        errorMessage.set('Failed to load existing data. Please try refreshing.');
      }

      isInitialized = true;
    }
  });

  async function handleKeysChanged() {
    // Reload API keys and data after changes
    await loadApiKeys();
    const firstKeyInfo = apiKeys[0];
    if (firstKeyInfo) {
      const firstKey = await services.getApiKey(firstKeyInfo.id);
      if (firstKey) {
        settingsStore.setApiKey(firstKey);
      }
      const existingData = await services.getSalesFromDb({});
      salesStore.setData(existingData);
    } else {
      settingsStore.setApiKey(null);
      salesStore.setData([]);
    }
  }

  async function handleRefreshData() {
    if (apiKeys.length === 0) {
      showApiKeyModal = true;
      return;
    }

    // Check if we're resuming from a paused state WITH existing session state
    // Scenario A: Resume - syncSessionState exists and phase is 'cancelled'
    // Scenario B: Fresh Start - syncSessionState is null (modal was closed)
    const isResuming = refreshProgress.phase === 'cancelled' && syncSessionState !== null;

    // Create new abort controller for this sync
    abortController = new AbortController();

    // Show progress modal
    showProgressModal = true;
    isLoading.set(true);
    errorMessage.set(null);

    try {
      // Initialize session state for fresh starts
      if (!isResuming) {
        syncSessionState = createSyncSessionState();
      }

      // Run sync using the orchestrator
      const { totalRecords } = await runSync(
        apiKeys,
        syncSessionState!,
        {
          onProgress: (progress) => {
            refreshProgress = progress;
          },
          getAbortSignal: () => abortController?.signal,
        },
        isResuming
      );

      // Always reload all data from database after sync
      const allData = await services.getSalesFromDb({});
      salesStore.setData(allData);

      // Show complete status and clear session state
      refreshProgress = {
        phase: 'complete',
        message:
          totalRecords > 0
            ? `Synced ${totalRecords.toLocaleString()} records!`
            : 'Already up to date!',
        current: syncSessionState?.totalDates ?? 0,
        total: syncSessionState?.totalDates ?? 0,
        recordsFetched: totalRecords,
      };
      syncSessionState = null; // Clear session state on complete
    } catch (err) {
      if (isCancellationError(err)) {
        // Reload any data that was saved before cancellation
        const allData = await services.getSalesFromDb({});
        salesStore.setData(allData);

        // Keep syncSessionState intact for potential resume!
        // It will be cleared when modal is closed (Scenario B)

        refreshProgress = {
          phase: 'cancelled',
          message:
            allData.length > 0
              ? `Sync paused. ${allData.length.toLocaleString()} records loaded so far.`
              : 'Sync was paused.',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: syncSessionState?.totalRecordsFetched ?? 0,
          keySegments: syncSessionState?.keySegments,
        };
      } else {
        console.error('Error refreshing data:', err);
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
        errorMessage.set(errorMsg);
        refreshProgress = {
          phase: 'error',
          message: 'Sync failed',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: refreshProgress.recordsFetched,
          error: errorMsg,
        };
        syncSessionState = null; // Clear session state on error
      }
    } finally {
      isLoading.set(false);
      abortController = null;
    }
  }

  function handleAbortSync() {
    if (abortController) {
      abortController.abort();
    }
  }

  function closeProgressModal() {
    showProgressModal = false;
    // Clear session state so next Refresh Data starts fresh
    // This is the key difference between Close (Scenario B) and Resume (Scenario A)
    syncSessionState = null;
  }

  function openSettings() {
    showApiKeyModal = true;
  }
</script>

<div class="min-h-screen relative">
  <!-- Animated stars background -->
  <div class="stars-bg">
    {#each stars as star, i (i)}
      <div
        class="star"
        style="left: {star.x}%; top: {star.y}%; animation-delay: {star.delay}s;"
      ></div>
    {/each}
  </div>

  <!-- Main content -->
  <div class="relative z-10">
    {#if !isInitialized}
      <div class="flex items-center justify-center min-h-screen">
        <div class="text-center">
          <UnicornLoader message={loadingMessage} />
          {#if loadingProgress > 0}
            <div class="mt-4 w-64 mx-auto">
              <div class="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 transition-all duration-500"
                  style="width: {loadingProgress}%"
                ></div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Header -->
      <header class="p-6 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <img src="/unicorn.svg" alt="Unicorn" class="w-12 h-12 unicorn-bounce" />
          <h1 class="text-3xl font-bold font-['Fredoka']">
            <span class="rainbow-text">Steam Sales Analyzer</span>
          </h1>
        </div>
        <div class="flex items-center gap-4">
          <button
            class="btn-rainbow flex items-center gap-2"
            onclick={handleRefreshData}
            disabled={$isLoading}
          >
            {#if $isLoading}
              <span class="inline-block animate-spin">&#10226;</span>
            {:else}
              <span>&#8635;</span>
            {/if}
            Refresh Data
          </button>
          <button class="btn-primary flex items-center gap-2" onclick={openSettings}>
            <span>&#9881;</span>
            Settings
          </button>
        </div>
      </header>

      <!-- Error message -->
      {#if $errorMessage}
        <div
          class="mx-6 mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 select-text cursor-text"
        >
          <strong>Oops!</strong> <span class="break-all">{$errorMessage}</span>
        </div>
      {/if}

      <!-- Dashboard -->
      <main class="p-6">
        <Dashboard />
      </main>
    {/if}
  </div>

  <!-- API Key Modal -->
  {#if showApiKeyModal}
    <ApiKeyModal onclose={() => (showApiKeyModal = false)} onkeyschanged={handleKeysChanged} />
  {/if}

  <!-- Refresh Progress Modal -->
  {#if showProgressModal}
    <RefreshProgressModal
      progress={refreshProgress}
      oncancel={closeProgressModal}
      onabort={handleAbortSync}
      onresume={handleRefreshData}
    />
  {/if}
</div>
