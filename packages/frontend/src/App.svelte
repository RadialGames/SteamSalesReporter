<script lang="ts">
  import { onMount } from 'svelte';
  import Dashboard from '$lib/components/Dashboard.svelte';
  import SettingsMenu from '$lib/components/SettingsMenu.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';
  import DownloadProgressModal from '$lib/components/DownloadProgressModal.svelte';
  import FetchProgressModal from '$lib/components/FetchProgressModal.svelte';
  import { setDatabaseLoaded } from '$lib/stores/sqlite-stores';
  import { statsStore, lookupsStore } from '$lib/stores/sqlite-stores';
  import { cliStatusStore, cliOperationsStore } from '$lib/stores/cli-stores';
  import * as cliApi from '$lib/api/cli-client';
  import type { VersionCheck } from '$lib/api/cli-client';

  // Initialization states - strictly linear flow
  type InitStep = 
    | 'checking'      // Checking CLI version on GitHub and locally
    | 'need-download' // CLI not installed or needs update
    | 'downloading'   // Downloading CLI
    | 'need-init'     // Need API key to initialize database
    | 'initializing'  // Running init command
    | 'fetching'      // Running fetch command
    | 'ready'         // All done, show dashboard
    | 'error';        // Something went wrong

  let step = $state<InitStep>('checking');
  let error = $state<string | null>(null);
  let versionInfo = $state<VersionCheck | null>(null);
  let apiKey = $state('');
  let showSettingsMenu = $state(false);
  let showDownloadProgress = $state(false);
  let showFetchProgress = $state(false);
  let stars: { x: number; y: number; delay: number }[] = $state([]);

  // Access nested stores
  const fetchingStore = cliOperationsStore.fetching;

  // Compare semantic versions - returns true if current < latest (update available)
  function compareVersions(current: string | null, latest: string): boolean {
    if (!current) return true; // No current version means update needed
    
    const parseVersion = (v: string): number[] => {
      // Extract version numbers, handling formats like "1.0.0", "v1.0.0", "steam-financial 1.0.0"
      const match = v.match(/(\d+(?:\.\d+)*)/);
      if (!match) return [0];
      return match[1].split('.').map(n => parseInt(n, 10) || 0);
    };

    const currentParts = parseVersion(current);
    const latestParts = parseVersion(latest);

    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const c = currentParts[i] || 0;
      const l = latestParts[i] || 0;
      if (c < l) return true;  // Update available
      if (c > l) return false; // Current is newer (shouldn't happen normally)
    }
    return false; // Versions are equal
  }

  onMount(async () => {
    // Generate random stars for background
    stars = Array.from({ length: 50 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 2,
    }));

    await runInitialization();
  });

  async function runInitialization() {
    step = 'checking';
    error = null;

    try {
      // Step 1: Check local CLI status (fast, no network)
      console.log('[App] Step 1: Checking local CLI status...');
      const status = await cliApi.getCliStatus();
      console.log('[App] Local status:', status);

      // Step 2: Get latest version from GitHub (with timeout)
      console.log('[App] Step 2: Fetching latest version from GitHub...');
      let latestVersion: string | null = null;
      try {
        latestVersion = await Promise.race([
          cliApi.getLatestGithubVersion(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('GitHub request timed out')), 10000)
          )
        ]);
        console.log('[App] Latest GitHub version:', latestVersion);
      } catch (e) {
        console.warn('[App] Failed to fetch GitHub version:', e);
        // Continue anyway - if CLI is installed and working, we can skip the update
      }

      // Build version info for UI
      versionInfo = {
        currentVersion: status.version,
        latestVersion: latestVersion || 'unknown',
        updateAvailable: latestVersion ? compareVersions(status.version, latestVersion) : false,
      };

      // Step 3: Check if CLI needs download/update
      if (!status.installed || status.version === null) {
        console.log('[App] CLI not installed or version is null, need download');
        step = 'need-download';
        return;
      }

      // Step 4: Check if update is available (optional)
      if (latestVersion && compareVersions(status.version, latestVersion)) {
        console.log('[App] Update available:', status.version, '->', latestVersion);
        step = 'need-download';
        return;
      }

      // Step 5: Check if database exists (API key configured)
      if (!status.databaseExists) {
        console.log('[App] Database does not exist, need API key');
        step = 'need-init';
        return;
      }

      // Step 6: Run fetch to get latest data
      await runFetch();

    } catch (e) {
      console.error('[App] Initialization error:', e);
      error = e instanceof Error ? e.message : 'Failed to initialize';
      step = 'error';
    }
  }

  async function handleDownload() {
    step = 'downloading';
    error = null;
    showDownloadProgress = true;

    try {
      const version = versionInfo?.latestVersion;
      console.log('[App] Downloading CLI version:', version);
      await cliOperationsStore.downloadCli(version);
      showDownloadProgress = false;

      // Verify download succeeded
      const status = await cliApi.getCliStatus();
      if (status.version === null) {
        throw new Error('Downloaded CLI but version check failed. The file may be corrupted.');
      }

      console.log('[App] CLI downloaded successfully, version:', status.version);

      // Continue initialization - check if we need API key
      if (!status.databaseExists) {
        step = 'need-init';
      } else {
        // Database exists, run fetch
        await runFetch();
      }
    } catch (e) {
      showDownloadProgress = false;
      console.error('[App] Download error:', e);
      error = e instanceof Error ? e.message : 'Failed to download CLI';
      step = 'need-download'; // Back to download step so user can retry
    }
  }

  async function handleInit() {
    if (!apiKey.trim()) {
      error = 'Please enter your API key';
      return;
    }

    step = 'initializing';
    error = null;

    try {
      console.log('[App] Initializing with API key...');
      await cliOperationsStore.initCli(apiKey.trim());
      console.log('[App] Init complete, starting fetch...');
      
      // Continue to fetch
      await runFetch();
    } catch (e) {
      console.error('[App] Init error:', e);
      error = e instanceof Error ? e.message : 'Failed to initialize';
      step = 'need-init'; // Back to init step so user can retry
    }
  }

  async function runFetch() {
    step = 'fetching';
    error = null;
    showFetchProgress = true;

    try {
      console.log('[App] Fetching latest data...');
      await cliOperationsStore.fetchData();
      showFetchProgress = false;
      
      console.log('[App] Fetch complete, loading data...');
      
      // Mark database as ready and load data
      setDatabaseLoaded(true);
      await Promise.all([
        statsStore.load(),
        lookupsStore.loadAll()
      ]);

      console.log('[App] Initialization complete!');
      step = 'ready';
    } catch (e) {
      showFetchProgress = false;
      console.error('[App] Fetch error:', e);
      error = e instanceof Error ? e.message : 'Failed to fetch data';
      step = 'error';
    }
  }

  function handleFetchProgressClose() {
    showFetchProgress = false;
    // If we're still fetching, the fetch will complete and update step
  }

  function handleDownloadProgressClose() {
    showDownloadProgress = false;
  }

  function toggleSettingsMenu() {
    showSettingsMenu = !showSettingsMenu;
  }

  function closeSettingsMenu() {
    showSettingsMenu = false;
  }

  function retry() {
    error = null;
    runInitialization();
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
    {#if step === 'ready'}
      <!-- Full app with header and dashboard -->
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

      <main class="p-6" aria-label="Sales dashboard">
        <Dashboard />
      </main>
    {:else}
      <!-- Initialization flow - centered card -->
      <div class="flex items-center justify-center min-h-screen p-6">
        <div class="glass-card p-8 max-w-md w-full text-center">
          <img
            src="/unicorn.svg"
            alt="Steam Sales Analyzer logo"
            class="w-16 h-16 mx-auto mb-4 unicorn-bounce"
          />
          <h1 class="text-2xl font-bold font-['Fredoka'] mb-6">
            <span class="rainbow-text">Steam Sales Analyzer</span>
          </h1>

          {#if step === 'checking'}
            <UnicornLoader message="Checking for updates..." />

          {:else if step === 'need-download'}
            <div class="space-y-4">
              <h2 class="text-lg font-semibold">Download CLI Tool</h2>
              <p class="text-purple-200 text-sm">
                {#if versionInfo?.currentVersion}
                  A new version is available: <code class="text-purple-300">v{versionInfo.latestVersion}</code>
                  <br /><span class="text-purple-400 text-xs">Current: v{versionInfo.currentVersion}</span>
                {:else}
                  The Steam Financial CLI tool needs to be installed.
                  <br /><span class="text-purple-400 text-xs">Version: {versionInfo?.latestVersion ? `v${versionInfo.latestVersion}` : 'latest'}</span>
                {/if}
              </p>
              {#if error}
                <div class="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                  {error}
                </div>
              {/if}
              <button class="btn-rainbow w-full" onclick={handleDownload}>
                Download CLI Tool
              </button>
            </div>

          {:else if step === 'downloading'}
            <UnicornLoader message="Downloading CLI tool..." />

          {:else if step === 'need-init'}
            <div class="space-y-4">
              <h2 class="text-lg font-semibold">Configure API Key</h2>
              <p class="text-purple-200 text-sm">
                Enter your Steam Financial API key from the{' '}
                <a
                  href="https://partner.steamgames.com//pub/groups/"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-purple-400 hover:text-purple-300 underline"
                >
                  Steamworks Partner portal
                </a>.
              </p>
              {#if error}
                <div class="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                  {error}
                </div>
              {/if}
              <input
                type="password"
                bind:value={apiKey}
                placeholder="Enter your API key"
                class="input-magic w-full"
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleInit();
                }}
              />
              <button
                class="btn-rainbow w-full"
                onclick={handleInit}
                disabled={!apiKey.trim()}
              >
                Save API Key
              </button>
            </div>

          {:else if step === 'initializing'}
            <UnicornLoader message="Saving API key..." />

          {:else if step === 'fetching'}
            <UnicornLoader message="Fetching sales data..." />

          {:else if step === 'error'}
            <div class="space-y-4">
              <div class="text-6xl mb-2">&#128557;</div>
              <h2 class="text-lg font-semibold text-red-300">Something went wrong</h2>
              {#if error}
                <div class="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm text-left">
                  {error}
                </div>
              {/if}
              <button class="btn-rainbow w-full" onclick={retry}>
                Try Again
              </button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Download Progress Modal -->
  <DownloadProgressModal
    open={showDownloadProgress}
    version={versionInfo?.latestVersion}
    onclose={handleDownloadProgressClose}
  />

  <!-- Fetch Progress Modal -->
  <FetchProgressModal open={showFetchProgress} onclose={handleFetchProgressClose} />
</div>
