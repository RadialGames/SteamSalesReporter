<script lang="ts">
  import { onMount } from 'svelte';
  
  interface Props {
    progress: {
      phase: 'init' | 'dates' | 'sales' | 'saving' | 'complete' | 'error' | 'cancelled';
      message: string;
      current: number;
      total: number;
      currentDate?: string;
      recordsFetched?: number;
      error?: string;
    };
    onCancel?: () => void;
    onAbort?: () => void;
  }

  let { progress, onCancel, onAbort }: Props = $props();
  
  let isAborting = $state(false);
  let salesStartTime = $state<number | null>(null);
  let currentTime = $state(Date.now());
  
  // Update current time every second for ETA calculation
  onMount(() => {
    const interval = setInterval(() => {
      currentTime = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });
  
  // Track when sales phase starts
  $effect(() => {
    if (progress.phase === 'sales' && progress.current > 0 && salesStartTime === null) {
      salesStartTime = Date.now();
    }
    // Reset when sync completes or is cancelled
    if (progress.phase === 'complete' || progress.phase === 'cancelled' || progress.phase === 'error') {
      salesStartTime = null;
    }
  });
  
  function handleAbort() {
    isAborting = true;
    onAbort?.();
  }

  let percentage = $derived(
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  );
  
  // Calculate estimated time remaining
  let estimatedTimeRemaining = $derived(() => {
    if (!salesStartTime || progress.current === 0 || progress.phase !== 'sales') {
      return null;
    }
    
    const elapsed = currentTime - salesStartTime;
    const avgTimePerItem = elapsed / progress.current;
    const remaining = progress.total - progress.current;
    const estimatedMs = avgTimePerItem * remaining;
    
    // Don't show if less than 5 seconds
    if (estimatedMs < 5000) return null;
    
    const seconds = Math.floor(estimatedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `~${hours}h ${minutes % 60}m remaining`;
    } else if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s remaining`;
    } else {
      return `~${seconds}s remaining`;
    }
  });

  let phaseEmoji = $derived({
    init: '&#128300;', // Magnifying glass
    dates: '&#128197;', // Calendar
    sales: '&#128176;', // Money bag
    saving: '&#128190;', // Floppy disk
    complete: '&#10024;', // Sparkles
    error: '&#128557;', // Crying face
    cancelled: '&#9995;' // Raised hand / stop
  }[progress.phase] || '&#129412;');

  let phaseColor = $derived({
    init: 'from-purple-500 to-pink-500',
    dates: 'from-blue-500 to-purple-500',
    sales: 'from-green-500 to-blue-500',
    saving: 'from-yellow-500 to-green-500',
    complete: 'from-pink-500 to-purple-500',
    error: 'from-red-500 to-orange-500',
    cancelled: 'from-orange-500 to-yellow-500'
  }[progress.phase] || 'from-purple-500 to-pink-500');
  
  let canCancel = $derived(
    progress.phase !== 'complete' && 
    progress.phase !== 'error' && 
    progress.phase !== 'cancelled' &&
    progress.phase !== 'saving'
  );
  
  // Check if we're already up to date (0 dates to process)
  let isAlreadyUpToDate = $derived(
    progress.phase === 'complete' && progress.total === 0
  );
</script>

<div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
  <div class="rainbow-border max-w-md w-full">
    <div class="modal-inner p-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <div class="text-4xl unicorn-bounce">
          {#if isAlreadyUpToDate}
            &#129412;
          {:else}
            {@html phaseEmoji}
          {/if}
        </div>
        <div>
          <h2 class="text-xl font-bold font-['Fredoka'] rainbow-text">
            {#if isAlreadyUpToDate}
              You're All Up to Date!
            {:else if progress.phase === 'complete'}
              Sync Complete!
            {:else if progress.phase === 'error'}
              Oops! Something went wrong
            {:else if progress.phase === 'cancelled'}
              Sync Cancelled
            {:else}
              Syncing Sales Data
            {/if}
          </h2>
          <p class="text-purple-200 text-sm mt-1">
            {#if isAlreadyUpToDate}
              Nothing new from Steam. Your data is fresh!
            {:else}
              {progress.message}
            {/if}
          </p>
        </div>
      </div>

      {#if isAlreadyUpToDate}
        <!-- Already Up to Date - Show friendly message instead of progress -->
        <div class="text-center py-6">
          <div class="text-6xl mb-4">&#127881;</div>
          <p class="text-purple-300 text-sm">
            We checked Steam and there's no new sales data since your last sync.
          </p>
          <p class="text-purple-400 text-xs mt-2">
            Check back later for updates!
          </p>
        </div>
      {:else}
        <!-- Progress Bar -->
        <div class="mb-4">
          <div class="flex justify-between text-sm text-purple-300 mb-2">
            <span>Progress</span>
            <span>{percentage}%</span>
          </div>
          <div class="h-4 bg-purple-900/50 rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r {phaseColor} transition-all duration-300 ease-out rounded-full relative"
              style="width: {percentage}%"
            >
              {#if progress.phase !== 'complete' && progress.phase !== 'error'}
                <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
              {/if}
            </div>
          </div>
          {#if estimatedTimeRemaining()}
            <div class="text-xs text-purple-400 text-right mt-1">
              {estimatedTimeRemaining()}
            </div>
          {/if}
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-3 mb-6">
          <div class="glass-card p-3 text-center">
            <div class="text-2xl font-bold text-purple-200">
              {progress.current.toLocaleString()}/{progress.total.toLocaleString()}
            </div>
            <div class="text-xs text-purple-400">
              {progress.phase === 'dates' ? 'Dates checked' : 'Dates processed'}
            </div>
          </div>
          <div class="glass-card p-3 text-center">
            <div class="text-2xl font-bold text-purple-200">
              {(progress.recordsFetched ?? 0).toLocaleString()}
            </div>
            <div class="text-xs text-purple-400">Records fetched</div>
          </div>
        </div>
      {/if}


      <!-- Error Message -->
      {#if progress.error}
        <div class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
          {progress.error}
        </div>
      {/if}

      <!-- Cancelled Message -->
      {#if progress.phase === 'cancelled'}
        <div class="mb-4 p-3 bg-orange-500/20 border border-orange-500/50 rounded-lg text-orange-200 text-sm">
          Any processed data was saved, but will be re-fetched on the next sync.
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex gap-3">
        {#if isAlreadyUpToDate}
          <button
            type="button"
            class="btn-rainbow flex-1 flex items-center justify-center gap-2"
            onclick={onCancel}
          >
            <span>&#129412;</span>
            Awesome!
          </button>
        {:else if progress.phase === 'complete'}
          <button
            type="button"
            class="btn-rainbow flex-1 flex items-center justify-center gap-2"
            onclick={onCancel}
          >
            <span>&#10024;</span>
            Continue
          </button>
        {:else if progress.phase === 'error'}
          <button
            type="button"
            class="btn-primary flex-1"
            onclick={onCancel}
          >
            Close
          </button>
        {:else if progress.phase === 'cancelled'}
          <button
            type="button"
            class="btn-primary flex-1"
            onclick={onCancel}
          >
            Close
          </button>
        {:else}
          <!-- Active sync - show cancel button -->
          <div class="flex-1 flex flex-col items-center justify-center gap-1 text-purple-300">
            <div class="flex items-center gap-2">
              <span class="inline-block animate-spin">&#10226;</span>
              Syncing...
            </div>
            {#if progress.currentDate}
              <div class="text-xs text-purple-400 font-mono">
                {progress.currentDate}
              </div>
            {/if}
          </div>
          {#if canCancel && onAbort}
            <button
              type="button"
              class="px-4 py-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-orange-300 rounded-lg font-semibold transition-colors disabled:opacity-50"
              onclick={handleAbort}
              disabled={isAborting}
            >
              {#if isAborting}
                Cancelling...
              {:else}
                Cancel
              {/if}
            </button>
          {/if}
        {/if}
      </div>

      <!-- Info while loading -->
      {#if progress.phase !== 'complete' && progress.phase !== 'error' && progress.phase !== 'cancelled'}
        <div class="mt-6 pt-4 border-t border-white/10 text-center">
          <p class="text-xs text-purple-400 italic">
            {#if progress.phase === 'dates' && progress.total === 0}
              &#128161; Using highwatermark to check for new data since last sync...
            {:else}
              &#128161; Tip: After this sync completes, the highwatermark will be saved.
              Future syncs will only fetch new data!
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>
