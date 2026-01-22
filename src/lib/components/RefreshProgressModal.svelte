<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { SyncProgress, SyncPhase } from '$lib/services/types';
  import { startWindowDrag } from '$lib/utils/tauri';

  interface Props {
    progress: SyncProgress;
    oncancel?: () => void;
    onabort?: () => void;
    onresume?: () => void;
  }

  let { progress, oncancel, onabort, onresume }: Props = $props();

  let isAborting = $state(false);

  // Time estimation configuration
  const MIN_ITEMS_FOR_ESTIMATE = 10; // Minimum items completed before showing estimate
  const MIN_ELAPSED_MS = 5000; // Minimum 5 seconds elapsed before showing estimate
  const SMOOTHING_FACTOR = 0.2; // How much to weight new estimates (0-1, lower = smoother)

  // Time estimation state - track overall sync progress
  let populateStartTime = $state<number | null>(null); // When populate phase started
  let aggregatesStartTime = $state<number | null>(null); // When aggregates phase started
  let lastItemCount = $state(0); // Track previous count to detect phase start
  let smoothedEstimateMs = $state<number | null>(null); // Smoothed estimate for display stability
  let currentTime = $state(Date.now());

  // Update current time every second for ETA calculation
  onMount(() => {
    const interval = setInterval(() => {
      currentTime = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  // Track previous phase to detect transitions
  let previousPhase = $state<SyncPhase | null>(null);

  // Calculate current count based on phase
  let currentCount = $derived(
    progress.phase === 'discovery'
      ? (progress.discoveredDates ?? 0)
      : (progress.completedTasks ?? 0)
  );

  // Calculate total count based on phase
  let totalCount = $derived(
    progress.phase === 'discovery' ? (progress.totalApiKeys ?? 0) : (progress.totalTasks ?? 0)
  );

  // Track item completions and reset state on phase changes
  $effect(() => {
    // Track progress.phase and currentCount as dependencies
    const phase = progress.phase;
    const current = currentCount;
    const isPopulatePhase = phase === 'populate';

    // Use untrack to read/write local state without circular dependency
    untrack(() => {
      // Reset isAborting when starting a new sync or resuming
      if (phase === 'discovery' || (previousPhase === 'cancelled' && phase !== 'cancelled')) {
        isAborting = false;
      }

      // Update previous phase for next comparison
      previousPhase = phase;

      // Reset when sync completes, is cancelled, or errors
      if (phase === 'complete' || phase === 'cancelled' || phase === 'error') {
        populateStartTime = null;
        aggregatesStartTime = null;
        lastItemCount = 0;
        smoothedEstimateMs = null;
        return;
      }

      // Reset if we're starting fresh (current dropped to 0 or lower than last)
      if (current < lastItemCount) {
        populateStartTime = null;
        lastItemCount = 0;
        smoothedEstimateMs = null;
      }

      // Track when populate phase starts
      if (isPopulatePhase) {
        // Set start time when we first enter populate phase
        if (populateStartTime === null) {
          populateStartTime = Date.now();
        }
        lastItemCount = current;
        // Clear aggregates start time when switching to populate
        aggregatesStartTime = null;
      } else if (phase === 'aggregates') {
        // Track when aggregates phase starts
        if (aggregatesStartTime === null) {
          aggregatesStartTime = Date.now();
        }
        lastItemCount = current;
        // Clear populate start time when switching to aggregates
        populateStartTime = null;
      } else {
        // Not in populate or aggregates phase - clear start times
        populateStartTime = null;
        aggregatesStartTime = null;
      }
    });
  });

  // Calculate raw estimate based on overall sync progress
  let rawEstimateMs = $derived.by(() => {
    const isPopulatePhase = progress.phase === 'populate';
    const isAggregatesPhase = progress.phase === 'aggregates';

    if (
      (!isPopulatePhase && !isAggregatesPhase) ||
      (isPopulatePhase && populateStartTime === null) ||
      (isAggregatesPhase && aggregatesStartTime === null)
    ) {
      return null;
    }

    const remaining = totalCount - currentCount;
    if (remaining <= 0) return null;

    // Need minimum progress before showing estimate
    if (currentCount < MIN_ITEMS_FOR_ESTIMATE) {
      return null;
    }

    const now = Date.now();
    const startTime = isPopulatePhase ? populateStartTime : aggregatesStartTime;
    const elapsedMs = now - startTime!;

    // Need minimum elapsed time before showing estimate
    if (elapsedMs < MIN_ELAPSED_MS) {
      return null;
    }

    // Calculate overall completion rate from start of sync
    // This gives a stable estimate based on total progress
    const itemsPerMs = currentCount / elapsedMs;

    // Estimate remaining time: remaining items / rate
    const estimateMs = remaining / itemsPerMs;

    return estimateMs;
  });

  // Update smoothed estimate when raw estimate changes
  $effect(() => {
    const raw = rawEstimateMs;
    if (raw === null) {
      // Don't reset smoothed estimate immediately - let it decay naturally
      return;
    }

    // Use untrack to read state without creating circular dependency
    untrack(() => {
      if (smoothedEstimateMs === null) {
        // First estimate - use raw value
        smoothedEstimateMs = raw;
      } else {
        // Exponential moving average for smooth, stable estimates
        // Lower SMOOTHING_FACTOR = more stable but slower to react
        smoothedEstimateMs = SMOOTHING_FACTOR * raw + (1 - SMOOTHING_FACTOR) * smoothedEstimateMs;
      }
    });
  });

  // Decay the estimate over time to account for elapsed time
  $effect(() => {
    // This effect runs every time currentTime updates (every second)
    currentTime; // Subscribe to currentTime changes

    // Use untrack to read/write state without creating circular dependency
    untrack(() => {
      if (smoothedEstimateMs !== null && smoothedEstimateMs > 0) {
        // Subtract 1 second from estimate each second (natural countdown)
        smoothedEstimateMs = Math.max(0, smoothedEstimateMs - 1000);
      }
    });
  });

  function handleAbort() {
    isAborting = true;
    onabort?.();
  }

  let percentage = $derived(totalCount > 0 ? Math.round((currentCount / totalCount) * 100) : 0);

  // Format the smoothed estimate for display
  let estimatedTimeRemaining = $derived.by(() => {
    const isPopulatePhase = progress.phase === 'populate';
    const isAggregatesPhase = progress.phase === 'aggregates';

    if (
      (!isPopulatePhase && !isAggregatesPhase) ||
      smoothedEstimateMs === null ||
      smoothedEstimateMs < 5000
    ) {
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

  let phaseEmoji = $derived(
    {
      discovery: '&#128269;', // Magnifying glass
      populate: '&#128176;', // Money bag
      aggregates: '&#128190;', // Floppy disk
      complete: '&#10024;', // Sparkles
      error: '&#128557;', // Crying face
      cancelled: '&#9208;', // Pause button
    }[progress.phase] || '&#129412;'
  );

  let phaseColor = $derived(
    {
      discovery: 'from-blue-500 to-purple-500',
      populate: 'from-green-500 to-blue-500',
      aggregates: 'from-yellow-500 to-green-500',
      complete: 'from-pink-500 to-purple-500',
      error: 'from-red-500 to-orange-500',
      cancelled: 'from-yellow-500 to-amber-500',
    }[progress.phase] || 'from-purple-500 to-pink-500'
  );

  let canCancel = $derived(
    progress.phase !== 'complete' &&
      progress.phase !== 'error' &&
      progress.phase !== 'cancelled' &&
      progress.phase !== 'aggregates'
  );

  // Check if we're already up to date (0 tasks to process)
  let isAlreadyUpToDate = $derived(
    progress.phase === 'complete' && (progress.totalTasks ?? 0) === 0
  );

  // Segmented progress bar data for populate phase
  let progressSegments = $derived.by(() => {
    const segments = progress.keySegments;
    if (!segments || segments.length === 0 || progress.phase !== 'populate') {
      return null;
    }

    const total = progress.totalTasks ?? 0;
    if (total === 0) return null;

    const completed = progress.completedTasks ?? 0;
    let cumulative = 0;

    // Build segment data with widths
    const result: {
      keyName: string;
      width: number; // percentage width of this segment
      startAt: number; // cumulative start position
      count: number; // number of tasks in this segment
    }[] = [];

    for (const seg of segments) {
      if (seg.pendingTasks > 0) {
        result.push({
          keyName: seg.keyName,
          width: (seg.pendingTasks / total) * 100,
          startAt: cumulative,
          count: seg.pendingTasks,
        });
        cumulative += seg.pendingTasks;
      }
    }

    // Calculate fill percentage for each segment
    return result.map((seg) => {
      const segmentEnd = seg.startAt + seg.count;
      let fillPercent = 0;

      if (completed >= segmentEnd) {
        fillPercent = 100;
      } else if (completed > seg.startAt) {
        fillPercent = ((completed - seg.startAt) / seg.count) * 100;
      }

      return { ...seg, fillPercent };
    });
  });

  // Colors for segments - one color per key
  const segmentColors = [
    'from-green-500 to-emerald-500',
    'from-blue-500 to-cyan-500',
    'from-purple-500 to-pink-500',
    'from-teal-500 to-green-500',
    'from-orange-500 to-yellow-500',
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
  onmousedown={startWindowDrag}
>
  <div class="rainbow-border max-w-md w-full">
    <div class="modal-inner p-8">
      <!-- Header (draggable) -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex items-center gap-4 mb-6 cursor-grab active:cursor-grabbing"
        onmousedown={startWindowDrag}
      >
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
            {:else if progress.phase === 'discovery'}
              Discovering Changes
            {:else if progress.phase === 'populate'}
              Fetching Sales Data
            {:else if progress.phase === 'aggregates'}
              Computing Summaries
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
          <p class="text-purple-400 text-xs mt-2">Check back later for updates!</p>
        </div>
      {:else}
        <!-- Progress Bar -->
        <div class="mb-4">
          <div class="flex justify-between text-sm text-purple-300 mb-2">
            <span>
              {#if progress.phase === 'discovery'}
                Step 1: Discovery
              {:else if progress.phase === 'populate'}
                Step 2: Fetching Data
              {:else if progress.phase === 'aggregates'}
                Step 3: Computing
              {:else}
                Progress
              {/if}
            </span>
            <span>{percentage}%</span>
          </div>

          {#if progress.phase === 'aggregates'}
            <!-- Aggregates Progress Bar -->
            <div class="h-4 bg-purple-900/50 rounded-full overflow-hidden">
              <div
                class="h-full bg-gradient-to-r {phaseColor} transition-all duration-300 ease-out rounded-full relative"
                style="width: {percentage}%"
              >
                <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
              </div>
            </div>
            <div class="text-xs text-purple-400 mt-2 text-center">
              {progress.message || 'Computing aggregates...'}
            </div>
          {:else if progressSegments && progressSegments.length > 0}
            <!-- Segmented Progress Bar -->
            <div class="h-6 bg-purple-900/50 rounded-full overflow-hidden flex relative">
              {#each progressSegments as segment, i (i)}
                {@const gradientClass = segmentColors[i % segmentColors.length]}
                <div
                  class="h-full relative overflow-hidden transition-all duration-300 group cursor-help"
                  style="width: {segment.width}%"
                >
                  <!-- Background (unfilled) -->
                  <div class="absolute inset-0 bg-white/5"></div>

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
                  <div
                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  >
                    {segment.keyName}: {segment.count} dates
                    <div
                      class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"
                    ></div>
                  </div>
                </div>
              {/each}
            </div>

            <!-- Legend -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {#each progress.keySegments ?? [] as keyInfo, keyIndex (keyInfo.keyId)}
                {@const color = segmentColors[keyIndex % segmentColors.length]}
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-gradient-to-r {color}"></span>
                  <span class="text-purple-200">{keyInfo.keyName}</span>
                  <span class="text-purple-400">({keyInfo.pendingTasks} dates)</span>
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
              {#if progress.phase === 'discovery'}
                {(progress.currentApiKey ?? 0).toLocaleString()}/{(
                  progress.totalApiKeys ?? 0
                ).toLocaleString()}
              {:else if progress.phase === 'aggregates'}
                {percentage}%
              {:else}
                {(progress.completedTasks ?? 0).toLocaleString()}/{(
                  progress.totalTasks ?? 0
                ).toLocaleString()}
              {/if}
            </div>
            <div class="text-xs text-purple-400">
              {#if progress.phase === 'discovery'}
                API keys checked
              {:else if progress.phase === 'aggregates'}
                Aggregates computed
              {:else}
                Dates processed
              {/if}
            </div>
          </div>
          <div class="glass-card p-3 text-center">
            <div class="text-2xl font-bold text-purple-200">
              {#if progress.phase === 'discovery'}
                {(progress.discoveredDates ?? 0).toLocaleString()}
              {:else}
                {(progress.recordsFetched ?? 0).toLocaleString()}
              {/if}
            </div>
            <div class="text-xs text-purple-400">
              {#if progress.phase === 'discovery'}
                Dates discovered
              {:else}
                Records fetched
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- Error Message -->
      {#if progress.error}
        <div
          class="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm"
        >
          {progress.error}
        </div>
      {/if}

      <!-- Paused Message -->
      {#if progress.phase === 'cancelled'}
        <div
          class="mb-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-200 text-sm"
        >
          <p class="font-semibold mb-1">Sync paused</p>
          <p class="text-xs">
            Data downloaded so far has been saved. You can resume syncing to continue where you left
            off.
          </p>
        </div>
      {/if}

      <!-- Actions -->
      <div class="flex gap-3">
        {#if isAlreadyUpToDate}
          <button
            type="button"
            class="btn-rainbow flex-1 flex items-center justify-center gap-2"
            onclick={oncancel}
          >
            <span>&#129412;</span>
            Awesome!
          </button>
        {:else if progress.phase === 'complete'}
          <button
            type="button"
            class="btn-rainbow flex-1 flex items-center justify-center gap-2"
            onclick={oncancel}
          >
            <span>&#10024;</span>
            Continue
          </button>
        {:else if progress.phase === 'error'}
          <button type="button" class="btn-primary flex-1" onclick={oncancel}> Close </button>
        {:else if progress.phase === 'cancelled'}
          {#if onresume}
            <button
              type="button"
              class="btn-rainbow flex-1 flex items-center justify-center gap-2"
              onclick={onresume}
            >
              <span>&#9654;</span>
              Resume
            </button>
          {/if}
          <button type="button" class="btn-primary flex-1" onclick={oncancel}> Close </button>
        {:else}
          <!-- Active sync - show cancel button -->
          <div class="flex-1 flex flex-col items-center justify-center gap-1 text-purple-300">
            <div class="flex items-center gap-2">
              <span class="inline-block animate-spin">&#10226;</span>
              {#if progress.phase === 'discovery'}
                Discovering...
              {:else if progress.phase === 'populate'}
                Fetching...
              {:else if progress.phase === 'aggregates'}
                Computing...
              {:else}
                Syncing...
              {/if}
            </div>
            {#if progress.currentDate}
              <div class="text-xs text-purple-400 font-mono">
                {progress.currentDate}
              </div>
            {/if}
          </div>
          {#if canCancel && onabort}
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
            {#if progress.phase === 'discovery'}
              &#128161; Step 1 of 3: Finding dates with new or updated sales data...
            {:else if progress.phase === 'populate'}
              &#128161; Step 2 of 3: Downloading sales records. Cancel anytime - progress is saved!
            {:else if progress.phase === 'aggregates'}
              &#128161; Step 3 of 3: Computing summaries for faster dashboard loading...
            {:else}
              &#128161; Processing your sales data...
            {/if}
          </p>
        </div>
      {/if}
    </div>
  </div>
</div>
