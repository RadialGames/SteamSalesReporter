<script lang="ts">
  import { onMount } from 'svelte';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { statsStore, filterStore, databaseLoaded } from '$lib/stores/sqlite-stores';
  import StatCard from './ui/StatCard.svelte';

  // Access nested stores
  const loadingStore = statsStore.loading;
  const errorStore = statsStore.error;

  onMount(async () => {
    // Only load if database is confirmed to exist
    if ($databaseLoaded) {
      await statsStore.load($filterStore);
    }
  });

  // React to filter changes - only if database is loaded
  $effect(() => {
    const filters = $filterStore;
    if ($databaseLoaded) {
      statsStore.load(filters);
    }
  });
</script>

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
  {#if $loadingStore}
    <div class="col-span-full text-center text-purple-300">Loading stats...</div>
  {:else if $errorStore}
    <div class="col-span-full text-center text-red-400">Error: {$errorStore}</div>
  {:else if $statsStore}
    <StatCard
      icon="&#128176;"
      label="Total Revenue"
      value={formatCurrency($statsStore.totalRevenue || 0, { compact: true })}
      colorClass="rainbow-text"
    />

    <StatCard
      icon="&#128230;"
      label="Units Sold"
      value={formatNumber($statsStore.totalUnits || 0, { showZero: true })}
      colorClass="text-pink-400"
    />

    <StatCard
      icon="&#127918;"
      label="Products"
      value={formatNumber($statsStore.appCount || 0, { showZero: true })}
      colorClass="text-blue-400"
    />

    <StatCard
      icon="&#127758;"
      label="Countries"
      value={formatNumber($statsStore.countryCount || 0, { showZero: true })}
      colorClass="text-green-400"
    />

    <StatCard
      icon="&#128202;"
      label="Data Records"
      value={formatNumber($statsStore.recordCount || 0, { showZero: true })}
      colorClass="text-yellow-400"
    />
  {/if}
</div>
