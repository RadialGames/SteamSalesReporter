<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { cliStatusStore, cliOperationsStore } from '$lib/stores/cli-stores';
  import * as queryClient from '$lib/api/query-client';
  import Modal from './ui/Modal.svelte';
  import UnicornLoader from './UnicornLoader.svelte';
  import FetchProgressModal from './FetchProgressModal.svelte';

  // Access nested stores directly
  const downloadingStore = cliOperationsStore.downloading;
  const initializingStore = cliOperationsStore.initializing;
  const fetchingStore = cliOperationsStore.fetching;

  const VERIFY_INTERVAL_MS = 1500;
  const VERIFY_MAX_ATTEMPTS = 60; // ~90 seconds

  let apiKey = $state('');
  let step = $state<'check' | 'download' | 'init' | 'fetch' | 'verifying' | 'complete'>('check');
  let error = $state<string | null>(null);
  let isVerifying = $state(false);
  let showFetchProgress = $state(false);

  // Check status when component mounts or when modal opens
  async function checkStatus() {
    console.log('[SetupWizard] Checking status...');
    step = 'check'; // Show loading while checking
    await cliStatusStore.load();
    const status = get(cliStatusStore);
    console.log('[SetupWizard] Status:', status);
    
    if (!status) {
      console.log('[SetupWizard] No status, showing check step');
      step = 'check';
      return;
    }

    if (!status.installed) {
      console.log('[SetupWizard] CLI not installed, showing download step');
      step = 'download';
    } else if (!status.databaseExists) {
      console.log('[SetupWizard] Database does not exist, showing init step');
      // Check if we need to initialize (no database means no API key configured)
      step = 'init';
    } else {
      console.log('[SetupWizard] Database exists - API key is stored in DB, closing wizard');
      // Database exists, which means API key is already configured and stored in the database
      // Close immediately without showing any step
      if (oncomplete) {
        console.log('[SetupWizard] Calling oncomplete to close modal');
        // Close synchronously to prevent any step from showing
        oncomplete();
      }
    }
  }

  onMount(() => {
    checkStatus();
  });

  async function handleDownload() {
    error = null;
    try {
      await cliOperationsStore.downloadCli();
      step = 'init';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to download CLI tool';
    }
  }

  async function handleInit() {
    if (!apiKey.trim()) {
      error = 'Please enter your API key';
      return;
    }

    error = null;
    try {
      await cliOperationsStore.initCli(apiKey.trim());
      step = 'fetch';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to initialize CLI';
    }
  }

  async function handleFetch() {
    error = null;
    showFetchProgress = true;
    try {
      await cliOperationsStore.fetchData();
      // Progress modal will show completion, wait for user to close it
      // The modal's onclose will be handled by handleFetchProgressClose
    } catch (e) {
      showFetchProgress = false;
      error = e instanceof Error ? e.message : 'Failed to fetch data';
      step = 'fetch'; // Back to fetch step so user can retry
    }
  }

  function handleFetchProgressClose() {
    showFetchProgress = false;
    // Proceed to verification after fetch completes
    step = 'verifying';
    isVerifying = true;
    waitForDatabaseRead()
      .then(() => {
        step = 'complete';
        if (oncomplete) oncomplete();
      })
      .catch((e) => {
        error = e instanceof Error ? e.message : 'Failed to verify database';
        step = 'fetch';
      })
      .finally(() => {
        isVerifying = false;
      });
  }

  /** Poll getStats until the database reads successfully. */
  async function waitForDatabaseRead(): Promise<void> {
    for (let attempt = 0; attempt < VERIFY_MAX_ATTEMPTS; attempt++) {
      try {
        await queryClient.getStats({});
        return;
      } catch {
        await new Promise((r) => setTimeout(r, VERIFY_INTERVAL_MS));
      }
    }
    throw new Error(
      'Database did not become ready in time. Try relaunching the app.'
    );
  }

  interface Props {
    open: boolean;
    oncomplete?: () => void;
  }

  let { open, oncomplete }: Props = $props();
  let isChecking = $state(false);

  // Auto-close if database exists when modal opens
  $effect(() => {
    if (open) {
      console.log('[SetupWizard] Modal opened, immediately checking status...');
      isChecking = true;
      // Immediately check status when modal opens
      checkStatus().finally(() => {
        isChecking = false;
      });
    } else {
      // Reset state when modal closes
      step = 'check';
      error = null;
      isChecking = false;
      isVerifying = false;
      showFetchProgress = false;
    }
  });
