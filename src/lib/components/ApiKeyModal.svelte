<script lang="ts">
  interface Props {
    onSave: (key: string) => void;
    onClose: () => void;
    onWipeData?: () => Promise<void>;
    currentKey?: string | null;
    hasDataToWipe?: boolean;
  }

  let { onSave, onClose, onWipeData, currentKey = null, hasDataToWipe = false }: Props = $props();
  
  // Use $derived to reactively track prop, then sync to editable state
  let initialKey = $derived(currentKey ?? '');
  let apiKey = $state('');
  let isValidating = $state(false);
  let isValidated = $state(false);
  let error = $state<string | null>(null);
  let showWipeConfirm = $state(false);
  let isWiping = $state(false);
  let wipeSuccess = $state(false);
  let showHelpSection = $state(false);
  
  // Sync with prop changes
  $effect(() => {
    apiKey = initialKey;
  });

  // Reset validation when key changes
  $effect(() => {
    apiKey;
    isValidated = false;
  });

  async function handleVerify() {
    if (!apiKey.trim()) {
      error = 'Please enter your API key';
      return;
    }

    isValidating = true;
    error = null;

    try {
      // Basic format validation
      if (apiKey.length < 20) {
        throw new Error('Hmm, that key looks a bit short. Double-check and try again!');
      }
      
      // Make a test API call to validate the key
      let response;
      try {
        response = await fetch(`/api/steam/IPartnerFinancialsService/GetChangedDatesForPartner/v1?key=${encodeURIComponent(apiKey.trim())}&highwatermark=0`);
      } catch {
        throw new Error('Our unicorn couldn\'t reach Steam. Check your internet connection and try again!');
      }
      
      // Get the response text first to check what we received
      const responseText = await response.text();
      
      // Check if Steam returned HTML instead of JSON (usually means auth failed)
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('Steam says "neigh" to this key. Make sure it has Financial API access!');
      }
      
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          throw new Error('Steam says "neigh" to this key. Make sure it has Financial API access!');
        }
        throw new Error('Steam\'s servers are being shy. Try again in a moment!');
      }
      
      // Try to parse as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error('Steam sent us something unexpected. The key might not have the right permissions!');
      }
      
      // Check if response indicates an error
      if (data.response === undefined) {
        throw new Error('This key doesn\'t have the magic touch. Verify it has Financial API Group access!');
      }
      
      // Validation successful!
      isValidated = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong. Our unicorn is confused!';
      isValidated = false;
    } finally {
      isValidating = false;
    }
  }

  function handleSave() {
    onSave(apiKey.trim());
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (isValidated) {
      handleSave();
    } else {
      handleVerify();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      if (currentKey) {
        onClose();
      }
    }
  }

  async function handleWipeData() {
    if (!showWipeConfirm) {
      showWipeConfirm = true;
      return;
    }
    
    isWiping = true;
    try {
      await onWipeData?.();
      // Show success confirmation
      wipeSuccess = true;
      showWipeConfirm = false;
      // Clear the API key field since it was wiped
      apiKey = '';
      isValidated = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to wipe data';
      showWipeConfirm = false;
    } finally {
      isWiping = false;
    }
  }

  function cancelWipe() {
    showWipeConfirm = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
  onclick={handleBackdropClick}
>
  <div class="rainbow-border max-w-lg w-full">
    <div class="modal-inner p-8">
    <div class="flex items-center gap-4 mb-6">
      <div class="text-4xl">&#129412;</div> <!-- Unicorn emoji -->
      <div>
        <h2 class="text-2xl font-bold font-['Fredoka'] rainbow-text">
          {currentKey ? 'Update API Key' : 'Welcome, Developer!'}
        </h2>
        <p class="text-purple-200 text-sm mt-1">
          {currentKey ? 'Enter a new Financial API key' : 'Enter your Steam Financial API key to get started'}
        </p>
      </div>
    </div>

    <form onsubmit={handleSubmit}>
      <div class="mb-6">
        <label for="apiKey" class="block text-sm font-semibold mb-2 text-purple-200">
          Financial API Key
        </label>
        <input
          id="apiKey"
          type="password"
          bind:value={apiKey}
          class="input-magic w-full"
          placeholder="Enter your Steam Financial API key..."
          disabled={isValidating}
        />
      </div>

      {#if error}
        <div class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
          {error}
        </div>
      {/if}

      {#if isValidated}
        <div class="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm flex items-center gap-2">
          <span>&#10004;</span>
          Validation complete! Your API key is working.
        </div>
      {/if}

      <div class="flex gap-3">
        <button
          type="submit"
          class="btn-rainbow flex-1 flex items-center justify-center gap-2"
          disabled={isValidating}
        >
          {#if isValidating}
            <span class="inline-block animate-spin">&#10226;</span>
            Validating...
          {:else if isValidated}
            <span>&#10024;</span>
            Save & Continue
          {:else}
            <span>&#128273;</span>
            Verify
          {/if}
        </button>
        
        {#if currentKey}
          <button
            type="button"
            class="btn-primary"
            onclick={onClose}
          >
            Cancel
          </button>
        {/if}
      </div>
    </form>

    <div class="mt-6 pt-6 border-t border-white/10">
      <button
        type="button"
        class="w-full flex items-center justify-between text-sm font-semibold text-purple-200 hover:text-purple-100 transition-colors"
        onclick={() => showHelpSection = !showHelpSection}
      >
        <span>How to get your API key</span>
        <span class="text-lg transition-transform duration-200" class:rotate-180={showHelpSection}>
          &#9660;
        </span>
      </button>
      
      {#if showHelpSection}
        <ol class="text-xs text-purple-300 space-y-2 list-decimal list-inside mt-3">
          <li>Log in to the <a href="https://partner.steamgames.com/pub/groups/" target="_blank" rel="noopener noreferrer" class="text-purple-400 hover:text-purple-300 underline">Steam Partner Portal</a></li>
          <li>Navigate to Users & Permissions &gt; Manage Groups</li>
          <li>Create a new Financial API Group</li>
          <li>Click Manage Web API Key</li>
          <li>Enable financial reporting</li>
        </ol>
      {/if}
    </div>

    <!-- Wipe Success Message -->
    {#if wipeSuccess}
      <div class="mt-6 pt-6 border-t border-green-500/30">
        <div class="bg-green-500/20 border border-green-500/50 rounded-lg p-4 text-center">
          <div class="text-4xl mb-2">&#10024;</div>
          <p class="text-green-200 font-semibold mb-1">All Data Wiped!</p>
          <p class="text-xs text-green-300">
            Your local data has been cleared. Enter your API key above to start fresh.
          </p>
        </div>
      </div>
    <!-- Danger Zone - Only show when there's data to wipe -->
    {:else if hasDataToWipe && onWipeData}
      <div class="mt-6 pt-6 border-t border-red-500/30">
        <h3 class="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2">
          <span>&#9888;</span>
          Danger Zone
        </h3>
        
        {#if showWipeConfirm}
          <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
            <p class="text-sm text-red-200 mb-3">
              This will permanently delete:
            </p>
            <ul class="text-xs text-red-300 mb-4 space-y-1">
              <li>&#8226; All cached sales data</li>
              <li>&#8226; Sync progress (highwatermark)</li>
              <li>&#8226; Your saved API key</li>
            </ul>
            <p class="text-xs text-red-400 mb-4">
              You'll need to re-enter your API key and perform a full sync.
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                onclick={handleWipeData}
                disabled={isWiping}
              >
                {#if isWiping}
                  <span class="inline-block animate-spin mr-2">&#10226;</span>
                  Wiping...
                {:else}
                  Yes, Wipe Everything
                {/if}
              </button>
              <button
                type="button"
                class="px-4 py-2 bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg font-semibold text-sm transition-colors"
                onclick={cancelWipe}
                disabled={isWiping}
              >
                Cancel
              </button>
            </div>
          </div>
        {:else}
          <p class="text-xs text-purple-400 mb-3">
            Reset the app to its initial state. This will delete all local data.
          </p>
          <button
            type="button"
            class="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded-lg text-sm transition-colors"
            onclick={handleWipeData}
          >
            <span class="mr-2">&#128465;</span>
            Wipe All Data
          </button>
        {/if}
      </div>
    {/if}
    </div>
  </div>
</div>
