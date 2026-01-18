<script lang="ts">
  import { salesStore } from '$lib/stores/sales';
  import ProductLaunchTable from './ProductLaunchTable.svelte';
  import type { SalesRecord } from '$lib/services/types';

  let maxDays = $state(60);
  let copyFeedback = $state(false);

  // Group records by appId and get unique products with their data
  const productGroups = $derived(() => {
    const groups = new Map<number, { appId: number; appName: string; records: SalesRecord[]; hasRevenue: boolean }>();
    
    for (const record of $salesStore) {
      if (!groups.has(record.appId)) {
        groups.set(record.appId, {
          appId: record.appId,
          appName: record.appName || `App ${record.appId}`,
          records: [],
          hasRevenue: false
        });
      }
      
      const group = groups.get(record.appId)!;
      group.records.push(record);
      
      // Track if this product has any revenue (needed to determine launch date)
      if (record.netSalesUsd && record.netSalesUsd > 0) {
        group.hasRevenue = true;
      }
    }
    
    // Only include products that have at least one record with revenue (to determine launch date)
    // Sort by app name
    return Array.from(groups.values())
      .filter(g => g.hasRevenue)
      .sort((a, b) => a.appName.localeCompare(b.appName));
  });

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
    const products = productGroups();
    if (products.length === 0) return '';

    const headers = ['Product', 'App ID', 'Day', 'Date', 'Units Sold', 'Returns', 'Activations', 'Bundle', 'Net Revenue (USD)'];
    const rows: string[][] = [];

    for (const product of products) {
      const { days } = calculateProductDays(product.records, maxDays);
      for (const day of days) {
        rows.push([
          `"${product.appName.replace(/"/g, '""')}"`,
          product.appId.toString(),
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
    link.setAttribute('download', `kim_style_report_all_products.csv`);
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
              disabled={productGroups().length === 0}
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
              disabled={productGroups().length === 0}
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
  {:else if productGroups().length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128269;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Products Found</h3>
      <p class="text-purple-300">
        No products with revenue data were found.
      </p>
    </div>
  {:else}
    <div class="text-purple-300 text-sm">
      Showing {productGroups().length} product{productGroups().length === 1 ? '' : 's'} with revenue data
    </div>
    
    <!-- Product Tables -->
    {#each productGroups() as product (product.appId)}
      <ProductLaunchTable 
        appId={product.appId}
        appName={product.appName}
        records={product.records}
        {maxDays}
      />
    {/each}
  {/if}
</div>
