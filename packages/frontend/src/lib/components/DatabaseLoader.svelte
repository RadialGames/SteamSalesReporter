<script lang="ts">
  import { loadDatabase } from '$lib/db/sqlite-client';
  import { databaseLoaded, databaseError } from '$lib/stores/sqlite-stores';
  import Modal from './ui/Modal.svelte';

  let loading = $state(false);
  let error = $state<string | null>(null);
  let dragActive = $state(false);

  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      await loadDatabaseFile(file);
    }
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;

    const file = event.dataTransfer?.files[0];
    if (file && file.name.endsWith('.db')) {
      await loadDatabaseFile(file);
    } else {
      error = 'Please select a .db file';
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dragActive = true;
  }

  function handleDragLeave() {
    dragActive = false;
  }

  async function loadDatabaseFile(file: File) {
    loading = true;
    error = null;
    databaseError.set(null);

    try {
      await loadDatabase(file);
      databaseLoaded.set(true);
      // Close modal by emitting close event (handled by parent)
      if (onclose) onclose();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load database file';
      error = errorMessage;
      databaseError.set(errorMessage);
    } finally {
      loading = false;
    }
  }

  interface Props {
    open: boolean;
    onclose?: () => void;
  }

  let { open, onclose }: Props = $props();
</script>

<Modal open={open} onclose={onclose} title="Load Database File">
  <div>
    <p class="text-purple-200 mb-6">
      Load the SQLite database file created by the <code class="bg-white/10 px-2 py-1 rounded">steam-financial-cli</code> tool.
      This file is typically named <code class="bg-white/10 px-2 py-1 rounded">steam-financial.db</code>.
    </p>

    {#if error}
      <div class="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200">
        <strong>Error:</strong> {error}
      </div>
    {/if}

    <div
      role="region"
      aria-label="Drop zone for database file"
      class="border-2 border-dashed rounded-lg p-8 text-center transition-colors {dragActive ? 'border-purple-500 bg-purple-500/10' : 'border-white/20'}"
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      {#if loading}
        <div class="flex flex-col items-center gap-4">
          <div class="inline-block animate-spin text-4xl">&#8635;</div>
          <p class="text-purple-200">Loading database...</p>
        </div>
      {:else}
        <div class="flex flex-col items-center gap-4">
          <div class="text-6xl">&#128190;</div>
          <div>
            <p class="text-lg font-semibold mb-2">Drop your database file here</p>
            <p class="text-sm text-purple-300 mb-4">or</p>
            <label class="btn-primary cursor-pointer inline-block">
              <input
                type="file"
                accept=".db"
                onchange={handleFileSelect}
                class="hidden"
              />
              Browse Files
            </label>
          </div>
          <p class="text-xs text-purple-400 mt-4">
            Select the <code class="bg-white/10 px-1 py-0.5 rounded">steam-financial.db</code> file
            created by the CLI tool
          </p>
        </div>
      {/if}
    </div>

    <div class="mt-6 p-4 bg-white/5 rounded-lg">
      <p class="text-sm text-purple-300 mb-2">
        <strong>Don't have a database file yet?</strong>
      </p>
      <ol class="text-sm text-purple-200 list-decimal list-inside space-y-1">
        <li>Download and install <code class="bg-white/10 px-1 py-0.5 rounded">steam-financial-cli</code> from GitHub</li>
        <li>Run <code class="bg-white/10 px-1 py-0.5 rounded">steam-financial init YOUR_API_KEY</code> to set up your API key</li>
        <li>Run <code class="bg-white/10 px-1 py-0.5 rounded">steam-financial fetch</code> to download your sales data</li>
        <li>Load the generated <code class="bg-white/10 px-1 py-0.5 rounded">steam-financial.db</code> file here</li>
      </ol>
    </div>
  </div>
</Modal>
