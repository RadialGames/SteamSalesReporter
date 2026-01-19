<script lang="ts">
  import { salesStore } from '$lib/stores/sales';
  import ProductLaunchTable from './ProductLaunchTable.svelte';
  import UnicornLoader from './UnicornLoader.svelte';
  import type { SalesRecord } from '$lib/services/types';
  import { computeProductGroups, shouldUseWorker, type ProductGroup } from '$lib/workers';

  let maxDays = $state(2);
  let copyFeedback = $state(false);
  let groupBy = $state<'appId' | 'packageId'>('appId');
  
  // Loading state for async computations
  let isComputing = $state(false);
  let computeProgress = $state({ processed: 0, total: 0 });
  let computedAppGroups = $state<ProductGroup[]>([]);
  let computedPackageGroups = $state<ProductGroup[]>([]);
  let lastComputedDataLength = $state(0);
  let lastComputedGroupBy = $state<'appId' | 'packageId' | null>(null);
  let useWorker = $state(false);
  
  // Virtual/lazy loading state
  const INITIAL_VISIBLE = 10;
  const LOAD_MORE_COUNT = 10;
  let visibleCount = $state(INITIAL_VISIBLE);
  let loadMoreRef = $state<HTMLDivElement | null>(null);
  let observer: IntersectionObserver | null = null;

  // Chunk size for processing - yields to UI every N records (for main thread fallback)
  const CHUNK_SIZE = 50000;

  // Async function to compute groups with UI yields (main thread fallback)
  async function computeGroupsMainThread(
    records: SalesRecord[],
    mode: 'appId' | 'packageId'
  ): Promise<ProductGroup[]> {
    const groups = new Map<number, ProductGroup>();
    const total = records.length;
    
    for (let i = 0; i < total; i += CHUNK_SIZE) {
      const chunk = records.slice(i, Math.min(i + CHUNK_SIZE, total));
      
      for (const record of chunk) {
        const id = mode === 'appId' ? record.appId : record.packageid;
        if (id == null) continue;
        
        if (!groups.has(id)) {
          const name = mode === 'appId' 
            ? (record.appName || `App ${id}`)
            : (record.packageName || `Package ${id}`);
          groups.set(id, {
            id,
            name,
            records: [],
            hasRevenue: false
          });
        }
        
        const group = groups.get(id)!;
        group.records.push(record);
        
        if (record.netSalesUsd && record.netSalesUsd > 0) {
          group.hasRevenue = true;
        }
      }
      
      // Update progress and yield to UI
      computeProgress = { processed: Math.min(i + CHUNK_SIZE, total), total };
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    return Array.from(groups.values())
      .filter(g => g.hasRevenue && g.id != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Compute groups using worker or main thread based on data size
  async function computeGroupsAsync(
    records: SalesRecord[],
    mode: 'appId' | 'packageId'
  ): Promise<ProductGroup[]> {
    useWorker = shouldUseWorker(records.length);
    
    if (useWorker) {
      // Use Web Worker for large datasets
      computeProgress = { processed: 0, total: records.length };
      try {
        const result = await computeProductGroups(records, mode);
        computeProgress = { processed: records.length, total: records.length };
        return result;
      } catch (error) {
        console.warn('Worker failed, falling back to main thread:', error);
        // Fall through to main thread computation
      }
    }
    
    // Main thread computation with progress updates
    return computeGroupsMainThread(records, mode);
  }

  // Trigger recomputation when data or groupBy changes
  $effect(() => {
    const records = $salesStore;
    const currentGroupBy = groupBy;
    
    // Check if we need to recompute
    if (records.length === lastComputedDataLength && currentGroupBy === lastComputedGroupBy) {
      return;
    }
    
    // Skip if no data
    if (records.length === 0) {
      computedAppGroups = [];
      computedPackageGroups = [];
      lastComputedDataLength = 0;
      lastComputedGroupBy = currentGroupBy;
      return;
    }
    
    // Start async computation
    isComputing = true;
    computeProgress = { processed: 0, total: records.length };
    
    computeGroupsAsync(records, currentGroupBy).then(groups => {
      if (currentGroupBy === 'appId') {
        computedAppGroups = groups;
      } else {
        computedPackageGroups = groups;
      }
      lastComputedDataLength = records.length;
      lastComputedGroupBy = currentGroupBy;
      isComputing = false;
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
      .filter(r => r.netSalesUsd && r.netSalesUsd > 0)
      .map(r => r.date)
      .sort();
    
    if (datesWithRevenue.length === 0) return { launchDate: null, days: [] };

    const launchDate = datesWithRevenue[0];
    const launchTime = new Date(launchDate).getTime();

    const dayMap = new Map<number, { day: number; date: string; sold: number; returned: number; activated: number; bundle: number; netRevenue: number }>();

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
          netRevenue: 0
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
    const headers = ['Product', idLabel, 'Day', 'Date', 'Units Sold', 'Returns', 'Activations', 'Bundle', 'Net Revenue (USD)'];
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
          day.netRevenue.toFixed(2)
        ]);
      }
    }

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  async function copyAllToClipboard() {
    const csvContent = generateAllCsvContent();
    if (!csvContent) return;

    try {
      await navigator.clipboard.writeText(csvContent);
      copyFeedback = true;
      setTimeout(() => copyFeedback = false, 2000);
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
    link.setAttribute('download', `kim_style_report_${suffix}.csv`);
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
          Kim Style Report
        </h2>
        <p class="text-purple-300 mt-1">
          Product performance from launch day, aggregated by day age
        </p>
      </div>
      
      <div class="flex flex-wrap items-center gap-4">
        <!-- Group By Toggle -->
        <div class="flex items-center gap-2">
          <span class="text-purple-200 text-sm">Group by:</span>
          <div class="flex rounded-lg bg-white/10 p-1">
            <button
              class="px-3 py-1 rounded-md text-sm transition-colors {groupBy === 'appId' 
                ? 'bg-purple-500 text-white' 
                : 'text-purple-300 hover:text-white'}"
              onclick={() => groupBy = 'appId'}
            >
              App ID
            </button>
            <button
              class="px-3 py-1 rounded-md text-sm transition-colors {groupBy === 'packageId' 
                ? 'bg-purple-500 text-white' 
                : 'text-purple-300 hover:text-white'}"
              onclick={() => groupBy = 'packageId'}
            >
              Package ID
            </button>
          </div>
        </div>
        
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
        
        <div class="flex p-[2px] rounded-lg bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500">
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
      <p class="text-purple-300">
        Refresh your sales data to see the Kim Style report.
      </p>
    </div>
  {:else if isComputing}
    <div class="glass-card p-12 text-center">
      <UnicornLoader 
        message={useWorker 
          ? "Processing in background..." 
          : `Processing ${computeProgress.processed.toLocaleString()} of ${computeProgress.total.toLocaleString()} records...`} 
        size="medium" 
      />
      {#if !useWorker}
        <div class="mt-4 w-full max-w-md mx-auto">
          <div class="h-2 bg-white/10 rounded-full overflow-hidden">
            <div 
              class="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 transition-all duration-300"
              style="width: {computeProgress.total > 0 ? (computeProgress.processed / computeProgress.total * 100) : 0}%"
            ></div>
          </div>
        </div>
      {:else}
        <p class="mt-4 text-purple-300 text-sm">Using background worker for better performance</p>
      {/if}
    </div>
  {:else if productGroups.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128269;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Products Found</h3>
      <p class="text-purple-300">
        No products with revenue data were found.
      </p>
    </div>
  {:else}
    <div class="text-purple-300 text-sm flex items-center justify-between">
      <span>
        Showing {visibleProducts.length} of {productGroups.length} {groupBy === 'appId' ? 'app' : 'package'}{productGroups.length === 1 ? '' : 's'} with revenue data
      </span>
      {#if hasMoreProducts}
        <button
          class="text-purple-400 hover:text-purple-200 text-sm underline"
          onclick={loadMore}
        >
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
        {maxDays}
      />
    {/each}
    
    <!-- Infinite scroll trigger -->
    {#if hasMoreProducts}
      <div 
        bind:this={loadMoreRef}
        class="glass-card p-8 text-center"
      >
        <UnicornLoader message="Loading more products..." size="small" />
      </div>
    {/if}
  {/if}
</div>
