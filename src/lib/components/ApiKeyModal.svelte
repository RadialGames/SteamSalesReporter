<script lang="ts">
  import { services } from '$lib/services';
  import type { ApiKeyInfo } from '$lib/services/types';

  interface Props {
    onClose: () => void;
    onKeysChanged?: () => void;
  }

  let { onClose, onKeysChanged }: Props = $props();
  
  // Check if running in Tauri
  const isTauri = '__TAURI_INTERNALS__' in window;
  
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
  let confirmAction = $state<{ type: 'delete' | 'wipe'; keyId: string } | null>(null);
  let isProcessing = $state(false);
  
  // Help section
  let showHelpSection = $state(false);

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
        response = await fetch(`/api/steam/IPartnerFinancialsService/GetChangedDatesForPartner/v1?key=${encodeURIComponent(newKeyValue.trim())}&highwatermark=0`);
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
      console.error('Error validating API key:', err);
      validationError = err instanceof Error ? err.message : 'Something went wrong. Our unicorn is confused!';
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
      onKeysChanged?.();
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

  async function handleWipeData(keyId: string) {
    isProcessing = true;
    try {
      await services.clearDataForKey(keyId);
      confirmAction = null;
      onKeysChanged?.();
    } catch (err) {
      console.error('Error wiping data:', err);
      error = err instanceof Error ? err.message : 'Failed to wipe data';
    } finally {
      isProcessing = false;
    }
  }

  async function handleDeleteKey(keyId: string) {
    isProcessing = true;
    try {
      // First wipe the data
      await services.clearDataForKey(keyId);
      // Then delete the key
      await services.deleteApiKey(keyId);
      await loadApiKeys();
      confirmAction = null;
      onKeysChanged?.();
    } catch (err) {
      console.error('Error deleting API key:', err);
      error = err instanceof Error ? err.message : 'Failed to delete API key';
    } finally {
      isProcessing = false;
    }
  }

  async function startWindowDrag(event: MouseEvent) {
    // Only start drag if clicking directly on the backdrop or header (not on interactive elements)
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, select, .glass-card')) {
      return;
    }
    
    if (isTauri) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
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
  class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
  onmousedown={startWindowDrag}
>
  <div class="rainbow-border max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
    <div class="modal-inner p-6 flex flex-col h-full overflow-hidden">
      <!-- Header (draggable) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flex items-center justify-between mb-6 cursor-grab active:cursor-grabbing" onmousedown={startWindowDrag}>
        <div class="flex items-center gap-4">
          <div class="text-4xl">&#128273;</div>
          <div>
            <h2 class="text-2xl font-bold font-['Fredoka'] rainbow-text">
              API Key Management
            </h2>
            <p class="text-purple-200 text-sm mt-1">
              Manage your Steam Financial API keys
            </p>
          </div>
        </div>
        <button
          type="button"
          class="text-purple-300 hover:text-white transition-colors text-2xl"
          onclick={onClose}
        >
          &#10005;
        </button>
      </div>

      {#if error}
        <div class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm select-text cursor-text">
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
            <p class="text-purple-400 text-sm">Add your first Steam Financial API key to get started.</p>
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
                      class="px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-orange-300 rounded text-xs transition-colors"
                      onclick={() => confirmAction = { type: 'wipe', keyId: key.id }}
                      title="Wipe data from this key"
                    >
                      &#128465; Wipe Data
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 rounded text-xs transition-colors"
                      onclick={() => confirmAction = { type: 'delete', keyId: key.id }}
                      title="Delete this key"
                    >
                      &#10006;
                    </button>
                  </div>
                </div>

                <!-- Confirmation Dialog -->
                {#if confirmAction?.keyId === key.id}
                  <div class="mt-4 pt-4 border-t border-white/10">
                    <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4">
                      {#if confirmAction.type === 'wipe'}
                        <p class="text-sm text-red-200 mb-3">
                          <strong>Wipe all data</strong> from this API key?
                        </p>
                        <p class="text-xs text-red-300 mb-4">
                          This will delete all sales records associated with this key. The key itself will remain.
                        </p>
                      {:else}
                        <p class="text-sm text-red-200 mb-3">
                          <strong>Delete this API key?</strong>
                        </p>
                        <p class="text-xs text-red-300 mb-4">
                          This will delete the key and all its associated sales data. This action cannot be undone.
                        </p>
                      {/if}
                      <div class="flex gap-2">
                        <button
                          type="button"
                          class="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
                          onclick={() => confirmAction?.type === 'wipe' 
                            ? handleWipeData(key.id) 
                            : handleDeleteKey(key.id)}
                          disabled={isProcessing}
                        >
                          {#if isProcessing}
                            <span class="inline-block animate-spin mr-2">&#10226;</span>
                            Processing...
                          {:else}
                            {confirmAction.type === 'wipe' ? 'Yes, Wipe Data' : 'Yes, Delete Key'}
                          {/if}
                        </button>
                        <button
                          type="button"
                          class="px-4 py-2 bg-white/10 hover:bg-white/20 text-purple-200 rounded-lg font-semibold text-sm transition-colors"
                          onclick={() => confirmAction = null}
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
              <div class="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm select-text cursor-text">
                <span class="break-all">{validationError}</span>
              </div>
            {/if}

            {#if isValidated}
              <div class="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm flex items-center gap-2">
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
                onclick={() => { showAddForm = false; newKeyValue = ''; newKeyName = ''; isValidated = false; validationError = null; }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {:else}
        <!-- Add Key Button -->
        <button
          type="button"
          class="w-full py-3 border-2 border-dashed border-purple-500/50 hover:border-purple-400 rounded-lg text-purple-300 hover:text-purple-200 transition-colors flex items-center justify-center gap-2 mb-4"
          onclick={() => showAddForm = true}
        >
          <span class="text-xl">&#10133;</span>
          Add New API Key
        </button>
      {/if}

      <!-- Help Section -->
      <div class="pt-4 border-t border-white/10">
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
    </div>
  </div>
</div>

