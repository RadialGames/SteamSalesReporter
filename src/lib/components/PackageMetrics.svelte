<script lang="ts">
  import { salesStore, filterStore } from '$lib/stores/sales';
  import StatsCards from './StatsCards.svelte';
  import RevenueChart from './RevenueChart.svelte';
  import SkuComparison from './SkuComparison.svelte';
  import CountryChart from './CountryChart.svelte';
  import SalesTable from './SalesTable.svelte';
  import type { Filters } from '$lib/services/types';

  let selectedPackageId = $state<number | ''>('');
  let groupBy = $state<'appId' | 'packageId'>('appId');
  let dataViewTab = $state<'charts' | 'table'>('charts');

  // Get unique packages from sales data
  const uniquePackages = $derived.by(() => {
    const packages = new Map<number, string>();
    for (const sale of $salesStore) {
      if (sale.packageid && !packages.has(sale.packageid)) {
        packages.set(sale.packageid, sale.packageName || `Package ${sale.packageid}`);
      }
    }
    return Array.from(packages.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Apply package filter when selection changes
  $effect(() => {
    const filters: Filters = {};
    
    if (selectedPackageId !== '') {
      filters.packageIds = [selectedPackageId as number];
    }
    
    filterStore.setImmediate(filters);
  });

  // Reset selection when packages list changes (e.g., after data refresh)
  $effect(() => {
    if (selectedPackageId !== '' && !uniquePackages.some(p => p.id === selectedPackageId)) {
      selectedPackageId = '';
    }
  });
</script>

<div class="space-y-6">
  <!-- Header and Controls -->
  <div class="glass-card p-6">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
      <div>
        <h2 class="text-2xl font-bold font-['Fredoka'] flex items-center gap-2">
          <span class="text-3xl">&#128202;</span>
          Package Metrics
        </h2>
        <p class="text-purple-300 mt-1">
          View sales data and metrics for a specific package
        </p>
      </div>
      
      <div class="flex flex-wrap items-center gap-4">
        <!-- Package Selection -->
        <div class="flex items-center gap-2">
          <span class="text-purple-200 text-sm whitespace-nowrap">Package:</span>
          <select
            bind:value={selectedPackageId}
            class="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white 
                   focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                   min-w-[200px]"
          >
            <option value="">Select a package...</option>
            {#each uniquePackages as pkg}
              <option value={pkg.id}>{pkg.name}</option>
            {/each}
          </select>
        </div>

        <!-- Group By Toggle -->
        {#if selectedPackageId !== ''}
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
        {/if}
      </div>
    </div>
  </div>

  {#if $salesStore.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128202;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Data Available</h3>
      <p class="text-purple-300">
        Refresh your sales data to see package metrics.
      </p>
    </div>
  {:else if selectedPackageId === ''}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128270;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">Select a Package</h3>
      <p class="text-purple-300">
        Choose a package from the dropdown above to view its metrics.
      </p>
    </div>
  {:else}
    <!-- Stats Overview -->
    <StatsCards />

    <!-- Data View Tab Navigation -->
    <div class="flex gap-2">
      <button
        class="px-4 py-2 rounded-lg font-semibold transition-all {dataViewTab === 'charts' 
          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' 
          : 'bg-white/10 text-purple-200 hover:bg-white/20'}"
        onclick={() => dataViewTab = 'charts'}
      >
        <span class="mr-2">&#128200;</span>
        Charts
      </button>
      <button
        class="px-4 py-2 rounded-lg font-semibold transition-all {dataViewTab === 'table' 
          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' 
          : 'bg-white/10 text-purple-200 hover:bg-white/20'}"
        onclick={() => dataViewTab = 'table'}
      >
        <span class="mr-2">&#128203;</span>
        Data Table
      </button>
    </div>

    {#if dataViewTab === 'charts'}
      <!-- Charts Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Revenue Over Time (Full Width on mobile, half on desktop) -->
        <div class="lg:col-span-2">
          <RevenueChart />
        </div>

        <!-- SKU Comparison -->
        <div>
          <SkuComparison />
        </div>

        <!-- Country Breakdown -->
        <div>
          <CountryChart />
        </div>
      </div>
    {:else}
      <!-- Data Table -->
      <SalesTable />
    {/if}
  {/if}
</div>
