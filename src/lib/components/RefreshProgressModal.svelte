<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { FetchProgress } from '$lib/services/types';
  
  interface Props {
    progress: FetchProgress & { phase: FetchProgress['phase'] | 'cancelled' };
    onCancel?: () => void;
    onAbort?: () => void;
    onResume?: () => void;
  }

  let { progress, onCancel, onAbort, onResume }: Props = $props();
  
  // Check if running in Tauri
  const isTauri = '__TAURI_INTERNALS__' in window;
  
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
  
  let isAborting = $state(false);
  
  // Time estimation configuration
  const ROLLING_WINDOW_SIZE = 15; // Track last N completion times
  const SMOOTHING_FACTOR = 0.25; // How much to weight new estimates (0-1, lower = smoother)
  const MIN_SAMPLES_FOR_ESTIMATE = 3; // Minimum items before showing estimate
  const TIME_DECAY_PER_SECOND = 1000; // How much to subtract from estimate per second of real time
  
  // Time estimation state
  let itemCompletionTimes = $state<number[]>([]); // Timestamps when items completed
  let lastItemCount = $state(0); // Track previous count to detect new completions
  let smoothedEstimateMs = $state<number | null>(null); // Smoothed estimate for display stability
  let lastUpdateTime = $state<number | null>(null); // When we last updated the smoothed estimate
  let currentTime = $state(Date.now());
  
  // Update current time every second for ETA calculation
  onMount(() => {
    const interval = setInterval(() => {
      currentTime = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });
  
  // Track item completions and reset state on phase changes
  $effect(() => {
    // Track progress.phase and progress.current as dependencies
    const phase = progress.phase;
    const current = progress.current;
    const isFetchPhase = phase === 'sales' || phase === 'fetch';
    
    // Use untrack to read/write local state without circular dependency
    untrack(() => {
      // Reset isAborting when starting a new sync (phase goes back to init)
      if (phase === 'init') {
        isAborting = false;
      }
      
      // Reset when sync completes, is cancelled, or errors
      if (phase === 'complete' || phase === 'cancelled' || phase === 'error') {
        itemCompletionTimes = [];
        lastItemCount = 0;
        smoothedEstimateMs = null;
        lastUpdateTime = null;
        return;
      }
      
      // Reset if we're starting fresh (current dropped to 0 or lower than last)
      if (current < lastItemCount) {
        itemCompletionTimes = [];
        lastItemCount = 0;
        smoothedEstimateMs = null;
        lastUpdateTime = null;
      }
      
      // Track new completions during fetch phase
      if (isFetchPhase && current > lastItemCount) {
        const now = Date.now();
        const newCompletions = current - lastItemCount;
        
        // Add timestamps for each new completion
        for (let i = 0; i < newCompletions; i++) {
          itemCompletionTimes.push(now);
        }
        
        // Keep only the rolling window
        if (itemCompletionTimes.length > ROLLING_WINDOW_SIZE) {
          itemCompletionTimes = itemCompletionTimes.slice(-ROLLING_WINDOW_SIZE);
        }
        
        lastItemCount = current;
      }
    });
  });
  
  // Calculate raw estimate from rolling window (pure calculation)
  let rawEstimateMs = $derived.by(() => {
    const isFetchPhase = progress.phase === 'sales' || progress.phase === 'fetch';
    
    if (!isFetchPhase || itemCompletionTimes.length < MIN_SAMPLES_FOR_ESTIMATE) {
      return null;
    }
    
    const remaining = progress.total - progress.current;
    if (remaining <= 0) return null;
    
    // Calculate average time per item from rolling window
    const windowSize = itemCompletionTimes.length;
    const oldestTime = itemCompletionTimes[0];
    const newestTime = itemCompletionTimes[windowSize - 1];
    const windowDuration = newestTime - oldestTime;
    
    // Need at least 2 samples to calculate duration between them
    if (windowSize < 2 || windowDuration <= 0) {
      return null;
    }
    
    // Average time per item = window duration / (items in window - 1)
    // We subtract 1 because N timestamps represent N-1 intervals
    const avgTimePerItem = windowDuration / (windowSize - 1);
    return avgTimePerItem * remaining;
  });
  
  // Update smoothed estimate when raw estimate changes
  $effect(() => {
    const raw = rawEstimateMs;
    if (raw === null) {
      // Don't reset smoothed estimate immediately - let it decay naturally
      return;
    }
    
    const now = Date.now();
    
    // Use untrack to read state without creating circular dependency
    untrack(() => {
      if (smoothedEstimateMs === null || lastUpdateTime === null) {
        // First estimate - use raw value
        smoothedEstimateMs = raw;
        lastUpdateTime = now;
      } else {
        // Account for time that has passed since last update
        const elapsed = now - lastUpdateTime;
        const decayedPrevious = Math.max(0, smoothedEstimateMs - elapsed);
        
        // Blend new estimate with decayed previous value
        smoothedEstimateMs = SMOOTHING_FACTOR * raw + (1 - SMOOTHING_FACTOR) * decayedPrevious;
        lastUpdateTime = now;
      }
    });
  });
  
  // Decay the estimate over time even when no new items complete
  $effect(() => {
    // This effect runs every time currentTime updates (every second)
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    currentTime; // Subscribe to currentTime changes
    
    // Use untrack to read/write state without creating circular dependency
    untrack(() => {
      if (smoothedEstimateMs !== null && lastUpdateTime !== null) {
        const now = Date.now();
        const elapsed = now - lastUpdateTime;
        
        // Only decay if we haven't had a recent update (to avoid double-decay)
        if (elapsed > 500) {
          smoothedEstimateMs = Math.max(0, smoothedEstimateMs - TIME_DECAY_PER_SECOND);
          lastUpdateTime = now;
        }
      }
    });
  });
  
  function handleAbort() {
    isAborting = true;
    onAbort?.();
  }

  let percentage = $derived(
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  );
  
  // Format the smoothed estimate for display
  let estimatedTimeRemaining = $derived.by(() => {
    const isFetchPhase = progress.phase === 'sales' || progress.phase === 'fetch';
    
    if (!isFetchPhase || smoothedEstimateMs === null || smoothedEstimateMs < 5000) {
      return null;
    }
    
    const seconds = Math.floor(smoothedEstimateMs / 1000);
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
    fetch: '&#128176;', // Money bag
    sales: '&#128176;', // Money bag
    saving: '&#128190;', // Floppy disk
    complete: '&#10024;', // Sparkles
    error: '&#128557;', // Crying face
    cancelled: '&#9208;' // Pause button
  }[progress.phase] || '&#129412;');

  let phaseColor = $derived({
    init: 'from-purple-500 to-pink-500',
    dates: 'from-blue-500 to-purple-500',
    fetch: 'from-green-500 to-blue-500',
    sales: 'from-green-500 to-blue-500',
    saving: 'from-yellow-500 to-green-500',
    complete: 'from-pink-500 to-purple-500',
    error: 'from-red-500 to-orange-500',
    cancelled: 'from-yellow-500 to-amber-500'
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

  // Multi-key progress info
  let hasMultipleKeys = $derived(
    progress.totalKeys !== undefined && progress.totalKeys > 1
  );
  
  let currentKeyDisplay = $derived.by(() => {
    if (progress.currentKeyName) {
      return progress.currentKeyName;
    }
    if (progress.currentKeyId) {
      return `Key ...${progress.currentKeyId.slice(-4)}`;
    }
    return null;
  });
  
  // Segmented progress bar data
  let progressSegments = $derived.by(() => {
    const segments = progress.keySegments;
    if (!segments || segments.length === 0 || progress.total === 0) {
      return null;
    }
    
    const total = progress.total;
    const current = progress.current;
    let cumulative = 0;
    
    // Build segment data with widths and fill amounts
    const result: {
      keyName: string;
      type: 'new' | 'reprocess';
      width: number; // percentage width of this segment
      startAt: number; // cumulative start position
      count: number; // number of dates in this segment
    }[] = [];
    
    for (const seg of segments) {
      // New dates segment
      if (seg.newDates > 0) {
        result.push({
          keyName: seg.keyName,
          type: 'new',
          width: (seg.newDates / total) * 100,
          startAt: cumulative,
          count: seg.newDates
        });
        cumulative += seg.newDates;
      }
      
      // Reprocess dates segment
      if (seg.reprocessDates > 0) {
        result.push({
          keyName: seg.keyName,
          type: 'reprocess',
          width: (seg.reprocessDates / total) * 100,
          startAt: cumulative,
          count: seg.reprocessDates
        });
        cumulative += seg.reprocessDates;
      }
    }
    
    // Calculate fill percentage for each segment
    return result.map(seg => {
      const segmentEnd = seg.startAt + seg.count;
      let fillPercent = 0;
      
      if (current >= segmentEnd) {
        fillPercent = 100;
      } else if (current > seg.startAt) {
        fillPercent = ((current - seg.startAt) / seg.count) * 100;
      }
      
      return { ...seg, fillPercent };
    });
  });
  
  // Colors for segments - alternate between keys, different shades for new vs reprocess
  const segmentColors = [
    { new: 'from-green-500 to-emerald-500', reprocess: 'from-yellow-500 to-amber-500' },
    { new: 'from-blue-500 to-cyan-500', reprocess: 'from-orange-500 to-yellow-500' },
    { new: 'from-purple-500 to-pink-500', reprocess: 'from-red-400 to-orange-400' },
    { new: 'from-teal-500 to-green-500', reprocess: 'from-amber-500 to-yellow-500' },
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onmousedown={startWindowDrag}>
  <div class="rainbow-border max-w-md w-full">
    <div class="modal-inner p-8">
      <!-- Header (draggable) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="flex items-center gap-4 mb-6 cursor-grab active:cursor-grabbing" onmousedown={startWindowDrag}>
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
              Sync Paused
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
        <!-- Multi-key indicator -->
        {#if hasMultipleKeys && progress.phase !== 'complete' && progress.phase !== 'error' && progress.phase !== 'cancelled'}
          <div class="mb-4 px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg">
            <div class="flex items-center justify-between text-sm">
              <span class="text-purple-300">
                <span class="mr-1">&#128273;</span>
                Syncing: <span class="font-semibold text-white">{currentKeyDisplay}</span>
              </span>
              <span class="text-purple-400 text-xs">
                Key {(progress.currentKeyIndex ?? 0) + 1} of {progress.totalKeys}
              </span>
            </div>
          </div>
        {/if}

        <!-- Progress Bar -->
        <div class="mb-4">
          <div class="flex justify-between text-sm text-purple-300 mb-2">
            <span>Progress</span>
            <span>{percentage}%</span>
          </div>
          
          {#if progressSegments && progressSegments.length > 0}
            <!-- Segmented Progress Bar -->
            <div class="h-6 bg-purple-900/50 rounded-full overflow-hidden flex relative">
              {#each progressSegments as segment, i}
                {@const keyIndex = progress.keySegments?.findIndex(k => k.keyName === segment.keyName) ?? 0}
                {@const colors = segmentColors[keyIndex % segmentColors.length]}
                {@const gradientClass = segment.type === 'new' ? colors.new : colors.reprocess}
                <div 
                  class="h-full relative overflow-hidden transition-all duration-300 group cursor-help"
                  style="width: {segment.width}%"
                >
                  <!-- Background (unfilled) -->
                  <div class="absolute inset-0 {segment.type === 'new' ? 'bg-white/5' : 'bg-white/10'}"></div>
                  
                  <!-- Filled portion -->
                  <div 
                    class="absolute inset-y-0 left-0 bg-gradient-to-r {gradientClass} transition-all duration-300"
                    style="width: {segment.fillPercent}%"
                  >
                    {#if segment.fillPercent > 0 && segment.fillPercent < 100}
                      <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
                    {/if}
                  </div>
                  
                  <!-- Segment divider -->
                  {#if i < progressSegments.length - 1}
                    <div class="absolute right-0 top-0 bottom-0 w-px bg-purple-900/80"></div>
                  {/if}
                  
                  <!-- Custom tooltip -->
                  <div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {segment.keyName}: {segment.count} {segment.type === 'new' ? 'new' : 'update'} dates
                    <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              {/each}
            </div>
            
            <!-- Legend -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {#each progress.keySegments ?? [] as keyInfo, keyIndex}
                {@const colors = segmentColors[keyIndex % segmentColors.length]}
                <div class="flex items-center gap-2">
                  <span class="font-medium text-purple-200">{keyInfo.keyName}:</span>
                  {#if keyInfo.newDates > 0}
                    <span class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-gradient-to-r {colors.new}"></span>
                      <span class="text-purple-300">{keyInfo.newDates} new</span>
                    </span>
                  {/if}
                  {#if keyInfo.reprocessDates > 0}
                    <span class="flex items-center gap-1">
                      <span class="w-2 h-2 rounded-full bg-gradient-to-r {colors.reprocess}"></span>
                      <span class="text-purple-300">{keyInfo.reprocessDates} updates</span>
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <!-- Simple Progress Bar (fallback) -->
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
          {/if}
          
          {#if estimatedTimeRemaining}
            <div class="text-xs text-purple-400 text-right mt-1">
              {estimatedTimeRemaining}
            </div>
          {/if}
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="glass-card p-3 text-center">
            <div class="text-2xl font-bold text-purple-200">
              {#if progress.phase === 'dates'}
                {progress.current.toLocaleString()}/{progress.total.toLocaleString()}
              {:else}
                {progress.current.toLocaleString()}/{progress.total.toLocaleString()}
              {/if}
            </div>
            <div class="text-xs text-purple-400">
              {#if progress.phase === 'dates'}
                Keys checked
              {:else}
                Dates processed
              {/if}
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

      <!-- Paused Message -->
      {#if progress.phase === 'cancelled'}
        <div class="mb-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-200 text-sm">
          <p class="font-semibold mb-1">Sync paused</p>
          <p class="text-xs">Data downloaded so far has been saved. You can resume syncing to continue where you left off.</p>
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
          {#if onResume}
            <button
              type="button"
              class="btn-rainbow flex-1 flex items-center justify-center gap-2"
              onclick={onResume}
            >
              <span>&#9654;</span>
              Resume
            </button>
          {/if}
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
              class="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50 text-yellow-300 rounded-lg font-semibold transition-colors disabled:opacity-50"
              onclick={handleAbort}
              disabled={isAborting}
            >
              {#if isAborting}
                Pausing...
              {:else}
                Pause
              {/if}
            </button>
          {/if}
        {/if}
      </div>

      <!-- Info while loading -->
      {#if progress.phase !== 'complete' && progress.phase !== 'error' && progress.phase !== 'cancelled'}
        <div class="mt-6 pt-4 border-t border-white/10 text-center">
          <p class="text-xs text-purple-400 italic">
            {#if progress.phase === 'dates'}
              &#128161; Counting dates across all API keys for accurate time estimates...
            {:else if progress.phase === 'fetch' || progress.phase === 'sales'}
              &#128161; Tip: New dates are processed first. Cancel anytime - your data is saved incrementally!
            {:else}
              &#128161; Using highwatermark to check for new data since last sync...
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>