</script>

<Modal open={open} title="Setup Steam Sales Analyzer">
  {#if isChecking}
    <div class="text-center py-12">
      <UnicornLoader message="Checking setup..." />
    </div>
  {:else}
  <div class="space-y-6">
    {#if step === 'check'}
      <div class="text-center">
        <UnicornLoader message="Checking setup..." />
      </div>
    {:else if step === 'download'}
      <div>
        <h3 class="text-lg font-semibold mb-4">Download CLI Tool</h3>
        <p class="text-purple-200 mb-4">
          The Steam Financial CLI tool needs to be downloaded and installed.
        </p>
        {#if error}
          <div class="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
            {error}
          </div>
        {/if}
        <button
          class="btn-rainbow w-full"
          onclick={handleDownload}
          disabled={$downloadingStore}
        >
          {#if $downloadingStore}
            Downloading...
          {:else}
            Download CLI Tool
          {/if}
        </button>
      </div>
    {:else if step === 'init'}
      <div>
        <h3 class="text-lg font-semibold mb-4">Configure API Key</h3>
        <p class="text-purple-200 mb-4">
          Enter your Steam Financial API key from the{' '}
          <a
            href="https://partner.steamgames.com//pub/groups/"
            target="_blank"
            rel="noopener noreferrer"
            class="text-purple-400 hover:text-purple-300 underline"
          >
            Steamworks Partner portal
          </a>
          .
        </p>
        {#if error}
          <div class="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
            {error}
          </div>
        {/if}
        <input
          type="password"
          bind:value={apiKey}
          placeholder="Enter your API key"
          class="input-magic w-full mb-4"
          onkeydown={(e) => {
            if (e.key === 'Enter') handleInit();
          }}
        />
        <button
          class="btn-rainbow w-full"
          onclick={handleInit}
          disabled={$initializingStore || !apiKey.trim()}
        >
          {#if $initializingStore}
            Initializing...
          {:else}
            Save API Key
          {/if}
        </button>
      </div>
    {:else if step === 'fetch'}
      <div>
        <h3 class="text-lg font-semibold mb-4">Fetch Sales Data</h3>
        <p class="text-purple-200 mb-4">
          Now we'll download your sales data from Steam. This may take a few minutes.
        </p>
        {#if error}
          <div class="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
            {error}
          </div>
        {/if}
        <button
          class="btn-rainbow w-full"
          onclick={handleFetch}
          disabled={$fetchingStore || isVerifying}
        >
          {#if $fetchingStore}
            Fetching data...
          {:else if isVerifying}
            Verifying...
          {:else}
            Fetch Sales Data
          {/if}
        </button>
      </div>
    {:else if step === 'verifying'}
      <div class="text-center py-12">
        <UnicornLoader message="Verifying database..." />
        <p class="text-purple-300 mt-4 text-sm">
          Waiting for the database to be ready...
        </p>
      </div>
    {:else if step === 'complete'}
      <div class="text-center">
        <div class="text-6xl mb-4">&#10004;</div>
        <h3 class="text-lg font-semibold mb-2">Setup Complete!</h3>
        <p class="text-purple-200 mb-4">
          Your sales data has been loaded. You can now explore your analytics!
        </p>
        <button class="btn-rainbow w-full" onclick={() => oncomplete?.()}>
          Get Started
        </button>
      </div>
    {/if}
  </div>
  {/if}
</Modal>

<!-- Fetch Progress Modal (shown during fetch operation) -->
<FetchProgressModal open={showFetchProgress} onclose={handleFetchProgressClose} />
