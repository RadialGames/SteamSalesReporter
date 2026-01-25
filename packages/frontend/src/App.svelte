<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import SetupWizard from '$lib/components/SetupWizard.svelte';
  import SettingsMenu from '$lib/components/SettingsMenu.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import { databaseLoaded, databaseError, setDatabaseLoaded } from '$lib/stores/sqlite-stores';
  import { statsStore, lookupsStore } from '$lib/stores/sqlite-stores';
  import { cliStatusStore, cliOperationsStore } from '$lib/stores/cli-stores';
  import type { CliStatus } from '$lib/api/cli-client';

  // Access nested stores directly
  const fetchingStore = cliOperationsStore.fetching;
  const errorStore = cliOperationsStore.error;

  let showSetupWizard = $state(false);
  let showSettingsMenu = $state(false);
  let isInitialized = $state(false);
  let stars: { x: number; y: number; delay: number }[] = $state([]);

  onMount(async () => {
    // Generate random stars for background
    stars = Array.from({ length: 50 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2,
    }));

    // Check CLI status
    try {
      console.log('[App] Starting initialization...');
      await cliStatusStore.load();
      console.log('[App] CLI status loaded');
      
      // Get the current store value
      const status = get(cliStatusStore);
      console.log('[App] Status:', status);

      if (status?.databaseExists) {
        console.log('[App] Database exists - API key is stored in DB, skipping setup wizard');
        // Database exists, which means API key is already configured
        // Do NOT show setup wizard - user doesn't need to enter API key
        showSetupWizard = false;
        
        // Mark database as loaded so Dashboard can render
        setDatabaseLoaded(true);
        
        // Load initial data from existing database
        statsStore.load().catch(e => console.warn('[App] Failed to load stats:', e));
        lookupsStore.loadAll().catch(e => console.warn('[App] Failed to load lookups:', e));
        
        // Automatically fetch latest data in background to keep it up-to-date
        // Only fetch if database exists and is valid
        cliOperationsStore.fetchData()
          .then(() => {
            console.log('[App] Data fetch completed, reloading stores with fresh data...');
            // Reload stores with fresh data after fetch completes
            statsStore.load().catch(e => console.warn('[App] Failed to reload stats:', e));
            lookupsStore.loadAll().catch(e => console.warn('[App] Failed to reload lookups:', e));
          })
          .catch((e) => {
            // Check if error is due to missing/invalid database
            const errorMsg = e instanceof Error ? e.message : String(e);
            if (errorMsg.includes('Database is missing') || errorMsg.includes('not usable') || errorMsg.includes('no such table')) {
              console.log('[App] Database is invalid or missing, will show setup wizard on next check');
              // Database was deleted or is invalid, reset state and reload status
              setDatabaseLoaded(false);
              cliStatusStore.load();
            } else {
              console.error('[App] Failed to auto-fetch data:', e);
              // Don't show error to user - this is a background update
              // User can still use existing data from database
            }
          });
      } else if (status && !status.installed) {
        console.log('[App] CLI not installed, showing setup');
        showSetupWizard = true;
      } else if (status && !status.databaseExists) {
        console.log('[App] Database does not exist, showing setup');
        showSetupWizard = true;
      } else {
        console.log('[App] No status available, showing setup');
        showSetupWizard = true;
      }
    } catch (e) {
      console.error('[App] Failed to check CLI status:', e);
      // Only show setup wizard if we can't determine status
      // Don't show it if database exists but status check failed
      const status = get(cliStatusStore);
      if (!status?.databaseExists) {
        showSetupWizard = true;
        // Keep databaseLoaded as false since database doesn't exist
      } else {
        // Database exists, don't show setup wizard even if status check failed
        showSetupWizard = false;
        // Mark database as loaded so Dashboard can render
        setDatabaseLoaded(true);
      }
    } finally {
      console.log('[App] Setting isInitialized = true');
      isInitialized = true;
    }
  });

  // Note: Data loading is now handled in onMount and handleSetupComplete
  // to avoid race conditions with the setup wizard

  function handleSetupComplete() {
    showSetupWizard = false;
    // Mark database as loaded now that setup is complete
    setDatabaseLoaded(true);
    // Load initial data after setup completes
    statsStore.load().catch(e => console.warn('[App] Failed to load stats:', e));
    lookupsStore.loadAll().catch(e => console.warn('[App] Failed to load lookups:', e));
  }

  function toggleSettingsMenu() {
    showSettingsMenu = !showSettingsMenu;
  }

  function closeSettingsMenu() {
    showSettingsMenu = false;
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
          <UnicornLoader message="Initializing..." />
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
          {#if $fetchingStore}
            <div class="flex items-center gap-2 text-purple-300">
              <span class="inline-block animate-spin" aria-hidden="true">&#8635;</span>
              <span>Updating data...</span>
            </div>
          {/if}
          <div class="relative">
            <button
              class="btn-primary flex items-center gap-2"
              onclick={toggleSettingsMenu}
              aria-label="Open settings"
            >
              <span aria-hidden="true">&#9881;</span>
              Settings
            </button>
            <SettingsMenu open={showSettingsMenu} onclose={closeSettingsMenu} />
          </div>
        </nav>
      </header>

      <!-- Error message -->
      {#if $databaseError || $errorStore}
        <div
          class="mx-6 mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 select-text cursor-text"
        >
          <strong>Oops!</strong>{' '}
          <span class="break-all">{$databaseError || $errorStore}</span>
        </div>
      {/if}

      <!-- Dashboard -->
      {#if $databaseLoaded}
        <main class="p-6" aria-label="Sales dashboard">
          <Dashboard />
        </main>
      {:else}
        <main class="p-6" aria-label="Sales dashboard">
          <div class="glass-card p-12 text-center">
            <div class="text-8xl mb-4 unicorn-bounce inline-block">&#129412;</div>
            <h2 class="text-2xl font-bold font-['Fredoka'] mb-2 rainbow-text">
              Welcome to Steam Sales Analyzer!
            </h2>
            <p class="text-purple-200 mb-6 max-w-md mx-auto">
              Configure your API key and download your sales data to get started.
            </p>
            {#if !$databaseLoaded}
              <div class="text-purple-300 text-sm">
                Use the Settings menu to configure your API key.
              </div>
            {/if}
          </div>
        </main>
      {/if}
    {/if}
  </div>

  <!-- Setup Wizard Modal (auto-shown on first launch when database doesn't exist) -->
  {#if showSetupWizard}
    <SetupWizard open={showSetupWizard} oncomplete={handleSetupComplete} />
  {/if}
</div>
