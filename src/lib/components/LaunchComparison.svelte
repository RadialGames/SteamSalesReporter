<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { salesStore } from '$lib/stores/sales';
  import ProductLaunchTable from './ProductLaunchTable.svelte';
  import UnicornLoader from './UnicornLoader.svelte';
  import { ToggleGroup } from './ui';
  import type { SalesRecord } from '$lib/services/types';
  import {
    computeProductGroups,
    shouldUseWorker,
    type ProductGroup,
    type WorkerProgress,
  } from '$lib/workers';
  import { calculateLaunchDays } from '$lib/utils/launch-metrics';

  let maxDays = $state(2);
  let copyFeedback = $state(false);
  let groupBy = $state<'appId' | 'packageId'>('appId');

  // Loading state for async computations
  let isComputing = $state(false);
  let computedAppGroups = $state<ProductGroup[]>([]);
  let computedPackageGroups = $state<ProductGroup[]>([]);
  let lastComputedDataLength = $state(0);
  let lastComputedGroupBy = $state<'appId' | 'packageId' | null>(null);
  let useWorker = $state(false);

  // Progress tracking
  let computeProgress = $state<WorkerProgress>({ processed: 0, total: 0 });
  let computeStartTime = $state<number | null>(null);
  let elapsedSeconds = $state(0);
  let abortController = $state<AbortController | null>(null);

  // ETA calculation
  const MIN_SAMPLES_FOR_ETA = 3;
  let progressSamples = $state<{ time: number; processed: number }[]>([]);

  // Virtual/lazy loading state
  const INITIAL_VISIBLE = 10;
  const LOAD_MORE_COUNT = 10;
  let visibleCount = $state(INITIAL_VISIBLE);
  let loadMoreRef = $state<HTMLDivElement | null>(null);
  let observer: IntersectionObserver | null = null;

  // Update elapsed time every second while computing
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if (isComputing && computeStartTime) {
      elapsedInterval = setInterval(() => {
        elapsedSeconds = Math.floor((Date.now() - computeStartTime!) / 1000);
      }, 1000);
      return () => {
        if (elapsedInterval) clearInterval(elapsedInterval);
      };
    } else if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
  });

  // Calculate progress percentage
  const progressPercent = $derived(
    computeProgress.total > 0
      ? Math.round((computeProgress.processed / computeProgress.total) * 100)
      : 0
  );

  // Calculate throughput (records per second)
  const throughput = $derived.by(() => {
    if (elapsedSeconds < 1 || computeProgress.processed < 1000) return null;
    return Math.round(computeProgress.processed / elapsedSeconds);
  });

  // Calculate ETA
  const estimatedTimeRemaining = $derived.by(() => {
    if (progressSamples.length < MIN_SAMPLES_FOR_ETA) return null;
    if (computeProgress.processed >= computeProgress.total) return null;

    const remaining = computeProgress.total - computeProgress.processed;
    const recentSamples = progressSamples.slice(-5);
    const oldestSample = recentSamples[0];
    const newestSample = recentSamples[recentSamples.length - 1];

    const timeDiff = newestSample.time - oldestSample.time;
    const processedDiff = newestSample.processed - oldestSample.processed;

    if (timeDiff <= 0 || processedDiff <= 0) return null;

    const msPerRecord = timeDiff / processedDiff;
    const etaMs = msPerRecord * remaining;

    if (etaMs < 3000) return null; // Don't show for < 3 seconds

    const seconds = Math.floor(etaMs / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
      return `~${minutes}m ${seconds % 60}s remaining`;
    }
    return `~${seconds}s remaining`;
  });

  // Handle progress updates - use untrack to prevent triggering effects
  function onProgress(progress: WorkerProgress) {
    untrack(() => {
      computeProgress = progress;
      progressSamples = [
        ...progressSamples.slice(-9),
        { time: Date.now(), processed: progress.processed },
      ];
    });
  }

  // Cancel current computation
  function cancelComputation() {
    if (abortController) {
      abortController.abort();
      abortController = null;
      isComputing = false;
    }
  }

  // Trigger recomputation when data or groupBy changes
  // Uses the shared worker manager which handles worker vs main thread fallback
  $effect(() => {
    const records = $salesStore;
    const currentGroupBy = groupBy;

    // Use untrack to read state without creating dependencies
    const lastLength = untrack(() => lastComputedDataLength);
    const lastGroupBy = untrack(() => lastComputedGroupBy);

    // Check if we need to recompute
    if (records.length === lastLength && currentGroupBy === lastGroupBy) {
      return;
    }

    // Cancel any existing computation (read without tracking)
    untrack(() => {
      if (abortController) {
        abortController.abort();
      }
    });

    // Skip if no data
    if (records.length === 0) {
      computedAppGroups = [];
      computedPackageGroups = [];
      lastComputedDataLength = 0;
      lastComputedGroupBy = currentGroupBy;
      return;
    }

    // Reset progress state (write without triggering this effect)
    untrack(() => {
      computeProgress = { processed: 0, total: records.length };
      computeStartTime = Date.now();
      elapsedSeconds = 0;
      progressSamples = [];
    });

    // Create new abort controller
    const controller = new AbortController();
    abortController = controller;

    // Set loading state
    isComputing = true;
    useWorker = shouldUseWorker(records.length);

    // Use tick() to flush Svelte DOM updates, then RAF to yield to browser paint,
    // ensuring the loading state is visible before computation starts
    tick().then(() => {
      requestAnimationFrame(() => {
        // Double-check we weren't cancelled during the yield
        if (controller.signal.aborted) return;

        computeProductGroups(records, currentGroupBy, {
          onProgress,
          signal: controller.signal,
        })
          .then(async (groups) => {
            // CRITICAL: Strip Svelte proxies from nested records for performance
            // Worker path already returns plain objects (postMessage serializes them)
            // Sync path also creates plain objects, but we need to ensure the groups array itself is plain
            // Use a memory-efficient approach that processes groups individually to avoid
            // exceeding JavaScript's maximum string length limit
            const plainGroups: typeof groups = groups.map((group) => {
              // Create a plain copy of the group
              const plainGroup = {
                id: group.id,
                name: group.name,
                records: group.records.map((record) => ({ ...record })),
                hasRevenue: group.hasRevenue,
                launchMetrics: group.launchMetrics,
              };
              return plainGroup;
            });

            // Compute launch metrics if not already computed (worker path doesn't compute them)
            // This happens AFTER stripping proxies, so records are plain objects = fast
            for (const group of plainGroups) {
              if (!group.launchMetrics) {
                group.launchMetrics = calculateLaunchDays(group.records, 365);
              }
            }

            if (currentGroupBy === 'appId') {
              computedAppGroups = plainGroups;
            } else {
              computedPackageGroups = plainGroups;
            }
            lastComputedDataLength = records.length;
            lastComputedGroupBy = currentGroupBy;
            isComputing = false;
            abortController = null;

            await tick();
          })
          .catch((error) => {
            // Only log if not a cancellation
            if (error.message !== 'Computation cancelled') {
              console.error('Computation error:', error);
            }
            isComputing = false;
            abortController = null;
          });
      });
    });
  });

  // Current active groups based on toggle
  const productGroups = $derived(groupBy === 'appId' ? computedAppGroups : computedPackageGroups);

  // Visible subset of product groups (lazy loading)
  const visibleProducts = $derived(productGroups.slice(0, visibleCount));

  const hasMoreProducts = $derived(visibleCount < productGroups.length);

  // Reset visible count when groups change
  $effect(() => {
    // When productGroups changes, reset visible count
    const _ = productGroups;
    visibleCount = INITIAL_VISIBLE;
  });

  // Setup intersection observer for infinite scroll
  $effect(() => {
    if (loadMoreRef && hasMoreProducts) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMoreProducts) {
            visibleCount = Math.min(visibleCount + LOAD_MORE_COUNT, productGroups.length);
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(loadMoreRef);

      return () => {
        observer?.disconnect();
      };
    }
  });

  function loadMore() {
    visibleCount = Math.min(visibleCount + LOAD_MORE_COUNT, productGroups.length);
  }

  // Calculate day-by-day data for a single product
  function calculateProductDays(records: SalesRecord[], maxDaysLimit: number) {
    const datesWithRevenue = records
      .filter((r) => r.netSalesUsd && r.netSalesUsd > 0)
      .map((r) => r.date)
      .sort();

    if (datesWithRevenue.length === 0) return { launchDate: null, days: [] };

    const launchDate = datesWithRevenue[0];
    const launchTime = new Date(launchDate).getTime();

    const dayMap = new Map<
      number,
      {
        day: number;
        date: string;
        sold: number;
        returned: number;
        activated: number;
        bundle: number;
        netRevenue: number;
      }
    >();

    for (const record of records) {
      const recordTime = new Date(record.date).getTime();
      const dayOffset = Math.floor((recordTime - launchTime) / (1000 * 60 * 60 * 24));

      if (dayOffset < 0 || dayOffset >= maxDaysLimit) continue;

      if (!dayMap.has(dayOffset)) {
        const dayDate = new Date(launchTime + dayOffset * 24 * 60 * 60 * 1000);
        dayMap.set(dayOffset, {
          day: dayOffset,
          date: dayDate.toISOString().split('T')[0],
          sold: 0,
          returned: 0,
          activated: 0,
          bundle: 0,
          netRevenue: 0,
        });
      }

      const dayData = dayMap.get(dayOffset)!;
      dayData.sold += record.grossUnitsSold ?? 0;
      dayData.returned += record.grossUnitsReturned ?? 0;
      dayData.activated += record.grossUnitsActivated ?? 0;
      dayData.netRevenue += record.netSalesUsd ?? 0;

      // Count units from bundle sales (where bundleid exists)
      if (record.bundleid != null) {
        dayData.bundle += (record.grossUnitsSold ?? 0) + (record.grossUnitsActivated ?? 0);
      }
    }

    return { launchDate, days: Array.from(dayMap.values()).sort((a, b) => a.day - b.day) };
  }

  // Generate CSV content for all products
  function generateAllCsvContent(): string {
    const products = productGroups;
    if (products.length === 0) return '';

    const idLabel = groupBy === 'appId' ? 'App ID' : 'Package ID';
    const headers = [
      'Product',
      idLabel,
      'Day',
      'Date',
      'Units Sold',
      'Returns',
      'Activations',
      'Bundle',
      'Net Revenue (USD)',
    ];
    const rows: string[][] = [];

    for (const product of products) {
      const { days } = calculateProductDays(product.records, maxDays);
      for (const day of days) {
        rows.push([
          `"${product.name.replace(/"/g, '""')}"`,
          product.id.toString(),
          day.day.toString(),
          day.date,
          day.sold.toString(),
          day.returned.toString(),
          day.activated.toString(),
          day.bundle.toString(),
          day.netRevenue.toFixed(2),
        ]);
      }
    }

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  }

  async function copyAllToClipboard() {
    const csvContent = generateAllCsvContent();
    if (!csvContent) return;

    try {
      await navigator.clipboard.writeText(csvContent);
      copyFeedback = true;
      setTimeout(() => (copyFeedback = false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }

  function downloadAllCsv() {
    const csvContent = generateAllCsvContent();
    if (!csvContent) return;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const suffix = groupBy === 'appId' ? 'by_app' : 'by_package';
    link.setAttribute('download', `launch_comparison_${suffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
</script>

<div class="space-y-6">
  <!-- Header and Controls -->
  <div class="glass-card p-6">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold font-['Fredoka'] flex items-center gap-2">
          <span class="text-3xl">&#128640;</span>
          Launch Comparison
        </h2>
        <p class="text-purple-300 mt-1">
          Product performance from launch day, aggregated by day age
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <!-- Group By Toggle -->
        <ToggleGroup
          label="Group by:"
          options={[
            { value: 'appId', label: 'App ID' },
            { value: 'packageId', label: 'Package ID' },
          ]}
          value={groupBy}
          onchange={(v) => (groupBy = v as 'appId' | 'packageId')}
        />

        <div class="flex items-center gap-2">
          <label for="maxDays" class="text-purple-200 whitespace-nowrap">Days:</label>
          <input
            id="maxDays"
            type="number"
            bind:value={maxDays}
            min="1"
            max="365"
            class="w-20 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white
                   focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div
          class="flex p-[2px] rounded-lg bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500"
        >
          <div class="flex bg-purple-900/90 rounded-md">
            <button
              class="px-3 py-1.5 rounded-l-md text-purple-200 text-sm
                     transition-colors flex items-center gap-1.5 border-r border-white/10
                     hover:bg-white/10 hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={copyAllToClipboard}
              disabled={productGroups.length === 0}
              title="Copy all products to clipboard"
            >
              {#if copyFeedback}
                <span>&#10003;</span>
                Copied!
              {:else}
                <span>&#128203;</span>
                Copy All
              {/if}
            </button>
            <button
              class="px-3 py-1.5 rounded-r-md text-purple-200 text-sm
                     transition-colors flex items-center gap-1.5
                     hover:bg-white/10 hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={downloadAllCsv}
              disabled={productGroups.length === 0}
              title="Download all products as CSV"
            >
              <span>&#128190;</span>
              Download All
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  {#if $salesStore.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128202;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Data Available</h3>
      <p class="text-purple-300">Refresh your sales data to see the Launch Comparison.</p>
    </div>
  {:else if isComputing}
    <div class="glass-card p-12 text-center">
      <UnicornLoader
        message={`Processing ${computeProgress.processed.toLocaleString()} of ${computeProgress.total.toLocaleString()} records...`}
        size="medium"
      />

      <!-- Progress Bar -->
      <div class="mt-6 w-full max-w-md mx-auto">
        <div class="flex justify-between text-sm text-purple-300 mb-2">
          <span>Progress</span>
          <span>{progressPercent}%</span>
        </div>
        <div class="h-3 bg-purple-900/50 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 transition-all duration-300 ease-out rounded-full relative"
            style="width: {progressPercent}%"
          >
            {#if progressPercent > 0 && progressPercent < 100}
              <div class="absolute inset-0 bg-white/20 animate-pulse"></div>
            {/if}
          </div>
        </div>

        <!-- Stats Row -->
        <div class="flex justify-between items-center mt-2 text-xs text-purple-400">
          <span>
            {#if elapsedSeconds > 0}
              {elapsedSeconds}s elapsed
            {:else}
              Starting...
            {/if}
          </span>
          <span>
            {#if estimatedTimeRemaining}
              {estimatedTimeRemaining}
            {:else if throughput}
              {throughput.toLocaleString()} records/sec
            {/if}
          </span>
        </div>
      </div>

      <!-- Worker indicator and Cancel button -->
      <div class="mt-4 flex flex-col items-center gap-3">
        {#if useWorker}
          <p class="text-purple-300 text-sm">Using background worker for better performance</p>
        {/if}
        <button
          type="button"
          class="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/50
                 text-yellow-300 rounded-lg font-semibold text-sm transition-colors"
          onclick={cancelComputation}
        >
          Cancel
        </button>
      </div>
    </div>
  {:else if productGroups.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128269;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Products Found</h3>
      <p class="text-purple-300">No products with revenue data were found.</p>
    </div>
  {:else}
    <div class="text-purple-300 text-sm flex items-center justify-between">
      <span>
        Showing {visibleProducts.length} of {productGroups.length}
        {groupBy === 'appId' ? 'app' : 'package'}{productGroups.length === 1 ? '' : 's'} with revenue
        data
      </span>
      {#if hasMoreProducts}
        <button class="text-purple-400 hover:text-purple-200 text-sm underline" onclick={loadMore}>
          Load more ({productGroups.length - visibleCount} remaining)
        </button>
      {/if}
    </div>

    <!-- Product Tables (lazy loaded) -->
    {#each visibleProducts as product (product.id)}
      <ProductLaunchTable
        id={product.id}
        name={product.name}
        idLabel={groupBy === 'appId' ? 'App ID' : 'Package ID'}
        records={product.records}
        launchMetrics={product.launchMetrics}
        {maxDays}
      />
    {/each}

    <!-- Infinite scroll trigger -->
    {#if hasMoreProducts}
      <div bind:this={loadMoreRef} class="glass-card p-8 text-center">
        <UnicornLoader message="Loading more products..." size="small" />
      </div>
    {/if}
  {/if}
</div>
