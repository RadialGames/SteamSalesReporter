<script lang="ts">
  import { onMount } from 'svelte';
  import { filterStore, lookupsStore, statsStore, databaseLoaded } from '$lib/stores/sqlite-stores';
  import type { Filters } from '$lib/stores/sqlite-stores';

  // Access nested stores
  const appsStore = lookupsStore.apps;
  const countriesStore = lookupsStore.countries;

  onMount(async () => {
    // Only load if database is confirmed to exist
    if ($databaseLoaded) {
      await lookupsStore.loadAll();
    }
  });

  let startDate = $state('');
  let endDate = $state('');
  let selectedAppId = $state<number | ''>('');
  let selectedCountry = $state('');

  // Get date range from stats if available
  let dateRange = $state<{ min: string; max: string }>({ min: '', max: '' });

  function applyFilters() {
    const filters: Filters = {};

    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (selectedAppId !== '') filters.appIds = [selectedAppId as number];
    if (selectedCountry) filters.countryCode = selectedCountry;

    filterStore.set(filters);
  }

  function clearFilters() {
    startDate = '';
    endDate = '';
    selectedAppId = '';
    selectedCountry = '';
    filterStore.clear();
  }

  // Auto-apply filters when values change
  $effect(() => {
    applyFilters();
  });

  // Update date range when stats are available
  $effect(() => {
    const stats = $statsStore;
    if (stats?.dateRange) {
      dateRange = stats.dateRange;
    }
  });
</script>

<div class="glass-card p-4">
  <div class="flex flex-wrap items-center gap-4">
    <div class="flex items-center gap-2">
      <span class="text-purple-300 text-sm font-medium">&#128197; Date Range:</span>
      <input
        type="date"
        bind:value={startDate}
        min={dateRange.min}
        max={dateRange.max}
        class="input-magic text-sm py-1 px-2"
        placeholder="Start"
      />
      <span class="text-purple-400">to</span>
      <input
        type="date"
        bind:value={endDate}
        min={dateRange.min}
        max={dateRange.max}
        class="input-magic text-sm py-1 px-2"
        placeholder="End"
      />
    </div>

    {#if $appsStore.length > 1}
      <div class="flex items-center gap-2">
        <span class="text-purple-300 text-sm font-medium">&#127918; Product:</span>
        <select bind:value={selectedAppId} class="input-magic text-sm py-1 px-2 min-w-[150px]">
          <option value="">All Products</option>
          {#each $appsStore as app (app.appId)}
            <option value={app.appId}>{app.appName}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if $countriesStore.length > 1}
      <div class="flex items-center gap-2">
        <span class="text-purple-300 text-sm font-medium">&#127758; Country:</span>
        <select bind:value={selectedCountry} class="input-magic text-sm py-1 px-2 min-w-[120px]">
          <option value="">All Countries</option>
          {#each $countriesStore as country (country.countryCode)}
            <option value={country.countryCode}>{country.countryName}</option>
          {/each}
        </select>
      </div>
    {/if}

    <button class="btn-primary text-sm py-1 px-3 flex items-center gap-1" onclick={clearFilters}>
      <span>&#10006;</span>
      Clear Filters
    </button>
  </div>
</div>
