<script lang="ts">
  import { onMount } from 'svelte';
  import { filterStore } from '$lib/stores/sales';
  import { getAppAggregates } from '$lib/db/aggregates';
  import { sql } from '$lib/db/sqlite';
  import { getRawUnitMetrics } from '$lib/db/parsed-data';
  import { formatNumber } from '$lib/utils/formatters';
  import ChartsGrid from './ChartsGrid.svelte';
  import SalesTable from './SalesTable.svelte';
  import UnicornLoader from './UnicornLoader.svelte';
  import { ToggleGroup } from './ui';
  import StatCard from './ui/StatCard.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import type { Filters } from '$lib/services/types';
  // Make debug queries available globally in development
  // Access via: window.debugQueries.checkApp(1149000) in browser console
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    import('$lib/scripts/debug-queries-browser').then((debugQueries) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).debugQueries = debugQueries;
      console.log('Debug queries available: window.debugQueries.checkApp(appId)');
    });
  }

  // Use string for selectedId to match HTML select behavior (values are always strings)
  let selectedId = $state<string>('');
  let groupBy = $state<'appId' | 'packageId'>('appId');
  let dataViewTab = $state<'charts' | 'table'>('charts');

  // Pre-computed options loaded once on mount (not reactive to avoid recomputation)
  let appOptions = $state<{ id: string; name: string }[]>([]);
  let packageOptions = $state<{ id: string; name: string }[]>([]);
  let isLoadingData = $state(false);
  let hasData = $state(false);

  // Unit metrics state
  let unitMetrics = $state<{
    grossSold: number;
    grossReturned: number;
    grossActivated: number;
    grandTotal: number;
  } | null>(null);
  let globalUnitMetrics = $state<{
    grossSold: number;
    grossReturned: number;
    grossActivated: number;
    grandTotal: number;
  } | null>(null);
  let isLoadingMetrics = $state(false);

  // Load options from pre-computed aggregates (much faster than scanning all records)
  onMount(async () => {
    isLoadingData = true;
    try {
      // Load app options from pre-computed aggregates
      const appAggregates = await getAppAggregates();
      appOptions = appAggregates
        .filter((a) => a.total_revenue > 0)
        .map((a) => ({ id: String(a.app_id), name: a.app_name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Load package options using SQL (much faster than scanning all records)
      const packageResults = (await sql`
        SELECT DISTINCT packageid, package_name 
        FROM parsed_sales 
        WHERE packageid IS NOT NULL AND packageid > 0
        ORDER BY package_name
      `) as { packageid: number; package_name: string | null }[];

      packageOptions = packageResults.map((r) => ({
        id: String(r.packageid),
        name: r.package_name || `Package ${r.packageid}`,
      }));

      hasData = appOptions.length > 0 || packageOptions.length > 0;
    } catch (error) {
      console.error('Error loading options for package metrics:', error);
    } finally {
      isLoadingData = false;
    }
  });

  // Get the appropriate list based on groupBy (simple lookup, no recomputation)
  const availableOptions = $derived(groupBy === 'appId' ? appOptions : packageOptions);
  const dropdownLabel = $derived(groupBy === 'appId' ? 'App' : 'Package');
  const placeholderText = $derived(
    groupBy === 'appId' ? 'Select an app...' : 'Select a package...'
  );

  // Handle groupBy changes - reset selection and update filter
  function handleGroupByChange(newGroupBy: 'appId' | 'packageId') {
    groupBy = newGroupBy;
    selectedId = '';
    filterStore.setImmediate({});
  }

  // Handle selection changes - update filter
  function handleSelectionChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const newValue = select.value;

    // Explicitly update selectedId (don't rely solely on bind:value)
    selectedId = newValue;

    // Update filter based on selection
    const filters: Filters = {};
    let numericId: number | undefined;
    if (newValue !== '') {
      numericId = parseInt(newValue, 10);
      if (!isNaN(numericId)) {
        if (groupBy === 'appId') {
          filters.appIds = [numericId];
        } else {
          filters.packageIds = [numericId];
        }
      }
    }
    filterStore.setImmediate(filters);
  }

  // Load unit metrics based on current filters
  async function loadUnitMetrics() {
    isLoadingMetrics = true;
    try {
      const currentFilters = $filterStore;
      const metrics = await getRawUnitMetrics(currentFilters);

      unitMetrics = {
        grossSold: metrics.grossSold,
        grossReturned: metrics.grossReturned,
        grossActivated: metrics.grossActivated,
        grandTotal: metrics.grandTotal,
      };
    } catch (error) {
      console.error('Error loading unit metrics:', error);
      unitMetrics = null;
    } finally {
      isLoadingMetrics = false;
    }
  }

  // Load global totals when component mounts (for when no selection is made)
  onMount(async () => {
    // Load global metrics initially
    try {
      const globalMetrics = await getRawUnitMetrics();
      globalUnitMetrics = {
        grossSold: globalMetrics.grossSold,
        grossReturned: globalMetrics.grossReturned,
        grossActivated: globalMetrics.grossActivated,
        grandTotal: globalMetrics.grandTotal,
      };
    } catch (error) {
      console.error('Error loading global unit metrics:', error);
    }
  });

  // React to filter changes
  $effect(() => {
    $filterStore;
    if (selectedId !== '') {
      loadUnitMetrics();
    }
  });

  // Determine which metrics to show
  let unitMetricsToShow = $derived(selectedId !== '' ? unitMetrics : globalUnitMetrics);
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
          onchange={(v) => handleGroupByChange(v as 'appId' | 'packageId')}
        />

        <!-- Selection Dropdown -->
        <div class="flex items-center gap-2">
          <span class="text-purple-200 text-sm whitespace-nowrap">{dropdownLabel}:</span>
          <select
            bind:value={selectedId}
            onchange={handleSelectionChange}
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

  {#if isLoadingData}
    <div class="glass-card p-12 text-center">
      <UnicornLoader message="Loading package metrics..." />
    </div>
  {:else if !hasData}
    <EmptyState
      icon="&#128202;"
      title="No Data Available"
      message="Refresh your sales data to see package metrics."
    />
  {:else}
    <!-- Unit Metrics Bubbles (show global or filtered metrics) -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon="&#128722;"
        label="Units Sold"
        value={formatNumber(unitMetricsToShow?.grossSold ?? 0, { showZero: true })}
        colorClass="text-green-400"
        isLoading={isLoadingMetrics && selectedId !== ''}
      />

      <StatCard
        icon="&#128260;"
        label="Units Returned"
        value={formatNumber(unitMetricsToShow?.grossReturned ?? 0, { showZero: true })}
        colorClass="text-red-400"
        isLoading={isLoadingMetrics && selectedId !== ''}
      />

      <StatCard
        icon="&#128273;"
        label="Units Activated"
        value={formatNumber(unitMetricsToShow?.grossActivated ?? 0, { showZero: true })}
        colorClass="text-blue-400"
        isLoading={isLoadingMetrics && selectedId !== ''}
      />

      <StatCard
        icon="&#128202;"
        label="Grand Total"
        value={formatNumber(unitMetricsToShow?.grandTotal ?? 0, { showZero: true })}
        colorClass="rainbow-text"
        isLoading={isLoadingMetrics && selectedId !== ''}
      />
    </div>

    {#if selectedId === ''}
      <!-- Show app breakdown when no selection is made -->
      <div class="glass-card p-6">
        <h3 class="text-lg font-bold font-['Fredoka'] mb-4 flex items-center gap-2">
          <span class="text-2xl">&#128200;</span>
          App Breakdown
        </h3>
        <p class="text-purple-300 mb-4">
          Select an app from the dropdown above to view detailed metrics, or choose a package to
          analyze package-level data.
        </p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {#each appOptions as app (app.id)}
            <div class="bg-white/5 rounded-lg p-3">
              <h4 class="font-semibold text-purple-200">{app.name}</h4>
              <p class="text-sm text-purple-400">App ID: {app.id}</p>
            </div>
          {/each}
        </div>
      </div>
    {:else}
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
        <!-- Charts Grid (shared component) -->
        <ChartsGrid filterPreLaunch={false} showSkuComparison={false} />
      {:else}
        <!-- Data Table -->
        <SalesTable />
      {/if}
    {/if}
  {/if}
</div>
