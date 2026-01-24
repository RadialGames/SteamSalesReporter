<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import ApiKeyModal from '$lib/components/ApiKeyModal.svelte';
  import RefreshProgressModal from '$lib/components/RefreshProgressModal.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import { services, syncTaskService } from '$lib/services';
  import type { SyncProgress } from '$lib/services/types';
  import { initializeDatabase } from '$lib/db/sqlite';
  import { isParsingInProgress, clearParsingInProgress } from '$lib/db/data-state';
  import { resetParsingRecords, getUnparsedRawData } from '$lib/db/raw-data';
  import { getDisplayCache } from '$lib/db/display-cache';
  import {
    processDataIfDirty,
    processDataForcefully,
    processDataIncrementally,
    getUnparsedRawDataCount,
    processRemainingDataInBackground,
  } from '$lib/db/data-processor';
  import { salesStore, settingsStore, isLoading, errorMessage } from '$lib/stores/sales';
  import type { ApiKeyInfo } from '$lib/services/types';
  import { SyncOrchestrator, isCancellationError } from '$lib/services/sync-orchestrator';

  let showApiKeyModal = $state(false);
  let showProgressModal = $state(false);
  let refreshProgress = $state<SyncProgress>({
    phase: 'discovery',
    message: 'Preparing...',
  });
  let abortController: AbortController | null = $state(null);
  let isInitialized = $state(false);
  let stars: { x: number; y: number; delay: number }[] = $state([]);
  let apiKeys = $state<ApiKeyInfo[]>([]);

  // Track if we're in a paused state with pending work
  let hasPendingWork = $state(false);
  // Track if cancellation has been initiated to prevent progress updates from overwriting cancelled state
  let isCancelling = $state(false);

  let loadingMessage = $state('Initializing...');
  let loadingProgress = $state(0);

  async function loadApiKeys() {
    try {
      const keys = await services.getAllApiKeys();
      apiKeys = Array.isArray(keys) ? keys : [];
      console.log(`Loaded ${apiKeys.length} API key(s) from database`);
    } catch (error) {
      console.error('Error loading API keys:', error);
      errorMessage.set('Failed to load API keys. Please try refreshing the app.');
      apiKeys = [];
    }
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

    // Reset any in_progress tasks from crashed/interrupted syncs
    loadingMessage = 'Checking for interrupted syncs...';
    loadingProgress = 51;
    const resetCount = await syncTaskService.resetInProgressTasks();
    if (resetCount > 0) {
      console.log(`Reset ${resetCount} interrupted sync tasks`);
    }

    // Check if there are pending tasks from a previous incomplete sync
    const orchestrator = new SyncOrchestrator(services, syncTaskService, 100);
    hasPendingWork = await orchestrator.hasPendingTasks();
    if (hasPendingWork) {
      console.log('Found pending sync tasks from previous session');
    }

    // Crash recovery: Check if parsing was in progress
    loadingMessage = 'Checking for interrupted operations...';
    loadingProgress = 52;
    if (await isParsingInProgress()) {
      loadingMessage = 'Recovering from interrupted parsing...';
      const parsingResetCount = await resetParsingRecords();
      if (parsingResetCount > 0) {
        console.log(`Reset ${parsingResetCount} parsing records for recovery`);
      }
      await clearParsingInProgress();
    }

    // Process limited data on startup for fast loading (max 50 responses)
    loadingMessage = 'Processing data...';
    loadingProgress = 53;
    const processingResult = await processDataIncrementally(50, {
      onProgress: (message, progress) => {
        loadingMessage = message;
        // Map processing progress (0-100) to 53-60 range
        loadingProgress = 53 + Math.round(progress * 0.07);
      },
    });
    if (processingResult.parsedResponses > 0) {
      console.log(
        `Parsed ${processingResult.parsedResponses} raw responses (${processingResult.parsedRecords} records)`
      );
    }

    // Check if API keys exist
    loadingMessage = 'Checking settings...';
    loadingProgress = 60;
    await loadApiKeys();

    // Start background processing of remaining data (don't wait for it)
    const remainingCount = await getUnparsedRawDataCount();
    if (remainingCount > 0) {
      console.log(`Starting background processing of ${remainingCount} remaining responses...`);
      // Don't await - let it run in background
      processRemainingDataInBackground(100, (message, _remaining) => {
        console.log(`Background: ${message}`);
        // Could update a store here if we want to show background progress
      }).catch((error) => {
        console.error('Background processing failed:', error);
      });
    }

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

      // Load from display cache instead of all records
      loadingMessage = 'Loading dashboard...';
      loadingProgress = 85;

      try {
        // Try to load dashboard stats from display cache
        const dashboardStats = await getDisplayCache('dashboard_stats');
        if (dashboardStats) {
          // Display cache exists - instant load
          // Note: salesStore is now only used for filtered/paginated views
          // Dashboard components will read from display cache directly
          loadingProgress = 100;
        } else {
          // No display cache yet - will be computed on first sync
          loadingProgress = 100;
        }
      } catch (error) {
        console.error('Error loading display cache:', error);
        errorMessage.set('Failed to load dashboard data. Please try refreshing.');
      }

      isInitialized = true;
    }
  });

  let dashboardRefreshKey = $state(0);

  async function handleKeysChanged() {
    // Reload API keys after changes
    await loadApiKeys();
    const firstKeyInfo = apiKeys[0];
    if (firstKeyInfo) {
      const firstKey = await services.getApiKey(firstKeyInfo.id);
      if (firstKey) {
        settingsStore.setApiKey(firstKey);
      }
      // Note: salesStore is no longer used for full data loading
      // Dashboard components read from display cache directly
    } else {
      settingsStore.setApiKey(null);
      salesStore.clear();
    }

    // Process any dirty data (e.g., after data wipe)
    await processDataIfDirty();

    // Force Dashboard to refresh by incrementing key
    dashboardRefreshKey++;
  }

  async function handleRefreshData() {
    if (apiKeys.length === 0) {
      showApiKeyModal = true;
      return;
    }

    // Check if we're resuming from a paused state with pending work
    // Only treat as resume if modal is still open (user clicked resume button)
    // If modal was closed, treat as fresh start
    const isResuming = showProgressModal && refreshProgress.phase === 'cancelled' && hasPendingWork;

    // Reset cancellation flag for new sync
    isCancelling = false;

    // If not resuming, reset progress state to ensure fresh start
    if (!isResuming) {
      refreshProgress = {
        phase: 'discovery',
        message: 'Preparing...',
      };
    }

    // Create new abort controller for this sync
    abortController = new AbortController();

    // Show progress modal
    showProgressModal = true;
    isLoading.set(true);
    errorMessage.set(null);

    try {
      // Check if there's unparsed raw data (e.g., after wiping processed data)
      // If so, skip API calls and just reprocess the existing raw data
      const unparsedRawData = await getUnparsedRawData();

      if (unparsedRawData.length > 0 && !isResuming) {
        // We have raw data to reprocess - skip API sync and go straight to processing
        refreshProgress = {
          phase: 'aggregates',
          message: `Reprocessing ${unparsedRawData.length} raw API responses...`,
          totalTasks: 100,
          completedTasks: 0,
          recordsFetched: 0,
        };

        await processDataForcefully({
          onProgress: (message, progressPercent) => {
            if (!abortController?.signal.aborted) {
              refreshProgress = {
                phase: 'aggregates',
                message,
                totalTasks: 100,
                completedTasks: progressPercent,
                recordsFetched: 0,
              };
            }
          },
        });

        // Show complete status
        refreshProgress = {
          phase: 'complete',
          message: `Reprocessed ${unparsedRawData.length} raw responses!`,
          totalTasks: 100,
          completedTasks: 100,
          recordsFetched: 0,
        };
        hasPendingWork = false;
        return;
      }

      // No unparsed raw data - proceed with normal sync (fetch from API)
      // Create orchestrator with batch size of 100
      // Note: Each task makes HTTP requests. With HTTP/2, we can handle many concurrent
      // requests. Port exhaustion is not a concern as browsers manage connection pooling.
      // Failed requests will be retried up to 3 times with exponential backoff.
      const orchestrator = new SyncOrchestrator(services, syncTaskService, 100);

      // Use resumeSync if we have pending work, otherwise runSync for fresh start
      const syncFn = isResuming
        ? orchestrator.resumeSync.bind(orchestrator)
        : orchestrator.runSync.bind(orchestrator);

      const { totalRecords, totalTasks } = await syncFn(apiKeys, {
        onProgress: (progress) => {
          // Never allow overwriting cancelled state with any other phase
          // This prevents late-arriving progress updates from overwriting user-initiated cancellation
          if (refreshProgress.phase === 'cancelled' && progress.phase !== 'cancelled') {
            return;
          }
          // Don't overwrite cancelled state if cancellation has been initiated
          if (!isCancelling || progress.phase === 'cancelled') {
            refreshProgress = progress;
          }
        },
        getAbortSignal: () => abortController?.signal,
      });

      // Always run data recalculation, even if no new data was synced
      // When totalTasks === 0, the sync orchestrator skipped the aggregates phase,
      // so we need to run it here. When totalTasks > 0, the sync orchestrator already
      // ran it, but we run it again to ensure it's always fresh.
      if (!abortController?.signal.aborted) {
        refreshProgress = {
          phase: 'aggregates',
          message: 'Recalculating aggregates and display cache...',
          totalTasks,
          completedTasks: totalTasks,
          recordsFetched: totalRecords,
        };

        await processDataForcefully({
          onProgress: (message, progressPercent) => {
            if (!abortController?.signal.aborted) {
              refreshProgress = {
                phase: 'aggregates',
                message,
                // Use completedTasks/totalTasks to show aggregation progress (0-100 scale)
                totalTasks: 100,
                completedTasks: progressPercent,
                recordsFetched: totalRecords,
              };
            }
          },
        });
      }

      // Note: No need to reload all data into salesStore
      // Display cache will be updated by the sync orchestrator
      // Components read from display cache directly

      // Clear pending work flag on successful completion
      hasPendingWork = false;

      // Show complete status
      refreshProgress = {
        phase: 'complete',
        message:
          totalRecords > 0
            ? `Synced ${totalRecords.toLocaleString()} records!`
            : 'Recalculation complete!',
        totalTasks,
        completedTasks: totalTasks,
        recordsFetched: totalRecords,
      };
    } catch (err) {
      if (isCancellationError(err)) {
        // Note: No need to reload all data
        // Display cache will be updated when sync completes or resumes

        // Check if there's still pending work
        const orchestrator = new SyncOrchestrator(services, syncTaskService, 10);
        hasPendingWork = await orchestrator.hasPendingTasks();

        // Only update to cancelled if not already cancelled (to avoid overwriting user's immediate feedback)
        if (refreshProgress.phase !== 'cancelled') {
          refreshProgress = {
            phase: 'cancelled',
            message:
              refreshProgress.recordsFetched && refreshProgress.recordsFetched > 0
                ? `Sync paused. ${refreshProgress.recordsFetched.toLocaleString()} records loaded so far.`
                : 'Sync was paused.',
            completedTasks: refreshProgress.completedTasks,
            totalTasks: refreshProgress.totalTasks,
            recordsFetched: refreshProgress.recordsFetched,
            keySegments: refreshProgress.keySegments,
          };
        }
      } else {
        console.error('Error refreshing data:', err);
        const errorMsg = err instanceof Error ? err.message : 'Failed to fetch data';
        errorMessage.set(errorMsg);
        refreshProgress = {
          phase: 'error',
          message: 'Sync failed',
          completedTasks: refreshProgress.completedTasks,
          totalTasks: refreshProgress.totalTasks,
          recordsFetched: refreshProgress.recordsFetched,
          error: errorMsg,
        };
        hasPendingWork = false; // Clear on error
      }
    } finally {
      isLoading.set(false);
      abortController = null;
      // Reset cancellation flag when sync ends (whether cancelled or not)
      // We'll reset it at the start of the next sync anyway, but this ensures clean state
      isCancelling = false;
    }
  }

  function handleAbortSync() {
    if (abortController) {
      // Set cancellation flag to prevent progress updates from overwriting cancelled state
      isCancelling = true;
      // Immediately update UI to show cancelled state
      refreshProgress = {
        ...refreshProgress,
        phase: 'cancelled',
        message:
          refreshProgress.recordsFetched && refreshProgress.recordsFetched > 0
            ? `Sync paused. ${refreshProgress.recordsFetched.toLocaleString()} records loaded so far.`
            : 'Sync was paused.',
      };
      // Then abort the controller
      abortController.abort();
    }
  }

  async function closeProgressModal() {
    const wasPaused = refreshProgress.phase === 'cancelled';
    const wasCompleted = refreshProgress.phase === 'complete';
    showProgressModal = false;
    // Reset progress state when closing modal to prevent stale state
    // If phase is 'cancelled', reset to initial state so next sync starts fresh
    if (refreshProgress.phase === 'cancelled' || refreshProgress.phase === 'error') {
      refreshProgress = {
        phase: 'discovery',
        message: 'Preparing...',
      };
    }
    // Ensure isLoading is reset (should already be false from finally block, but be safe)
    isLoading.set(false);
    // Note: We keep hasPendingWork flag - tasks are persisted in DB
    // Next "Refresh Data" will discover them and offer to resume

    // If sync was paused or completed, refresh dashboard to show any new data
    if (wasPaused || wasCompleted) {
      // Process any dirty data (aggregates and display cache)
      await processDataIfDirty();
      // Force Dashboard to refresh
      dashboardRefreshKey++;
    }
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
      <header class="p-6 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <img
            src="/unicorn.svg"
            alt="Steam Sales Analyzer logo"
            class="w-12 h-12 unicorn-bounce"
          />
          <h1 class="text-3xl font-bold font-['Fredoka']">
            <span class="rainbow-text">Steam Sales Analyzer</span>
          </h1>
        </div>
        <nav class="flex items-center gap-4" aria-label="Main navigation">
          <button
            class="btn-rainbow flex items-center gap-2"
            onclick={handleRefreshData}
            disabled={$isLoading}
            aria-label={$isLoading ? 'Loading data...' : 'Refresh sales data from Steam'}
            aria-busy={$isLoading}
          >
            {#if $isLoading}
              <span class="inline-block animate-spin" aria-hidden="true">&#10226;</span>
            {:else}
              <span aria-hidden="true">&#8635;</span>
            {/if}
            Refresh Data
          </button>
          <button
            class="btn-primary flex items-center gap-2"
            onclick={openSettings}
            aria-label="Open settings and manage API keys"
          >
            <span aria-hidden="true">&#9881;</span>
            Settings
          </button>
        </nav>
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
      <main class="p-6" aria-label="Sales dashboard">
        {#key dashboardRefreshKey}
          <Dashboard />
        {/key}
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
