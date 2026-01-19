<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ApiKeyModal from '$lib/components/ApiKeyModal.svelte';
  import RefreshProgressModal from '$lib/components/RefreshProgressModal.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import { services } from '$lib/services';
  import { initializeDatabase } from '$lib/db/dexie';
  import { salesStore, settingsStore, isLoading, errorMessage } from '$lib/stores/sales';
  import type { FetchProgress, ApiKeyInfo } from '$lib/services/types';

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
  let apiKeys = $state<ApiKeyInfo[]>([]);

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
      delay: Math.random() * 2
    }));

    // Initialize database and clean up invalid records with progress
    loadingMessage = 'Initializing database...';
    loadingProgress = 1; // Show progress bar immediately
    
    const { cleanedRecords } = await initializeDatabase((message, progress) => {
      loadingMessage = message;
      // Map initialization progress (0-100) to first 50% of overall progress
      loadingProgress = Math.round(progress * 0.5);
    });
    
    if (cleanedRecords > 0) {
      console.log(`Startup cleanup: removed ${cleanedRecords} records with missing apiKeyId`);
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
          await new Promise(resolve => setTimeout(resolve, 0));
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
      // Phase 1: Pre-count dates across all keys for accurate progress
      refreshProgress = {
        phase: 'dates',
        message: 'Checking for updates across all API keys...',
        current: 0,
        total: apiKeys.length,
        recordsFetched: 0
      };
      
      const keyDateInfo: { 
        keyInfo: typeof apiKeys[0]; 
        apiKey: string; 
        dates: string[]; 
        newHighwatermark: number;
        newDates: number;
        reprocessDates: number;
      }[] = [];
      let totalDatesAcrossAllKeys = 0;
      let totalDatesToReprocess = 0;
      
      // Build key segments for progress bar as we go
      const keySegments: { keyId: string; keyName: string; newDates: number; reprocessDates: number }[] = [];
      
      for (let i = 0; i < apiKeys.length; i++) {
        const keyInfo = apiKeys[i];
        const apiKey = await services.getApiKey(keyInfo.id);
        
        if (!apiKey) continue;
        
        // Check if cancelled
        if (abortController.signal.aborted) {
          throw new Error('SyncCancelledError');
        }
        
        const { dates, newHighwatermark } = await services.getChangedDates(apiKey, keyInfo.id);
        
        // Get existing dates to calculate re-processing count
        const existingDates = await services.getExistingDates(keyInfo.id);
        const reprocessCount = dates.filter(d => existingDates.has(d)).length;
        const newCount = dates.length - reprocessCount;
        
        totalDatesToReprocess += reprocessCount;
        totalDatesAcrossAllKeys += dates.length;
        
        const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
        
        keyDateInfo.push({ 
          keyInfo, 
          apiKey, 
          dates, 
          newHighwatermark,
          newDates: newCount,
          reprocessDates: reprocessCount
        });
        
        keySegments.push({
          keyId: keyInfo.id,
          keyName,
          newDates: newCount,
          reprocessDates: reprocessCount
        });
        
        refreshProgress = {
          phase: 'dates',
          message: `Checking API key ${i + 1} of ${apiKeys.length}...`,
          current: i + 1,
          total: apiKeys.length,
          recordsFetched: 0,
          currentKeyId: keyInfo.id,
          currentKeyName: keyName,
          currentKeyIndex: i,
          totalKeys: apiKeys.length,
          datesToReprocess: totalDatesToReprocess,
          keySegments: [...keySegments]
        };
      }
      
      // If no dates to process, we're done
      if (totalDatesAcrossAllKeys === 0) {
        refreshProgress = {
          phase: 'complete',
          message: 'Already up to date!',
          current: 0,
          total: 0,
          recordsFetched: 0
        };
        isLoading.set(false);
        abortController = null;
        return;
      }
      
      // Phase 2: Fetch sales data for each key, tracking cumulative progress
      let totalRecordCount = 0;
      let datesProcessedSoFar = 0;
      
      for (let keyIndex = 0; keyIndex < keyDateInfo.length; keyIndex++) {
        const { keyInfo, apiKey, dates, newHighwatermark } = keyDateInfo[keyIndex];
        
        if (dates.length === 0) continue;
        
        const datesOffsetForThisKey = datesProcessedSoFar;
        const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
        
        // Fetch data from Steam API for this key
        const { recordCount = 0 } = await services.fetchSalesData({
          apiKey,
          apiKeyId: keyInfo.id,
          signal: abortController.signal,
          onProgress: (progress) => {
            // Adjust current/total to reflect cumulative progress across all keys
            refreshProgress = {
              ...progress,
              current: datesOffsetForThisKey + progress.current,
              total: totalDatesAcrossAllKeys,
              currentKeyId: keyInfo.id,
              currentKeyName: keyName,
              currentKeyIndex: keyIndex,
              totalKeys: keyDateInfo.length,
              datesToReprocess: totalDatesToReprocess,
              keySegments
            };
          }
        });
        
        datesProcessedSoFar += dates.length;
        
        // Save highwatermark AFTER fetch completes successfully
        const currentHighwatermark = await services.getHighwatermark(keyInfo.id);
        if (newHighwatermark > currentHighwatermark) {
          await services.setHighwatermark(keyInfo.id, newHighwatermark);
        }
        
        totalRecordCount += recordCount;
      }
      
      // Always reload all data from database after sync
      const allData = await services.getSalesFromDb({});
      salesStore.setData(allData);
      
      // Show complete status
      refreshProgress = {
        phase: 'complete',
        message: totalRecordCount > 0 
          ? `Synced ${totalRecordCount.toLocaleString()} records!`
          : 'Already up to date!',
        current: refreshProgress.total,
        total: refreshProgress.total,
        recordsFetched: totalRecordCount
      };
    } catch (err) {
      // Check if this was a cancellation/pause
      const isCancelled = err instanceof Error && (
        err.name === 'SyncCancelledError' || 
        err.name === 'AbortError' ||
        err.message === 'SyncCancelledError'
      );
      if (isCancelled) {
        // Reload any data that was saved before cancellation
        const allData = await services.getSalesFromDb({});
        salesStore.setData(allData);
        
        refreshProgress = {
          phase: 'cancelled',
          message: allData.length > 0 
            ? `Sync paused. ${allData.length.toLocaleString()} records loaded so far.`
            : 'Sync was paused.',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: allData.length
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
        <div class="mx-6 mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 select-text cursor-text">
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
    <ApiKeyModal
      onClose={() => showApiKeyModal = false}
      onKeysChanged={handleKeysChanged}
    />
  {/if}

  <!-- Refresh Progress Modal -->
  {#if showProgressModal}
    <RefreshProgressModal
      progress={refreshProgress}
      onCancel={closeProgressModal}
      onAbort={handleAbortSync}
      onResume={handleRefreshData}
    />
  {/if}
</div>
