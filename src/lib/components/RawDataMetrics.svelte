<script lang="ts">
  import { getGlobalUnitMetrics } from '$lib/db/aggregates';
  import { formatNumber } from '$lib/utils/formatters';
  import { useAsyncData } from '$lib/utils/async-state';

  const { data: metrics, isLoading } = useAsyncData(getGlobalUnitMetrics, {
    onError: (error) => console.error('Error loading global unit metrics:', error),
  });
</script>

<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
  <!-- Total Units Sold -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128722;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Units Sold</p>
      {#if isLoading}
        <div class="h-8 mt-1 flex items-center">
          <div class="h-6 w-20 bg-white/20 rounded animate-pulse"></div>
        </div>
      {:else}
        <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-green-400">
          {formatNumber(metrics?.grossSold ?? 0, { showZero: true })}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">grossUnitsSold</p>
    </div>
  </div>

  <!-- Total Units Returned -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128260;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Units Returned</p>
      {#if isLoading}
        <div class="h-8 mt-1 flex items-center">
          <div class="h-6 w-20 bg-white/20 rounded animate-pulse"></div>
        </div>
      {:else}
        <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-red-400">
          {formatNumber(metrics?.grossReturned ?? 0, { showZero: true })}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">grossUnitsReturned</p>
    </div>
  </div>

  <!-- Total Units Activated -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128273;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Units Activated</p>
      {#if isLoading}
        <div class="h-8 mt-1 flex items-center">
          <div class="h-6 w-20 bg-white/20 rounded animate-pulse"></div>
        </div>
      {:else}
        <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-blue-400">
          {formatNumber(metrics?.grossActivated ?? 0, { showZero: true })}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">grossUnitsActivated</p>
    </div>
  </div>

  <!-- Grand Total -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128202;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Grand Total</p>
      {#if isLoading}
        <div class="h-8 mt-1 flex items-center">
          <div class="h-6 w-24 bg-white/20 rounded animate-pulse"></div>
        </div>
      {:else}
        <p class="text-2xl font-bold font-['Fredoka'] mt-1 rainbow-text">
          {formatNumber(metrics?.grandTotal ?? 0, { showZero: true })}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">sold + activated - returned</p>
    </div>
  </div>
</div>
