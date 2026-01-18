<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ApiKeyModal from '$lib/components/ApiKeyModal.svelte';
  import RefreshProgressModal from '$lib/components/RefreshProgressModal.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import { services } from '$lib/services';
  import { salesStore, settingsStore, isLoading, errorMessage } from '$lib/stores/sales';
  import type { FetchProgress } from '$lib/services/types';

  let showApiKeyModal = $state(false);
  let showProgressModal = $state(false);
  let refreshProgress = $state<FetchProgress & { phase: FetchProgress['phase'] | 'cancelled' }>({
    phase: 'init',
    message: 'Preparing...',
    current: 0,
    total: 0,
    recordsFetched: 0
  });
  let abortController: AbortController | null = $state(null);
  let isInitialized = $state(false);
  let stars: { x: number; y: number; delay: number }[] = $state([]);

  onMount(async () => {
    // Generate random stars for background
    stars = Array.from({ length: 50 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2
    }));

    // Check if API key exists
    const apiKey = await services.getApiKey();
    if (!apiKey) {
      showApiKeyModal = true;
    } else {
      settingsStore.setApiKey(apiKey);
      // Load existing data from database
      const existingData = await services.getSalesFromDb({});
      if (existingData.length > 0) {
        salesStore.setData(existingData);
      }
    }
    isInitialized = true;
  });

  async function handleApiKeySaved(key: string) {
    await services.setApiKey(key);
    settingsStore.setApiKey(key);
    showApiKeyModal = false;
  }

  async function handleRefreshData() {
    const apiKey = settingsStore.apiKey;
    if (!apiKey) {
      showApiKeyModal = true;
      return;
    }

    // Create new abort controller for this sync
    abortController = new AbortController();
    
    // Show progress modal
    showProgressModal = true;
    refreshProgress = {
      phase: 'init',
      message: 'Preparing to sync...',
      current: 0,
      total: 0,
      recordsFetched: 0
    };
    isLoading.set(true);
    errorMessage.set(null);

    try {
      // Fetch data from Steam API
      // Note: Data is saved incrementally to the database during fetch
      // to prevent memory issues with large datasets
      const { newHighwatermark, recordCount = 0 } = await services.fetchSalesData({
        apiKey,
        signal: abortController.signal,
        onProgress: (progress) => {
          refreshProgress = progress;
        }
      });
      
      // Save highwatermark AFTER fetch completes successfully
      // (data is already saved incrementally during fetch)
      const currentHighwatermark = await services.getHighwatermark();
      if (newHighwatermark > currentHighwatermark) {
        await services.setHighwatermark(newHighwatermark);
      }
      
      // Always reload all data from database after sync
      // Data was saved incrementally during fetch, so we need to refresh the store
      const allData = await services.getSalesFromDb({});
      salesStore.setData(allData);
      
      // Show complete status
      refreshProgress = {
        phase: 'complete',
        message: recordCount > 0 
          ? `Synced ${recordCount.toLocaleString()} records!`
          : 'Already up to date!',
        current: refreshProgress.total,
        total: refreshProgress.total,
        recordsFetched: recordCount
      };
    } catch (err) {
      // Check if this was a cancellation
      if (err instanceof Error && (err.name === 'SyncCancelledError' || err.name === 'AbortError')) {
        refreshProgress = {
          phase: 'cancelled',
          message: 'Sync was cancelled.',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: refreshProgress.recordsFetched
        };
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
        errorMessage.set(errorMsg);
        refreshProgress = {
          phase: 'error',
          message: 'Sync failed',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: refreshProgress.recordsFetched,
          error: errorMsg
        };
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
  }

  async function handleWipeData() {
    // Clear all local data (sales, highwatermark, API key)
    await services.clearAllData();
    
    // Reset stores
    salesStore.setData([]);
    settingsStore.setApiKey(null);
    
    // Modal stays open and shows success message
    // User will enter new API key in the same modal
  }
  
  // Determine if there's data to wipe (API key exists or there are sales records)
  let hasDataToWipe = $derived(
    settingsStore.apiKey !== null || $salesStore.length > 0
  );

  function openSettings() {
    showApiKeyModal = true;
  }
</script>

<div class="min-h-screen relative">
  <!-- Animated stars background -->
  <div class="stars-bg">
    {#each stars as star}
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
        <UnicornLoader message="Summoning magical sales data..." />
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
          <button
            class="btn-primary flex items-center gap-2"
            onclick={openSettings}
          >
            <span>&#9881;</span>
            Settings
          </button>
        </div>
      </header>

      <!-- Error message -->
      {#if $errorMessage}
        <div class="mx-6 mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
          <strong>Oops!</strong> {$errorMessage}
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
    <ApiKeyModal
      onSave={handleApiKeySaved}
      onClose={() => showApiKeyModal = false}
      onWipeData={handleWipeData}
      currentKey={settingsStore.apiKey}
      hasDataToWipe={hasDataToWipe}
    />
  {/if}

  <!-- Refresh Progress Modal -->
  {#if showProgressModal}
    <RefreshProgressModal
      progress={refreshProgress}
      onCancel={closeProgressModal}
      onAbort={handleAbortSync}
    />
  {/if}
</div>
