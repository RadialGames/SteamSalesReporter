<script lang="ts">
  import RevenueChart from './RevenueChart.svelte';
  import SkuComparison from './SkuComparison.svelte';
  import CountryChart from './CountryChart.svelte';

  interface Props {
    /** Filter out data points before first sale (launch day) */
    filterPreLaunch?: boolean;
    /** Whether to show the SKU/Product comparison chart */
    showSkuComparison?: boolean;
  }

  let { filterPreLaunch = false, showSkuComparison = true }: Props = $props();
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <!-- Revenue Over Time (Full Width on mobile, half on desktop) -->
  <div class="lg:col-span-2">
    <RevenueChart {filterPreLaunch} />
  </div>

  {#if showSkuComparison}
    <!-- SKU Comparison -->
    <div>
      <SkuComparison />
    </div>
  {/if}

  <!-- Country Breakdown -->
  <div>
    <CountryChart />
  </div>
</div>
