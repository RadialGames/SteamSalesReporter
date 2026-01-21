<script lang="ts">
  import { getDatabaseStats, downloadDatabaseFile } from '$lib/db/sqlite';
  import { formatNumber } from '$lib/utils/formatters';
  import { useAsyncData } from '$lib/utils/async-state';

  let isExporting = $state(false);

  const { data: stats, isLoading } = useAsyncData(getDatabaseStats, {
    onError: (error: Error) => console.error('Error loading database stats:', error),
  });

  async function handleExportDb() {
    isExporting = true;
    try {
      await downloadDatabaseFile();
    } catch (error) {
      console.error('Error exporting database:', error);
    } finally {
      isExporting = false;
    }
  }
</script>

<div class="glass-card p-4">
  <div class="flex items-center gap-2 mb-3">
    <span class="text-xl">&#128451;</span>
    <h3 class="text-sm font-semibold text-purple-200">Database Statistics</h3>
    {#if isLoading}
      <span class="text-xs text-purple-400 animate-pulse">Loading...</span>
    {/if}
  </div>

  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 text-center">
    <!-- Raw API Data -->
    <div class="bg-white/5 rounded-lg p-2">
      {#if isLoading}
        <div class="h-5 w-12 mx-auto bg-white/20 rounded animate-pulse"></div>
      {:else}
        <p class="text-lg font-bold text-orange-400">
          {formatNumber(stats?.rawApiData ?? 0)}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">Raw API</p>
    </div>

    <!-- Parsed Sales -->
    <div class="bg-white/5 rounded-lg p-2">
      {#if isLoading}
        <div class="h-5 w-12 mx-auto bg-white/20 rounded animate-pulse"></div>
      {:else}
        <p class="text-lg font-bold text-green-400">
          {formatNumber(stats?.parsedSales ?? 0)}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">Parsed Sales</p>
    </div>

    <!-- Daily Aggregates -->
    <div class="bg-white/5 rounded-lg p-2">
      {#if isLoading}
        <div class="h-5 w-12 mx-auto bg-white/20 rounded animate-pulse"></div>
      {:else}
        <p class="text-lg font-bold text-blue-400">
          {formatNumber(stats?.dailyAggregates ?? 0)}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">Daily Agg</p>
    </div>

    <!-- App Aggregates -->
    <div class="bg-white/5 rounded-lg p-2">
      {#if isLoading}
        <div class="h-5 w-12 mx-auto bg-white/20 rounded animate-pulse"></div>
      {:else}
        <p class="text-lg font-bold text-pink-400">
          {formatNumber(stats?.appAggregates ?? 0)}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">App Agg</p>
    </div>

    <!-- Country Aggregates -->
    <div class="bg-white/5 rounded-lg p-2">
      {#if isLoading}
        <div class="h-5 w-12 mx-auto bg-white/20 rounded animate-pulse"></div>
      {:else}
        <p class="text-lg font-bold text-cyan-400">
          {formatNumber(stats?.countryAggregates ?? 0)}
        </p>
      {/if}
      <p class="text-xs text-purple-400 mt-1">Country Agg</p>
    </div>
  </div>

  <!-- Total row count and export button -->
  {#if !isLoading && stats}
    <div class="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
      <span class="text-xs text-purple-400">
        Total rows: <span class="text-purple-200 font-semibold"
          >{formatNumber(stats.totalRows)}</span
        >
      </span>
      <button
        onclick={handleExportDb}
        disabled={isExporting}
        class="text-xs px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        title="Export database for CLI debugging"
      >
        {#if isExporting}
          <span class="animate-spin">&#8635;</span>
          Exporting...
        {:else}
          <span>&#128190;</span>
          Export for CLI
        {/if}
      </button>
    </div>
  {/if}
</div>
