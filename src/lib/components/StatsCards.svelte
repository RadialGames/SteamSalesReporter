<script lang="ts">
  import { onMount } from 'svelte';
  import { getDisplayCache } from '$lib/db/display-cache';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { filterStore } from '$lib/stores/sales';
  import { computeFilteredStats } from '$lib/db/parsed-data';
  import StatCard from './ui/StatCard.svelte';

  interface DashboardStats {
    totalRevenue: number;
    totalUnits: number;
    totalRecords: number;
    uniqueApps: number;
    uniqueCountries: number;
  }

  let stats = $state<DashboardStats>({
    totalRevenue: 0,
    totalUnits: 0,
    totalRecords: 0,
    uniqueApps: 0,
    uniqueCountries: 0,
  });

  // Track loading state (prefixed with _ since we set it but don't display it)
  let _isLoading = $state(false);

  // Load stats based on current filters
  async function loadStats() {
    _isLoading = true;
    try {
      const currentFilters = $filterStore;

      // Check if filters are empty - if so, use cached stats for performance
      const hasFilters =
        (currentFilters.appIds && currentFilters.appIds.length > 0) ||
        (currentFilters.packageIds && currentFilters.packageIds.length > 0) ||
        currentFilters.countryCode ||
        currentFilters.startDate ||
        currentFilters.endDate ||
        (currentFilters.apiKeyIds && currentFilters.apiKeyIds.length > 0);

      if (!hasFilters) {
        // No filters - load from display cache
        const cached = await getDisplayCache<DashboardStats>('dashboard_stats');
        if (cached) {
          stats = cached;
          return;
        }
      }

      // Has filters - compute stats from filtered records
      const computedStats = await computeFilteredStats(currentFilters);
      stats = computedStats;
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      _isLoading = false;
    }
  }

  onMount(async () => {
    await loadStats();
  });

  // React to filter changes
  $effect(() => {
    $filterStore;
    loadStats();
  });
</script>

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
  <StatCard
    icon="&#128176;"
    label="Total Revenue"
    value={formatCurrency(stats.totalRevenue, { compact: true })}
    colorClass="rainbow-text"
  />

  <StatCard
    icon="&#128230;"
    label="Units Sold"
    value={formatNumber(stats.totalUnits, { showZero: true })}
    colorClass="text-pink-400"
  />

  <StatCard
    icon="&#127918;"
    label="Products"
    value={formatNumber(stats.uniqueApps, { showZero: true })}
    colorClass="text-blue-400"
  />

  <StatCard
    icon="&#127758;"
    label="Countries"
    value={formatNumber(stats.uniqueCountries, { showZero: true })}
    colorClass="text-green-400"
  />

  <StatCard
    icon="&#128202;"
    label="Data Records"
    value={formatNumber(stats.totalRecords, { showZero: true })}
    colorClass="text-yellow-400"
  />
</div>
