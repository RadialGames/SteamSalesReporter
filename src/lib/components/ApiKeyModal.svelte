<script lang="ts">
  import { services } from '$lib/services';
  import type { ApiKeyInfo } from '$lib/services/types';
  import { startWindowDrag } from '$lib/utils/tauri';
  import Modal from '$lib/components/ui/Modal.svelte';
  import UnicornLoader from '$lib/components/UnicornLoader.svelte';

  interface Props {
    onclose: () => void;
    onkeyschanged?: () => void;
  }

  let { onclose, onkeyschanged }: Props = $props();

  // State
  let apiKeys = $state<ApiKeyInfo[]>([]);
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  // Add new key form
  let showAddForm = $state(false);
  let newKeyValue = $state('');
  let newKeyName = $state('');
  let isValidating = $state(false);
  let isValidated = $state(false);
  let validationError = $state<string | null>(null);

  // Edit name state
  let editingKeyId = $state<string | null>(null);
  let editingName = $state('');

  // Delete/Wipe confirmation
  let confirmAction = $state<
    { type: 'delete'; keyId: string } | { type: 'wipeAll' } | { type: 'wipeProcessed' } | null
  >(null);
  let isProcessing = $state(false);

  // Wipe progress modal
  let showWipeProgress = $state(false);
  let wipeProgressMessage = $state('');
  let wipeProgressPercent = $state(0);
  let wipeKeyName = $state('');

  // Help dialog
  let showHelpDialog = $state(false);

  // Load API keys on mount
  $effect(() => {
    loadApiKeys();
  });

  async function loadApiKeys() {
    isLoading = true;
    error = null;
    try {
      apiKeys = await services.getAllApiKeys();
    } catch (err) {
      console.error('Error loading API keys:', err);
      error = err instanceof Error ? err.message : 'Failed to load API keys';
    } finally {
      isLoading = false;
    }
  }

  // Reset validation when key changes
  $effect(() => {
    newKeyValue;
    isValidated = false;
    validationError = null;
  });

  async function handleVerifyKey() {
    if (!newKeyValue.trim()) {
      validationError = 'Please enter your API key';
      return;
    }

    isValidating = true;
    validationError = null;

    try {
      // Basic format validation
      if (newKeyValue.length < 20) {
        throw new Error('Hmm, that key looks a bit short. Double-check and try again!');
      }

      // Make a test API call to validate the key
      let response;
      try {
        response = await fetch(
          `/api/steam/IPartnerFinancialsService/GetChangedDatesForPartner/v1?key=${encodeURIComponent(newKeyValue.trim())}&highwatermark=0`
        );
      } catch {
        throw new Error(
          "Our unicorn couldn't reach Steam. Check your internet connection and try again!"
        );
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
        throw new Error("Steam's servers are being shy. Try again in a moment!");
      }

      // Try to parse as JSON
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          'Steam sent us something unexpected. The key might not have the right permissions!'
        );
      }

      // Check if response indicates an error
      if (data.response === undefined) {
        throw new Error(
          "This key doesn't have the magic touch. Verify it has Financial API Group access!"
        );
      }

      // Validation successful!
      isValidated = true;
    } catch (err) {
      console.error('Error validating API key:', err);
      validationError =
        err instanceof Error ? err.message : 'Something went wrong. Our unicorn is confused!';
      isValidated = false;
    } finally {
      isValidating = false;
    }
  }

  async function handleAddKey() {
    if (!isValidated) {
      await handleVerifyKey();
      if (!isValidated) return;
    }

    isProcessing = true;
    try {
      // Check for duplicate keys
      // Note: use index-based loop to avoid Svelte 5 $state proxy iteration issues
      const trimmedKey = newKeyValue.trim();
      const keysLength = apiKeys.length;
      for (let i = 0; i < keysLength; i++) {
        const existingKeyInfo = apiKeys[i];
        const existingKey = await services.getApiKey(existingKeyInfo.id);
        if (existingKey === trimmedKey) {
          validationError = `This API key is already added${existingKeyInfo.displayName ? ` as "${existingKeyInfo.displayName}"` : ''}.`;
          isProcessing = false;
          return;
        }
      }

      await services.addApiKey(trimmedKey, newKeyName.trim() || undefined);
      await loadApiKeys();
      // Reset form
      showAddForm = false;
      newKeyValue = '';
      newKeyName = '';
      isValidated = false;
      onkeyschanged?.();
    } catch (err) {
      console.error('Error adding API key:', err);
      validationError = err instanceof Error ? err.message : 'Failed to add API key';
    } finally {
      isProcessing = false;
    }
  }

  function startEditName(key: ApiKeyInfo) {
    editingKeyId = key.id;
    editingName = key.displayName || '';
  }

  async function saveEditName() {
    if (!editingKeyId) return;

    try {
      await services.updateApiKeyName(editingKeyId, editingName.trim());
      await loadApiKeys();
      editingKeyId = null;
      editingName = '';
    } catch (err) {
      console.error('Error updating API key name:', err);
      error = err instanceof Error ? err.message : 'Failed to update name';
    }
  }

  function cancelEdit() {
    editingKeyId = null;
    editingName = '';
  }

  async function handleWipeAllData() {
    // Close confirmation and show progress modal
    confirmAction = null;
    showWipeProgress = true;
    wipeProgressMessage = 'Preparing to wipe all data...';
    wipeProgressPercent = 0;
    wipeKeyName = 'All Data';
    isProcessing = true;

    try {
      await services.clearAllData((message, progress) => {
        wipeProgressMessage = message;
        wipeProgressPercent = progress;
      });

      // Brief pause to show completion
      wipeProgressMessage = 'Complete!';
      wipeProgressPercent = 100;
      await new Promise((resolve) => setTimeout(resolve, 500));

      showWipeProgress = false;
      onkeyschanged?.();
    } catch (err) {
      console.error('Error wiping all data:', err);
      showWipeProgress = false;
      error = err instanceof Error ? err.message : 'Failed to wipe all data';
    } finally {
      isProcessing = false;
    }
  }

  async function handleWipeProcessedData() {
    // Close confirmation and show progress modal
    confirmAction = null;
    showWipeProgress = true;
    wipeProgressMessage = 'Preparing to wipe processed data...';
    wipeProgressPercent = 0;
    wipeKeyName = 'Processed Data';
    isProcessing = true;

    try {
      await services.clearProcessedData((message, progress) => {
        wipeProgressMessage = message;
        wipeProgressPercent = progress;
      });

      // Brief pause to show completion
      wipeProgressMessage = 'Complete!';
      wipeProgressPercent = 100;
      await new Promise((resolve) => setTimeout(resolve, 500));

      showWipeProgress = false;
      onkeyschanged?.();
    } catch (err) {
      console.error('Error wiping processed data:', err);
      showWipeProgress = false;
      error = err instanceof Error ? err.message : 'Failed to wipe processed data';
    } finally {
      isProcessing = false;
    }
  }

  async function handleDeleteKey(keyId: string) {
    // Find the key name for display
    const keyInfo = apiKeys.find((k) => k.id === keyId);
    wipeKeyName = keyInfo?.displayName || `Key ...${keyInfo?.keyHash || ''}`;

    // Close confirmation and show progress modal
    confirmAction = null;
    showWipeProgress = true;
    wipeProgressMessage = 'Preparing to delete...';
    wipeProgressPercent = 0;
    isProcessing = true;

    try {
      // First wipe the data with progress
      await services.clearDataForKey(keyId, (message, progress) => {
        wipeProgressMessage = message;
        // Scale progress to 0-90% (leave room for key deletion)
        wipeProgressPercent = Math.round(progress * 0.9);
      });

      // Then delete the key
      wipeProgressMessage = 'Removing API key...';
      wipeProgressPercent = 95;
      await services.deleteApiKey(keyId);
      await loadApiKeys();

      // Brief pause to show completion
      wipeProgressMessage = 'Complete!';
      wipeProgressPercent = 100;
      await new Promise((resolve) => setTimeout(resolve, 500));

      showWipeProgress = false;
      onkeyschanged?.();
    } catch (err) {
      console.error('Error deleting API key:', err);
      showWipeProgress = false;
      error = err instanceof Error ? err.message : 'Failed to delete API key';
    } finally {
      isProcessing = false;
    }
  }

  function getKeyDisplayName(key: ApiKeyInfo): string {
    return key.displayName || `Key ...${key.keyHash}`;
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
  onmousedown={startWindowDrag}
>
  <div class="rainbow-border max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
    <div class="modal-inner p-6 flex flex-col h-full overflow-hidden">
      <!-- Header (draggable) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center justify-between mb-6 cursor-grab active:cursor-grabbing"
        onmousedown={startWindowDrag}
      >
        <div class="flex items-center gap-4">
          <div class="text-4xl">&#128273;</div>
          <div>
            <h2 class="text-2xl font-bold font-['Fredoka'] rainbow-text">API Key Management</h2>
            <p class="text-purple-200 text-sm mt-1">Manage your Steam Financial API keys</p>
          </div>
        </div>
        <button
          type="button"
          class="text-purple-300 hover:text-white transition-colors text-2xl"
          onclick={onclose}
        >
          &#10005;
        </button>
      </div>

      {#if error}
        <div
          class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm select-text cursor-text"
        >
          <span class="break-all">{error}</span>
        </div>
      {/if}

      <!-- Keys List -->
      <div class="flex-1 overflow-y-auto min-h-0 mb-4">
        {#if isLoading}
          <div class="text-center py-8 text-purple-300">
            <span class="inline-block animate-spin text-2xl mr-2">&#10226;</span>
            Loading keys...
          </div>
        {:else if apiKeys.length === 0 && !showAddForm}
          <div class="text-center py-8">
            <div class="text-6xl mb-4">&#129412;</div>
            <p class="text-purple-200 mb-2">No API keys configured yet!</p>
            <p class="text-purple-400 text-sm">
              Add your first Steam Financial API key to get started.
            </p>
          </div>
        {:else}
          <div class="space-y-3">
            {#each apiKeys as key (key.id)}
              <div class="glass-card p-4">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex-1 min-w-0">
                    {#if editingKeyId === key.id}
                      <!-- Edit mode -->
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          bind:value={editingName}
                          class="input-magic text-sm py-1 px-2 flex-1"
                          placeholder="Enter display name..."
                          onkeydown={(e) => e.key === 'Enter' && saveEditName()}
                        />
                        <button
                          type="button"
                          class="text-green-400 hover:text-green-300 text-lg"
                          onclick={saveEditName}
                          title="Save"
                        >
                          &#10004;
                        </button>
                        <button
                          type="button"
                          class="text-red-400 hover:text-red-300 text-lg"
                          onclick={cancelEdit}
                          title="Cancel"
                        >
                          &#10006;
                        </button>
                      </div>
                    {:else}
                      <!-- Display mode -->
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-white">
                          {getKeyDisplayName(key)}
                        </span>
                        <button
                          type="button"
                          class="text-purple-400 hover:text-purple-300 text-sm"
                          onclick={() => startEditName(key)}
                          title="Edit name"
                        >
                          &#9998;
                        </button>
                      </div>
                    {/if}
                    <div class="text-xs text-purple-400 mt-1">
                      <span class="font-mono">...{key.keyHash}</span>
                      <span class="mx-2">|</span>
                      Added {formatDate(key.createdAt)}
                    </div>
                  </div>

                  <!-- Actions -->
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded text-xs transition-colors"
                      onclick={() => (confirmAction = { type: 'delete', keyId: key.id })}
                      title="Delete this key"
                    >
                      &#10006;
                    </button>
                  </div>
                </div>

                <!-- Confirmation Dialog -->
                {#if confirmAction && confirmAction.type === 'delete' && confirmAction.keyId === key.id}
                  <div class="mt-4 pt-4 border-t border-white/10">
                    <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                      <p class="text-sm text-red-200 mb-3">
                        <strong>Delete this API key?</strong>
                      </p>
                      <p class="text-xs text-red-300 mb-4">
                        This will delete the key and all its associated sales data. This action
                        cannot be undone.
                      </p>
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                          onclick={() => handleDeleteKey(key.id!)}
                          disabled={isProcessing}
                        >
                          {#if isProcessing}
                            <span class="inline-block animate-spin mr-2">&#10226;</span>
                            Processing...
                          {:else}
                            Yes, Delete Key
                          {/if}
                        </button>
                        <button
                          type="button"
                          class="px-4 py-2 bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg font-semibold text-sm transition-colors"
                          onclick={() => (confirmAction = null)}
                          disabled={isProcessing}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Add New Key Form -->
      {#if showAddForm}
        <div class="glass-card p-4 mb-4">
          <h3 class="font-semibold text-white mb-4 flex items-center gap-2">
            <span>&#10133;</span>
            Add New API Key
          </h3>

          <div class="space-y-4">
            <div>
              <label for="newKeyName" class="block text-sm font-medium text-purple-200 mb-1">
                Display Name (optional)
              </label>
              <input
                id="newKeyName"
                type="text"
                bind:value={newKeyName}
                class="input-magic w-full text-sm"
                placeholder="e.g., My Game Studio"
              />
            </div>

            <div>
              <label for="newKeyValue" class="block text-sm font-medium text-purple-200 mb-1">
                API Key
              </label>
              <input
                id="newKeyValue"
                type="password"
                bind:value={newKeyValue}
                class="input-magic w-full text-sm"
                placeholder="Enter your Steam Financial API key..."
                disabled={isValidating}
              />
            </div>

            {#if validationError}
              <div
                class="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm select-text cursor-text"
              >
                <span class="break-all">{validationError}</span>
              </div>
            {/if}

            {#if isValidated}
              <div
                class="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm flex items-center gap-2"
              >
                <span>&#10004;</span>
                Key validated successfully!
              </div>
            {/if}

            <div class="flex gap-3">
              <button
                type="button"
                class="btn-rainbow flex-1 flex items-center justify-center gap-2"
                onclick={handleAddKey}
                disabled={isValidating || isProcessing}
              >
                {#if isValidating}
                  <span class="inline-block animate-spin">&#10226;</span>
                  Validating...
                {:else if isProcessing}
                  <span class="inline-block animate-spin">&#10226;</span>
                  Adding...
                {:else if isValidated}
                  <span>&#10024;</span>
                  Add Key
                {:else}
                  <span>&#128273;</span>
                  Verify & Add
                {/if}
              </button>
              <button
                type="button"
                class="btn-primary"
                onclick={() => {
                  showAddForm = false;
                  newKeyValue = '';
                  newKeyName = '';
                  isValidated = false;
                  validationError = null;
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Add Key Button - Small plus button -->
        <div class="flex justify-end mb-4">
          <button
            type="button"
            class="w-10 h-10 flex items-center justify-center bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 text-purple-300 hover:text-purple-200 rounded-lg transition-colors"
            onclick={() => (showAddForm = true)}
            title="Add New API Key"
          >
            <span class="text-xl">&#10133;</span>
          </button>
        </div>
      {/if}

      <!-- Footer Actions -->
      <div class="pt-4 border-t border-white/10">
        <!-- Confirmation Dialogs (shown when active) -->
        {#if confirmAction?.type === 'wipeProcessed'}
          <div class="bg-amber-500/20 border border-amber-500/50 rounded-lg p-4 mb-4">
            <p class="text-sm text-amber-200 mb-3">
              <strong>Wipe processed data?</strong>
            </p>
            <p class="text-xs text-amber-300 mb-4">
              This will clear all parsed records, aggregates, and display cache. Raw API responses
              will be kept and can be reprocessed by clicking "Refresh Data".
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                onclick={handleWipeProcessedData}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="inline-block animate-spin mr-2">&#10226;</span>
                  Processing...
                {:else}
                  Yes, Wipe Processed Data
                {/if}
              </button>
              <button
                type="button"
                class="px-4 py-2 bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg font-semibold text-sm transition-colors"
                onclick={() => (confirmAction = null)}
                disabled={isProcessing}
              >
                Cancel
              </button>
            </div>
          </div>
        {:else if confirmAction?.type === 'wipeAll'}
          <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-4">
            <p class="text-sm text-red-200 mb-3">
              <strong>Wipe ALL data?</strong>
            </p>
            <p class="text-xs text-red-300 mb-4">
              This will delete all sales records, aggregates, and display cache from all API keys.
              API keys themselves will remain. This action cannot be undone.
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                onclick={handleWipeAllData}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="inline-block animate-spin mr-2">&#10226;</span>
                  Processing...
                {:else}
                  Yes, Wipe All Data
                {/if}
              </button>
              <button
                type="button"
                class="px-4 py-2 bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg font-semibold text-sm transition-colors"
                onclick={() => (confirmAction = null)}
                disabled={isProcessing}
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}

        <!-- Action Buttons Row -->
        <div class="flex items-center justify-between">
          <!-- Help Button - Question mark icon -->
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center text-purple-400 hover:text-purple-300 transition-colors"
            onclick={() => (showHelpDialog = true)}
            title="How to get your API key"
          >
            <span class="text-xl">&#63;</span>
          </button>

          <!-- Wipe Buttons - Side by side -->
          <div class="flex gap-2">
            <button
              type="button"
              class="px-4 py-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 rounded-lg font-semibold text-sm transition-colors"
              onclick={() => (confirmAction = { type: 'wipeProcessed' })}
              title="Wipe processed data for reprocessing"
              disabled={confirmAction !== null}
            >
              <span class="text-lg">&#128260;</span>
            </button>
            <button
              type="button"
              class="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded-lg font-semibold text-sm transition-colors"
              onclick={() => (confirmAction = { type: 'wipeAll' })}
              title="Wipe all data from all API keys"
              disabled={confirmAction !== null}
            >
              <span class="text-lg">&#128465;</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Wipe Progress Modal -->
<Modal
  open={showWipeProgress}
  title="Wiping Data"
  subtitle={wipeKeyName}
  icon="&#128465;"
  maxWidth="sm"
  draggable={true}
  closeOnBackdrop={false}
>
  <div class="flex flex-col items-center py-4">
    <UnicornLoader message={wipeProgressMessage} size="small" />

    <!-- Progress bar -->
    <div class="mt-6 w-full">
      <div class="h-2 bg-white/10 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 transition-all duration-300"
          style="width: {wipeProgressPercent}%"
        ></div>
      </div>
      <div class="text-center mt-2 text-sm text-purple-300">
        {wipeProgressPercent}%
      </div>
    </div>
  </div>
</Modal>

<!-- Help Dialog -->
<Modal
  open={showHelpDialog}
  title="How to get your API key"
  icon="&#63;"
  maxWidth="md"
  draggable={true}
  onclose={() => (showHelpDialog = false)}
>
  <div class="py-4">
    <ol class="text-sm text-purple-300 space-y-3 list-decimal list-inside">
      <li>
        Log in to the{' '}
        <a
          href="https://partner.steamgames.com/pub/groups/"
          target="_blank"
          rel="noopener noreferrer"
          class="text-purple-400 hover:text-purple-300 underline"
          >Steam Partner Portal</a
        >
      </li>
      <li>Navigate to Users & Permissions &gt; Manage Groups</li>
      <li>Create a new Financial API Group</li>
      <li>Click Manage Web API Key</li>
      <li>Enable financial reporting</li>
    </ol>
  </div>
</Modal>
