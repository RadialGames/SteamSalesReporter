<script lang="ts">
  import { onMount } from 'svelte';
  import { filterStore } from '$lib/stores/sales';
  import type { Filters } from '$lib/services/types';
  import {
    getUniqueApps,
    getUniqueCountries,
    getDateRange,
    getUniqueApiKeyIds,
  } from '$lib/db/parsed-data';

  // Load unique values from database
  let uniqueApps = $state<{ appId: number; appName: string }[]>([]);
  let uniqueCountries = $state<string[]>([]);
  let uniqueApiKeys = $state<string[]>([]);
  let dateRange = $state<{ min: string; max: string }>({ min: '', max: '' });

  onMount(async () => {
    // Load unique values from database using SQL queries
    uniqueApps = await getUniqueApps();
    uniqueCountries = await getUniqueCountries();
    uniqueApiKeys = await getUniqueApiKeyIds();

    // Get date range
    const range = await getDateRange();
    if (range) {
      dateRange = range;
    }
  });

  let startDate = $state('');
  let endDate = $state('');
  let selectedAppId = $state<number | ''>('');
  let selectedCountry = $state('');
  let selectedApiKey = $state('');

  function applyFilters() {
    const filters: Filters = {};

    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (selectedAppId !== '') filters.appIds = [selectedAppId as number];
    if (selectedCountry) filters.countryCode = selectedCountry;
    if (selectedApiKey) filters.apiKeyIds = [selectedApiKey];

    filterStore.set(filters);
  }

  function clearFilters() {
    startDate = '';
    endDate = '';
    selectedAppId = '';
    selectedCountry = '';
    selectedApiKey = '';
    filterStore.set({});
  }

  // Auto-apply filters when values change
  $effect(() => {
    applyFilters();
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

    {#if uniqueApps.length > 1}
      <div class="flex items-center gap-2">
        <span class="text-purple-300 text-sm font-medium">&#127918; Product:</span>
        <select bind:value={selectedAppId} class="input-magic text-sm py-1 px-2 min-w-[150px]">
          <option value="">All Products</option>
          {#each uniqueApps as app (app.appId)}
            <option value={app.appId}>{app.appName}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if uniqueCountries.length > 1}
      <div class="flex items-center gap-2">
        <span class="text-purple-300 text-sm font-medium">&#127758; Country:</span>
        <select bind:value={selectedCountry} class="input-magic text-sm py-1 px-2 min-w-[120px]">
          <option value="">All Countries</option>
          {#each uniqueCountries as country (country)}
            <option value={country}>{country}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if uniqueApiKeys.length > 1}
      <div class="flex items-center gap-2">
        <span class="text-purple-300 text-sm font-medium">&#128273; API Key:</span>
        <select bind:value={selectedApiKey} class="input-magic text-sm py-1 px-2 min-w-[100px]">
          <option value="">All Keys</option>
          {#each uniqueApiKeys as apiKey (apiKey)}
            <option value={apiKey}>{apiKey}</option>
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
