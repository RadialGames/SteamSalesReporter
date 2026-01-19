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

  // Session state for tracking sync progress across pause/resume
  // This is cleared when the modal is closed, ensuring fresh starts work correctly
  interface KeySyncState {
    sortedDates: string[];       // Full list of all dates for this key
    processedDates: Set<string>; // Dates completed in this session
    newHighwatermark: number;    // HWM to save on success
    apiKey: string;              // The actual API key value
    newDates: number;            // Count of new dates (Phase 1)
    reprocessDates: number;      // Count of update dates (Phase 2)
    phase1Dates: string[];       // New dates (Phase 1) - processed first
    phase2Dates: string[];       // Update dates (Phase 2) - processed after all Phase 1
  }
  
  interface SyncSessionState {
    keyStates: Map<string, KeySyncState>;  // Keyed by apiKeyId
    keySegments: { keyId: string; keyName: string; newDates: number; reprocessDates: number }[];
    totalDates: number;
    totalRecordsFetched: number;
  }

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
      delay: Math.random() * 2
    }));

    // Initialize database and clean up invalid records with progress
    loadingMessage = 'Initializing database...';
    loadingProgress = 1; // Show progress bar immediately
    
    const { cleanedRecords, duplicateIdsRemoved, duplicateLogicalRecordsRemoved } = await initializeDatabase((message, progress) => {
      loadingMessage = message;
      // Map initialization progress (0-100) to first 50% of overall progress
      loadingProgress = Math.round(progress * 0.5);
    });
    
    if (duplicateIdsRemoved > 0) {
      console.log(`Startup cleanup: removed ${duplicateIdsRemoved} records with duplicate IDs`);
    }
    if (duplicateLogicalRecordsRemoved > 0) {
      console.log(`Startup cleanup: removed ${duplicateLogicalRecordsRemoved} duplicate logical records`);
    }
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
      let keySegments: { keyId: string; keyName: string; newDates: number; reprocessDates: number }[];
      let totalDatesAcrossAllKeys: number;
      let totalDatesToReprocess: number;
      
      if (isResuming && syncSessionState) {
        // SCENARIO A: Resume from pause - use cached session state
        // Don't re-fetch dates, use the cached sorted order
        keySegments = syncSessionState.keySegments;
        totalDatesAcrossAllKeys = syncSessionState.totalDates;
        totalDatesToReprocess = keySegments.reduce((sum, k) => sum + k.reprocessDates, 0);
        
        // Calculate current progress from processed dates
        let processedCount = 0;
        for (const [, keyState] of syncSessionState.keyStates) {
          processedCount += keyState.processedDates.size;
        }
        
        refreshProgress = {
          phase: 'sales',
          message: 'Resuming sync...',
          current: processedCount,
          total: totalDatesAcrossAllKeys,
          recordsFetched: syncSessionState.totalRecordsFetched,
          keySegments
        };
      } else {
        // SCENARIO B: Fresh start - fetch dates from Steam API
        syncSessionState = {
          keyStates: new Map(),
          keySegments: [],
          totalDates: 0,
          totalRecordsFetched: 0
        };
        
        refreshProgress = {
          phase: 'dates',
          message: 'Checking for updates across all API keys...',
          current: 0,
          total: apiKeys.length,
          recordsFetched: 0
        };
        
        keySegments = [];
        totalDatesAcrossAllKeys = 0;
        totalDatesToReprocess = 0;
        
        // Fetch changed dates for each API key and build session state
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
          
          // Separate dates into Phase 1 (new) and Phase 2 (updates)
          const newDates = dates.filter(d => !existingDates.has(d));
          const updateDates = dates.filter(d => existingDates.has(d));
          
          // Sort each phase chronologically
          newDates.sort((a, b) => a.localeCompare(b));
          updateDates.sort((a, b) => a.localeCompare(b));
          
          totalDatesToReprocess += updateDates.length;
          totalDatesAcrossAllKeys += dates.length;
          
          const keyName = keyInfo.displayName || `Key ...${keyInfo.keyHash}`;
          
          // Store in session state - keep phases separate for ordered processing
          syncSessionState.keyStates.set(keyInfo.id, {
            sortedDates: dates, // Keep full list for tracking
            processedDates: new Set(),
            newHighwatermark,
            apiKey,
            newDates: newDates.length,
            reprocessDates: updateDates.length,
            phase1Dates: newDates,   // New dates - processed first
            phase2Dates: updateDates // Update dates - processed after all Phase 1
          });
          
          keySegments.push({
            keyId: keyInfo.id,
            keyName,
            newDates: newDates.length,
            reprocessDates: updateDates.length
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
        
        // Update session state with final counts
        syncSessionState.keySegments = keySegments;
        syncSessionState.totalDates = totalDatesAcrossAllKeys;
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
        syncSessionState = null; // Clear session state on complete
        isLoading.set(false);
        abortController = null;
        return;
      }
      
      // Helper to get total processed dates across all keys
      const getTotalProcessedDates = () => {
        let count = 0;
        for (const [, keyState] of syncSessionState!.keyStates) {
          count += keyState.processedDates.size;
        }
        return count;
      };
      
      // Helper to process a batch of dates for a key
      const processDatesForKey = async (
        keyId: string,
        datesToProcess: string[],
        phaseLabel: string
      ) => {
        const keyState = syncSessionState?.keyStates.get(keyId);
        if (!keyState || datesToProcess.length === 0) return;
        
        const keyInfo = apiKeys.find(k => k.id === keyId);
        const segment = keySegments.find(s => s.keyId === keyId);
        if (!keyInfo || !segment) return;
        
        const keyName = segment.keyName;
        
        // Filter out already processed dates
        const remainingDates = datesToProcess.filter(d => !keyState.processedDates.has(d));
        if (remainingDates.length === 0) return;
        
        // Capture the record count BEFORE starting this fetch call
        // This is the base we'll add to progress.recordsFetched
        const recordsBeforeThisFetch = syncSessionState?.totalRecordsFetched ?? 0;
        
        // Fetch data from Steam API
        await services.fetchSalesData({
          apiKey: keyState.apiKey,
          apiKeyId: keyInfo.id,
          signal: abortController!.signal,
          datesToFetch: remainingDates,
          onProgress: (progress) => {
            // Use processedDates.size as the authoritative count (updated by onDateProcessed)
            // Don't add progress.current - it would double-count
            const totalProcessed = getTotalProcessedDates();
            
            // progress.recordsFetched is cumulative within THIS fetch call
            // Add it to the base from before this fetch started
            const totalRecordsFetched = recordsBeforeThisFetch + (progress.recordsFetched ?? 0);
            
            // Update session state so it's correct if user pauses
            if (syncSessionState) {
              syncSessionState.totalRecordsFetched = totalRecordsFetched;
            }
            
            refreshProgress = {
              ...progress,
              message: `${phaseLabel}: Fetching sales data...`,
              current: totalProcessed,
              total: totalDatesAcrossAllKeys,
              recordsFetched: totalRecordsFetched,
              currentKeyId: keyInfo.id,
              currentKeyName: keyName,
              totalKeys: keySegments.length,
              datesToReprocess: totalDatesToReprocess,
              keySegments
            };
          },
          onDateProcessed: (date: string) => {
            // Track this date as processed in session state
            keyState.processedDates.add(date);
          }
        });
      };
      
      // PHASE 1: Process all NEW dates across all keys first
      for (const segment of keySegments) {
        const keyState = syncSessionState?.keyStates.get(segment.keyId);
        if (!keyState) continue;
        
        // Check if cancelled
        if (abortController.signal.aborted) {
          throw new Error('SyncCancelledError');
        }
        
        if (keyState.phase1Dates.length > 0) {
          await processDatesForKey(segment.keyId, keyState.phase1Dates, 'Phase 1 (New Data)');
        }
      }
      
      // PHASE 2: Process all UPDATE dates across all keys
      for (const segment of keySegments) {
        const keyState = syncSessionState?.keyStates.get(segment.keyId);
        if (!keyState) continue;
        
        // Check if cancelled
        if (abortController.signal.aborted) {
          throw new Error('SyncCancelledError');
        }
        
        if (keyState.phase2Dates.length > 0) {
          await processDatesForKey(segment.keyId, keyState.phase2Dates, 'Phase 2 (Updates)');
        }
        
        // Save highwatermark AFTER all dates for this key are processed
        if (keyState.processedDates.size === keyState.sortedDates.length) {
          const keyInfo = apiKeys.find(k => k.id === segment.keyId);
          if (keyInfo) {
            const currentHighwatermark = await services.getHighwatermark(keyInfo.id);
            if (keyState.newHighwatermark > currentHighwatermark) {
              await services.setHighwatermark(keyInfo.id, keyState.newHighwatermark);
            }
          }
        }
      }
      
      // Always reload all data from database after sync
      const allData = await services.getSalesFromDb({});
      salesStore.setData(allData);
      
      const totalRecordCount = syncSessionState?.totalRecordsFetched ?? 0;
      
      // Show complete status and clear session state
      refreshProgress = {
        phase: 'complete',
        message: totalRecordCount > 0 
          ? `Synced ${totalRecordCount.toLocaleString()} records!`
          : 'Already up to date!',
        current: totalDatesAcrossAllKeys,
        total: totalDatesAcrossAllKeys,
        recordsFetched: totalRecordCount
      };
      syncSessionState = null; // Clear session state on complete
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
        
        // Keep syncSessionState intact for potential resume!
        // It will be cleared when modal is closed (Scenario B)
        
        refreshProgress = {
          phase: 'cancelled',
          message: allData.length > 0 
            ? `Sync paused. ${allData.length.toLocaleString()} records loaded so far.`
            : 'Sync was paused.',
          current: refreshProgress.current,
          total: refreshProgress.total,
          recordsFetched: syncSessionState?.totalRecordsFetched ?? 0,
          keySegments: syncSessionState?.keySegments
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
