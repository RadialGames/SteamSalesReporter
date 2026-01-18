<script lang="ts">
  import StatsCards from './StatsCards.svelte';
  import FilterBar from './FilterBar.svelte';
  import RevenueChart from './RevenueChart.svelte';
  import SkuComparison from './SkuComparison.svelte';
  import CountryChart from './CountryChart.svelte';
  import SalesTable from './SalesTable.svelte';
  import { salesStore } from '$lib/stores/sales';

  let activeTab = $state<'charts' | 'table'>('charts');
</script>

<div class="space-y-6">
  <!-- Stats Overview -->
  <StatsCards />

  <!-- Filter Bar -->
  {#if $salesStore.length > 0}
    <FilterBar />
  {/if}

  <!-- Tab Navigation -->
  <div class="flex gap-2">
    <button
      class="px-4 py-2 rounded-lg font-semibold transition-all {activeTab === 'charts' 
        ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' 
        : 'bg-white/10 text-purple-200 hover:bg-white/20'}"
      onclick={() => activeTab = 'charts'}
    >
      <span class="mr-2">&#128200;</span>
      Charts
    </button>
    <button
      class="px-4 py-2 rounded-lg font-semibold transition-all {activeTab === 'table' 
        ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' 
        : 'bg-white/10 text-purple-200 hover:bg-white/20'}"
      onclick={() => activeTab = 'table'}
    >
      <span class="mr-2">&#128203;</span>
      Data Table
    </button>
  </div>

  {#if activeTab === 'charts'}
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

  <!-- Empty State -->
  {#if $salesStore.length === 0}
    <div class="glass-card p-12 text-center">
      <div class="text-8xl mb-4 unicorn-bounce inline-block">&#129412;</div>
      <h2 class="text-2xl font-bold font-['Fredoka'] mb-2 rainbow-text">
        Ready to Analyze Your Sales!
      </h2>
      <p class="text-purple-200 mb-6 max-w-md mx-auto">
        Click the <strong>"Refresh Data"</strong> button above to fetch your Steam sales data 
        and start exploring your financial analytics.
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
  {/if}
</div>
