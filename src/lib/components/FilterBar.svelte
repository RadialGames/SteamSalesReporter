<script lang="ts">
  import { filterStore, salesStore } from '$lib/stores/sales';
  import type { Filters } from '$lib/services/types';

  // Get unique values from sales data
  const uniqueApps = $derived(() => {
    const apps = new Map<number, string>();
    for (const sale of $salesStore) {
      if (!apps.has(sale.appId)) {
        apps.set(sale.appId, sale.appName || `App ${sale.appId}`);
      }
    }
    return Array.from(apps.entries()).map(([id, name]) => ({ id, name }));
  });

  const uniqueCountries = $derived(() => {
    const countries = new Set<string>();
    for (const sale of $salesStore) {
      countries.add(sale.countryCode);
    }
    return Array.from(countries).sort();
  });

  const dateRange = $derived(() => {
    if ($salesStore.length === 0) return { min: '', max: '' };
    const dates = $salesStore.map(s => s.date).sort();
    return { min: dates[0], max: dates[dates.length - 1] };
  });

  let startDate = $state('');
  let endDate = $state('');
  let selectedAppId = $state<number | ''>('');
  let selectedCountry = $state('');

  function applyFilters() {
    const filters: Filters = {};
    
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (selectedAppId !== '') filters.appId = selectedAppId as number;
    if (selectedCountry) filters.countryCode = selectedCountry;
    
    filterStore.set(filters);
  }

  function clearFilters() {
    startDate = '';
    endDate = '';
    selectedAppId = '';
    selectedCountry = '';
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
        min={dateRange().min}
        max={dateRange().max}
        class="input-magic text-sm py-1 px-2"
        placeholder="Start"
      />
      <span class="text-purple-400">to</span>
      <input
        type="date"
        bind:value={endDate}
        min={dateRange().min}
        max={dateRange().max}
        class="input-magic text-sm py-1 px-2"
        placeholder="End"
      />
    </div>

    <div class="flex items-center gap-2">
      <span class="text-purple-300 text-sm font-medium">&#127918; Product:</span>
      <select
        bind:value={selectedAppId}
        class="input-magic text-sm py-1 px-2 min-w-[150px]"
      >
        <option value="">All Products</option>
        {#each uniqueApps() as app}
          <option value={app.id}>{app.name}</option>
        {/each}
      </select>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-purple-300 text-sm font-medium">&#127758; Country:</span>
      <select
        bind:value={selectedCountry}
        class="input-magic text-sm py-1 px-2 min-w-[120px]"
      >
        <option value="">All Countries</option>
        {#each uniqueCountries() as country}
          <option value={country}>{country}</option>
        {/each}
      </select>
    </div>

    <button
      class="btn-primary text-sm py-1 px-3 flex items-center gap-1"
      onclick={clearFilters}
    >
      <span>&#10006;</span>
      Clear Filters
    </button>
  </div>
</div>
