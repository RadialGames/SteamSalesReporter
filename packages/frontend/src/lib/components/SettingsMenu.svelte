<script lang="ts">
  import { cliStatusStore } from '$lib/stores/cli-stores';
  import * as cliApi from '$lib/api/cli-client';

  interface Props {
    open: boolean;
    onclose?: () => void;
  }

  let { open, onclose }: Props = $props();
  let showDeleteConfirm = $state(false);
  let isDeleting = $state(false);
  let menuRef: HTMLDivElement | null = $state(null);

  // Close menu when clicking outside
  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      // Don't close if we're in the middle of deleting
      if (!isDeleting) {
        onclose?.();
      }
    }
  }

  $effect(() => {
    if (open) {
      // Add click listener when menu opens
      setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
    } else {
      // Remove click listener when menu closes
      document.removeEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  });

  async function handleDeleteDatabase(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    
    if (!showDeleteConfirm) {
      showDeleteConfirm = true;
      return;
    }

    isDeleting = true;
    try {
      console.log('[SettingsMenu] Starting database deletion...');
      await cliApi.deleteDatabase();
      console.log('[SettingsMenu] Database deleted, reloading status...');
      await cliStatusStore.load();
      console.log('[SettingsMenu] Status reloaded, reloading page...');
      showDeleteConfirm = false;
      onclose?.();
      window.location.reload();
    } catch (e) {
      console.error('[SettingsMenu] Failed to delete database:', e);
      alert(e instanceof Error ? e.message : 'Failed to delete database');
      isDeleting = false;
    }
  }

  function handleCancelDelete(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    showDeleteConfirm = false;
  }
</script>

{#if open}
  <div
    bind:this={menuRef}
    class="absolute right-0 top-full mt-2 w-64 bg-gradient-to-br from-purple-900/95 via-blue-900/95 to-indigo-900/95 backdrop-blur-xl rounded-lg shadow-xl border border-white/20 z-50"
  >
    <div class="p-2">
      {#if !showDeleteConfirm}
        <button
          type="button"
          class="w-full text-left px-4 py-3 rounded-lg text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors flex items-center gap-2"
          onclick={handleDeleteDatabase}
        >
          <span class="text-lg">&#128465;</span>
          <span>Delete Database</span>
        </button>
      {:else}
        <div class="p-4 space-y-3">
          <p class="text-purple-200 text-sm">
            Are you sure you want to delete the database? This action cannot be undone.
          </p>
          <div class="flex gap-2">
        <button
          type="button"
          class="flex-1 px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors disabled:opacity-50"
          onclick={handleDeleteDatabase}
          disabled={isDeleting}
        >
              {#if isDeleting}
                Deleting...
              {:else}
                Delete
              {/if}
            </button>
            <button
              type="button"
              class="flex-1 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors"
              onclick={handleCancelDelete}
              disabled={isDeleting}
            >
              Cancel
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
