<script lang="ts">
  import { getAppsLookup, getPackagesLookup, getProductStats } from '$lib/api/query-client';
  import type { AppLookup, PackageLookup, ProductStats } from '$lib/api/query-client';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { getCountryName } from '$lib/utils/countries';
  import { ToggleGroup } from './ui';
  import EmptyState from './ui/EmptyState.svelte';
  import { databaseLoaded } from '$lib/stores/sqlite-stores';

  type ProductType = 'app' | 'package';

  let productType = $state<ProductType>('app');
  let apps = $state<AppLookup[]>([]);
  let packages = $state<PackageLookup[]>([]);
  let selectedAppId = $state<string>('');
  let selectedPackageId = $state<string>('');
  let stats = $state<ProductStats | null>(null);
  let loadingLookups = $state(false);
  let loadingStats = $state(false);
  let error = $state<string | null>(null);

  const productTypeOptions = [
    { value: 'app', label: 'AppID' },
    { value: 'package', label: 'PackageID' },
  ];

  async function loadLookups() {
    if (!$databaseLoaded) return;
    loadingLookups = true;
    error = null;
    try {
      const [appsData, packagesData] = await Promise.all([
        getAppsLookup(),
        getPackagesLookup(),
      ]);
      apps = appsData;
      packages = packagesData;
      if (productType === 'app' && apps.length > 0 && selectedAppId === '') {
        selectedAppId = String(apps[0]!.appId);
      } else if (productType === 'package' && packages.length > 0 && selectedPackageId === '') {
        selectedPackageId = String(packages[0]!.packageId);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load lookups';
      console.error('[PackageMetrics] Error loading lookups:', e);
      error = errorMessage;
      apps = [];
      packages = [];
    } finally {
      loadingLookups = false;
    }
  }

  function handleProductTypeChange(v: string) {
    productType = v as ProductType;
    stats = null;
    selectedAppId = '';
    selectedPackageId = '';
    loadLookups();
  }

  $effect(() => {
    if (!$databaseLoaded) return;
    loadLookups();
  });

  $effect(() => {
    if (productType === 'app' && selectedAppId !== '') {
      loadStats('app', Number(selectedAppId));
    } else if (productType === 'package' && selectedPackageId !== '') {
      loadStats('package', Number(selectedPackageId));
    } else {
      stats = null;
    }
  });

  async function loadStats(type: 'app' | 'package', id: number) {
    loadingStats = true;
    error = null;
    try {
      stats = await getProductStats(type, id);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load product stats';
      console.error(`[PackageMetrics] Error loading stats for ${type} ${id}:`, e);
      error = errorMessage;
      stats = null;
    } finally {
      loadingStats = false;
    }
  }

</script>

<div class="space-y-6">
  <div class="glass-card p-6">
    <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Product Details</h3>

    {#if !$databaseLoaded}
      <EmptyState title="No Data" message="Please load a database file to view product details." />
    {:else if loadingLookups && apps.length === 0 && packages.length === 0}
      <div class="text-center py-12 text-purple-300">Loading products...</div>
    {:else}
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-4">
          <ToggleGroup
            variant="default"
            options={productTypeOptions}
            value={productType}
            onchange={handleProductTypeChange}
          />
          {#if productType === 'app'}
            <div class="flex items-center gap-2">
              <label for="product-select-app" class="text-purple-300 text-sm font-medium">Product:</label>
              <select
                id="product-select-app"
                class="input-magic text-sm py-1 px-2 min-w-[180px]"
                bind:value={selectedAppId}
              >
                <option value="">Select app...</option>
                {#each apps as app (app.appId)}
                  <option value={String(app.appId)}>{app.appName}</option>
                {/each}
              </select>
            </div>
          {:else}
            <div class="flex items-center gap-2">
              <label for="product-select-package" class="text-purple-300 text-sm font-medium">Product:</label>
              <select
                id="product-select-package"
                class="input-magic text-sm py-1 px-2 min-w-[180px]"
                bind:value={selectedPackageId}
              >
                <option value="">Select package...</option>
                {#each packages as pkg (pkg.packageId)}
                  <option value={String(pkg.packageId)}>{pkg.packageName}</option>
                {/each}
              </select>
            </div>
          {/if}
        </div>

        {#if error}
          <div class="p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200 text-sm">
            {error}
          </div>
        {/if}

        {#if (productType === 'app' && !selectedAppId) || (productType === 'package' && !selectedPackageId)}
          <p class="text-purple-400 text-sm">Select a product to view stats.</p>
        {:else if loadingStats && !stats}
          <div class="text-center py-12 text-purple-300">Loading stats...</div>
        {:else if stats}
          <div class="space-y-6">
            <!-- Summary -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div class="glass-card p-4">
                <div class="text-purple-400 text-sm">Total Revenue</div>
                <div class="text-xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
              </div>
              <div class="glass-card p-4">
                <div class="text-purple-400 text-sm">Total Units</div>
                <div class="text-xl font-bold">{formatNumber(stats.totalUnits)}</div>
              </div>
              <div class="glass-card p-4">
                <div class="text-purple-400 text-sm">Records</div>
                <div class="text-xl font-bold">{formatNumber(stats.recordCount, { showZero: true })}</div>
              </div>
              <div class="glass-card p-4">
                <div class="text-purple-400 text-sm">Date Range</div>
                <div class="text-sm font-medium">
                  {#if stats.dateRange}
                    {stats.dateRange.min} to {stats.dateRange.max}
                  {:else}
                    -
                  {/if}
                </div>
              </div>
            </div>

            <!-- Daily breakdown -->
            {#if stats.daily.length > 0}
              <div>
                <h4 class="text-sm font-medium text-purple-300 mb-2">Daily breakdown</h4>
                <div class="overflow-x-auto max-h-48 overflow-y-auto border border-white/10 rounded-lg">
                  <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-purple-900/95">
                      <tr class="border-b border-white/10">
                        <th class="text-left p-2">Date</th>
                        <th class="text-right p-2">Revenue</th>
                        <th class="text-right p-2">Units</th>
                        <th class="text-right p-2">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each stats.daily as d (d.date)}
                        <tr class="border-b border-white/5">
                          <td class="p-2">{d.date}</td>
                          <td class="p-2 text-right">{formatCurrency(d.totalRevenue)}</td>
                          <td class="p-2 text-right">{formatNumber(d.totalUnits)}</td>
                          <td class="p-2 text-right">{formatNumber(d.recordCount, { showZero: true })}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}

            <!-- By country -->
            {#if stats.byCountry.length > 0}
              <div>
                <h4 class="text-sm font-medium text-purple-300 mb-2">By country</h4>
                <div class="overflow-x-auto max-h-48 overflow-y-auto border border-white/10 rounded-lg">
                  <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-purple-900/95">
                      <tr class="border-b border-white/10">
                        <th class="text-left p-2">Country</th>
                        <th class="text-right p-2">Revenue</th>
                        <th class="text-right p-2">Units</th>
                        <th class="text-right p-2">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each stats.byCountry as c (c.countryCode)}
                        <tr class="border-b border-white/5">
                          <td class="p-2">{getCountryName(c.countryCode) || c.countryCode}</td>
                          <td class="p-2 text-right">{formatCurrency(c.totalRevenue)}</td>
                          <td class="p-2 text-right">{formatNumber(c.totalUnits)}</td>
                          <td class="p-2 text-right">{formatNumber(c.recordCount, { showZero: true })}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}

            <!-- By platform -->
            {#if stats.byPlatform.length > 0}
              <div>
                <h4 class="text-sm font-medium text-purple-300 mb-2">By platform</h4>
                <div class="overflow-x-auto max-h-48 overflow-y-auto border border-white/10 rounded-lg">
                  <table class="w-full text-sm">
                    <thead class="sticky top-0 bg-purple-900/95">
                      <tr class="border-b border-white/10">
                        <th class="text-left p-2">Platform</th>
                        <th class="text-right p-2">Revenue</th>
                        <th class="text-right p-2">Units</th>
                        <th class="text-right p-2">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each stats.byPlatform as p, i (String(p.platform ?? '') + i)}
                        <tr class="border-b border-white/5">
                          <td class="p-2">{p.platform ?? '-'}</td>
                          <td class="p-2 text-right">{formatCurrency(p.totalRevenue)}</td>
                          <td class="p-2 text-right">{formatNumber(p.totalUnits)}</td>
                          <td class="p-2 text-right">{formatNumber(p.recordCount, { showZero: true })}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
