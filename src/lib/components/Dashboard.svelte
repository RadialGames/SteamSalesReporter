<script lang="ts">
  import StatsCards from './StatsCards.svelte';
  import FilterBar from './FilterBar.svelte';
  import RevenueChart from './RevenueChart.svelte';
  import SkuComparison from './SkuComparison.svelte';
  import CountryChart from './CountryChart.svelte';
  import SalesTable from './SalesTable.svelte';
  import LaunchComparison from './LaunchComparison.svelte';
  import PackageMetrics from './PackageMetrics.svelte';
  import { salesStore } from '$lib/stores/sales';
  import type { ApiKeyInfo } from '$lib/services/types';

  interface Props {
    apiKeys?: ApiKeyInfo[];
  }

  let { apiKeys = [] }: Props = $props();

  let topLevelTab = $state<'dataView' | 'launchComparison' | 'packageMetrics'>('dataView');
  let dataViewTab = $state<'charts' | 'table'>('charts');
</script>

<div class="space-y-6">
  {#if $salesStore.length === 0}
    <!-- Welcome State - Only unicorn bubble when no data (no tabs shown) -->
    <div class="glass-card p-12 text-center">
      <div class="text-8xl mb-4 unicorn-bounce inline-block">&#129412;</div>
      <h2 class="text-2xl font-bold font-['Fredoka'] mb-2 rainbow-text">
        {apiKeys.length === 0 ? 'Welcome to Steam Sales Analyzer!' : 'Ready to Analyze Your Sales!'}
      </h2>
      <p class="text-purple-200 mb-6 max-w-md mx-auto">
        {#if apiKeys.length === 0}
          Get started by clicking the <strong>"Settings"</strong> button above to add your Steam API key. 
          Once configured, you'll be able to fetch and analyze your sales data.
        {:else}
          Click the <strong>"Refresh Data"</strong> button above to fetch your Steam sales data 
          and start exploring your financial analytics.
        {/if}
      </p>
      <div class="flex justify-center gap-2 flex-wrap">
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Revenue tracking
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Product comparison
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Geographic insights
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Historical trends
        </div>
      </div>
    </div>
  {:else}
    <!-- Top Level Tab Navigation (only shown when data exists) -->
    <div class="flex gap-2 border-b border-white/10 pb-4">
      <button
        class="px-6 py-3 rounded-t-lg font-bold text-lg transition-all {topLevelTab === 'dataView' 
          ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' 
          : 'bg-white/5 text-purple-300 hover:bg-white/10'}"
        onclick={() => topLevelTab = 'dataView'}
      >
        <span class="mr-2">&#128202;</span>
        Data View
      </button>
      <button
        class="px-6 py-3 rounded-t-lg font-bold text-lg transition-all {topLevelTab === 'launchComparison' 
          ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' 
          : 'bg-white/5 text-purple-300 hover:bg-white/10'}"
        onclick={() => topLevelTab = 'launchComparison'}
      >
        <span class="mr-2">&#128640;</span>
        Launch Comparison
      </button>
      <button
        class="px-6 py-3 rounded-t-lg font-bold text-lg transition-all {topLevelTab === 'packageMetrics' 
          ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' 
          : 'bg-white/5 text-purple-300 hover:bg-white/10'}"
        onclick={() => topLevelTab = 'packageMetrics'}
      >
        <span class="mr-2">&#128202;</span>
        Package Metrics
      </button>
    </div>

    {#if topLevelTab === 'dataView'}
      <!-- Stats Overview -->
      <StatsCards />

      <!-- Filter Bar -->
      <FilterBar />

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
    {:else if topLevelTab === 'launchComparison'}
      <!-- Launch Comparison -->
      <LaunchComparison />
    {:else if topLevelTab === 'packageMetrics'}
      <!-- Package Metrics -->
      <PackageMetrics />
    {/if}
  {/if}
</div>
