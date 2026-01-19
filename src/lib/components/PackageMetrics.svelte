<script lang="ts">
  import { salesStore, filterStore } from '$lib/stores/sales';
  import StatsCards from './StatsCards.svelte';
  import RevenueChart from './RevenueChart.svelte';
  import SkuComparison from './SkuComparison.svelte';
  import CountryChart from './CountryChart.svelte';
  import SalesTable from './SalesTable.svelte';
  import { ToggleGroup } from './ui';
  import type { Filters } from '$lib/services/types';

  let selectedId = $state<number | ''>('');
  let groupBy = $state<'appId' | 'packageId'>('appId');
  let dataViewTab = $state<'charts' | 'table'>('charts');

  // Get unique apps from sales data (only those with revenue)
  const uniqueApps = $derived.by(() => {
    const apps = new Map<number, { name: string; revenue: number }>();
    for (const sale of $salesStore) {
      const revenue = sale.netSalesUsd ?? 0;
      if (revenue > 0) {
        const existing = apps.get(sale.appId);
        if (existing) {
          existing.revenue += revenue;
        } else {
          apps.set(sale.appId, {
            name: sale.appName || `App ${sale.appId}`,
            revenue: revenue,
          });
        }
      }
    }
    return Array.from(apps.entries())
      .map(([id, data]) => ({ id, name: data.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Get unique packages from sales data (only those with revenue)
  const uniquePackages = $derived.by(() => {
    const packages = new Map<number, { name: string; revenue: number }>();
    for (const sale of $salesStore) {
      if (sale.packageid) {
        const revenue = sale.netSalesUsd ?? 0;
        if (revenue > 0) {
          const existing = packages.get(sale.packageid);
          if (existing) {
            existing.revenue += revenue;
          } else {
            packages.set(sale.packageid, {
              name: sale.packageName || `Package ${sale.packageid}`,
              revenue: revenue,
            });
          }
        }
      }
    }
    return Array.from(packages.entries())
      .map(([id, data]) => ({ id, name: data.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // Get the appropriate list based on groupBy
  const availableOptions = $derived(groupBy === 'appId' ? uniqueApps : uniquePackages);
  const dropdownLabel = $derived(groupBy === 'appId' ? 'App' : 'Package');
  const placeholderText = $derived(
    groupBy === 'appId' ? 'Select an app...' : 'Select a package...'
  );

  // Reset selection when groupBy changes
  $effect(() => {
    const _ = groupBy;
    selectedId = '';
  });

  // Apply filter when selection or groupBy changes
  $effect(() => {
    const filters: Filters = {};

    if (selectedId !== '') {
      if (groupBy === 'appId') {
        filters.appIds = [selectedId as number];
      } else {
        filters.packageIds = [selectedId as number];
      }
    }

    filterStore.setImmediate(filters);
  });

  // Reset selection when options list changes (e.g., after data refresh)
  $effect(() => {
    if (selectedId !== '' && !availableOptions.some((opt) => opt.id === selectedId)) {
      selectedId = '';
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
          View sales data and metrics for a specific app or package
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

        <!-- Selection Dropdown -->
        <div class="flex items-center gap-2">
          <span class="text-purple-200 text-sm whitespace-nowrap">{dropdownLabel}:</span>
          <select
            bind:value={selectedId}
            class="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white
                   focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
                   min-w-[200px]"
          >
            <option value="">{placeholderText}</option>
            {#each availableOptions as option (option.id)}
              <option value={option.id}>{option.name}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>
  </div>

  {#if $salesStore.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128202;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">No Data Available</h3>
      <p class="text-purple-300">Refresh your sales data to see package metrics.</p>
    </div>
  {:else if selectedId === ''}
    <div class="glass-card p-12 text-center">
      <div class="text-6xl mb-4">&#128270;</div>
      <h3 class="text-xl font-bold text-purple-200 mb-2">
        Select {groupBy === 'appId' ? 'an App' : 'a Package'}
      </h3>
      <p class="text-purple-300">
        Choose {groupBy === 'appId' ? 'an app' : 'a package'} from the dropdown above to view its metrics.
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
        onclick={() => (dataViewTab = 'charts')}
      >
        <span class="mr-2">&#128200;</span>
        Charts
      </button>
      <button
        class="px-4 py-2 rounded-lg font-semibold transition-all {dataViewTab === 'table'
          ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30'
          : 'bg-white/10 text-purple-200 hover:bg-white/20'}"
        onclick={() => (dataViewTab = 'table')}
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
