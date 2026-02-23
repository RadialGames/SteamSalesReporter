<script lang="ts">
  import { getLaunchComparison, getAppsLookup, getPackagesLookup, getPackagesByApp } from '$lib/api/query-client';
  import type { LaunchComparisonApp, AppLookup, PackageLookup } from '$lib/api/query-client';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import EmptyState from './ui/EmptyState.svelte';
  import { databaseLoaded } from '$lib/stores/sqlite-stores';
  import { createCsvExportFunctions } from '$lib/utils/csv-export-hooks';
  import { generateCsv } from '$lib/utils/csv-export';
  import { onMount, onDestroy } from 'svelte';
  import { Chart } from 'chart.js';
  import { registerChartComponents, commonChartOptions, rainbowColors } from '$lib/utils/charts';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';

  // Register chart components
  registerChartComponents();

  let maxDays = $state(7);
  let previousProductType = $state<'app' | 'package'>('app');
  let allApps = $state<LaunchComparisonApp[]>([]);
  let allPackages = $state<LaunchComparisonApp[]>([]);
  let loading = $state(false);
  let loadingProgress = $state<{ current: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let displayMode = $state<'units' | 'revenue' | 'avgPrice' | 'combined'>('revenue');
  let productType = $state<'app' | 'package'>('app');
  let selectedIds = $state<Set<number>>(new Set());
  let showChildPackages = $state(false);
  let copied = $state(false);
  let isExporting = $state(false);
  let appsLookup = $state<AppLookup[]>([]);
  let packagesLookup = $state<PackageLookup[]>([]);
  let loadingLookups = $state(false);
  let childPackages = $state<PackageLookup[]>([]);
  let loadingChildPackages = $state(false);
  let chartCanvas = $state<HTMLCanvasElement | null>(null);
  let chartInstance: Chart | null = null;
  let hiddenRowIds = $state<Set<string>>(new Set());

  const effectiveMax = $derived(Math.max(1, maxDays));
  
  const dayRange = $derived(Array.from({ length: effectiveMax + 1 }, (_, i) => i));

  const isSingleAppSelected = $derived(productType === 'app' && selectedIds.size === 1);

  // Calculate maximum possible days for the oldest product
  const maxPossibleDays = $derived(() => {
    const apps = filteredApps();
    if (apps.length === 0) return 365; // Default to max if no data

    // Find the oldest launch date
    const launchDates = apps
      .map((app) => app.launchDate)
      .filter((date) => date)
      .map((date) => new Date(date).getTime())
      .filter((time) => !isNaN(time));

    if (launchDates.length === 0) return 365;

    const oldestLaunchDate = new Date(Math.min(...launchDates));
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to start of day for accurate calculation
    oldestLaunchDate.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - oldestLaunchDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(1, diffDays);
  });

  function setMaxDays() {
    maxDays = maxPossibleDays();
  }

  function getRowId(app: LaunchComparisonApp): string {
    if (app.appId !== null) {
      return `app-${app.appId}`;
    } else if (app.packageId !== null) {
      return `package-${app.packageId}`;
    }
    return 'unknown';
  }

  const filteredApps = $derived(() => {
    let apps = allApps;
    
    // Filter by selected IDs
    if (selectedIds.size > 0) {
      apps = apps.filter((app) => {
        const id = productType === 'app' ? app.appId : app.packageId;
        return id !== null && selectedIds.has(id);
      });
    }

    // If showing child packages and single app selected, include child packages
    if (showChildPackages && isSingleAppSelected && productType === 'app') {
      const selectedAppId = Array.from(selectedIds)[0];
      const childPackageIds = new Set(childPackages.map((p) => p.packageId));
      
      // Add child packages from allPackages
      const childPackageApps = allPackages.filter((app) => {
        return app.packageId !== null && childPackageIds.has(app.packageId);
      });
      
      apps = [...apps, ...childPackageApps];
    }

    // Separate visible and hidden rows, with hidden at the bottom
    const visible: LaunchComparisonApp[] = [];
    const hidden: LaunchComparisonApp[] = [];
    
    for (const app of apps) {
      const rowId = getRowId(app);
      if (hiddenRowIds.has(rowId)) {
        hidden.push(app);
      } else {
        visible.push(app);
      }
    }

    return [...visible, ...hidden];
  });

  const visibleAppsForExport = $derived(() => {
    return filteredApps().filter((app) => {
      const rowId = getRowId(app);
      return !hiddenRowIds.has(rowId);
    });
  });

  const availableProducts = $derived(() => {
    if (productType === 'app') {
      return allApps
        .filter((app) => app.appId !== null)
        .map((app) => ({
          id: app.appId!,
          name: app.appName ?? `App ${app.appId}`
        }));
    } else {
      return allApps
        .filter((app) => app.packageId !== null)
        .map((app) => ({
          id: app.packageId!,
          name: app.packageName ?? `Package ${app.packageId}`
        }));
    }
  });

  async function loadLookups() {
    if (!$databaseLoaded) return;
    loadingLookups = true;
    try {
      if (productType === 'app') {
        appsLookup = await getAppsLookup();
      } else {
        packagesLookup = await getPackagesLookup();
      }
    } catch (e) {
      console.error('[LaunchComparison] Error loading lookups:', e);
    } finally {
      loadingLookups = false;
    }
  }

  async function loadChildPackages(appId: number) {
    if (!$databaseLoaded) return;
    loadingChildPackages = true;
    try {
      childPackages = await getPackagesByApp(appId);
    } catch (e) {
      console.error('[LaunchComparison] Error loading child packages:', e);
      childPackages = [];
    } finally {
      loadingChildPackages = false;
    }
  }

  async function load() {
    if (!$databaseLoaded) return;
    loading = true;
    loadingProgress = null;
    error = null;
    try {
      console.log('[LaunchComparison] Loading data with maxDays:', effectiveMax, 'productType:', productType);
      
      // Show initial progress
      loadingProgress = { current: 0, total: 1 };
      
      allApps = await getLaunchComparison(effectiveMax, productType);
      console.log('[LaunchComparison] Loaded', allApps.length, 'apps. First app days:', allApps[0]?.days?.length);
      
      // Update progress
      loadingProgress = { current: 1, total: productType === 'app' ? 2 : 1 };
      
      // Also load packages data when in app mode (for child packages)
      if (productType === 'app') {
        allPackages = await getLaunchComparison(effectiveMax, 'package');
        loadingProgress = { current: 2, total: 2 };
      }
      
      // Auto-select all when data loads
      if (selectedIds.size === 0 && allApps.length > 0) {
        selectedIds = new Set(
          allApps
            .map((app) => (productType === 'app' ? app.appId : app.packageId))
            .filter((id): id is number => id !== null)
        );
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load launch comparison';
      console.error('[LaunchComparison] Error loading launch comparison:', e);
      console.error('[LaunchComparison] maxDays:', effectiveMax);
      console.error('[LaunchComparison] productType:', productType);
      error = errorMessage;
      allApps = [];
      allPackages = [];
    } finally {
      loading = false;
      loadingProgress = null;
    }
  }

  $effect(() => {
    // Explicitly track maxDays and effectiveMax to ensure reload when they change
    const currentMaxDays = maxDays;
    const currentEffectiveMax = effectiveMax;
    const currentProductType = productType;
    
    if ($databaseLoaded && currentEffectiveMax >= 1) {
      // Reset selection when product type changes (but not when maxDays changes)
      if (currentProductType !== previousProductType) {
        selectedIds = new Set();
        showChildPackages = false;
        childPackages = [];
        previousProductType = currentProductType;
      }
      
      load();
      loadLookups();
    } else {
      allApps = [];
      allPackages = [];
    }
  });

  // Load child packages when a single app is selected
  $effect(() => {
    if (isSingleAppSelected && productType === 'app') {
      const selectedAppId = Array.from(selectedIds)[0];
      loadChildPackages(selectedAppId);
    } else {
      childPackages = [];
    }
  });

  function formatCell(app: LaunchComparisonApp, day: number) {
    const d = app.days.find((x) => x.day === day);
    if (!d) return '-';
    
    if (displayMode === 'units') {
      return formatNumber(d.units);
    } else if (displayMode === 'avgPrice') {
      if (d.units === 0) return '-';
      const avgPrice = d.revenue / d.units;
      return formatCurrency(avgPrice);
    } else {
      return formatCurrency(d.revenue);
    }
  }

  function generateCsvContent(): string {
    const apps = visibleAppsForExport();
    if (apps.length === 0) return '';

    const headers = [
      productType === 'app' ? 'App' : 'Package',
      'Launch Date (T0)',
      ...dayRange.map((day) => `T+${day}`)
    ];

    if (displayMode === 'combined') {
      // Create alternating rows: gross sales, then units for each product
      const rows: string[][] = [];
      
      for (const app of apps) {
        const name = getProductName(app);
        
        // Gross Sales Row
        const revenueRow: string[] = [name, app.launchDate];
        for (const day of dayRange) {
          const dayData = app.days.find((d) => d.day === day);
          if (dayData) {
            revenueRow.push(dayData.revenue.toFixed(2));
          } else {
            revenueRow.push('');
          }
        }
        rows.push(revenueRow);
        
        // Units Row
        const unitsRow: string[] = [name, app.launchDate];
        for (const day of dayRange) {
          const dayData = app.days.find((d) => d.day === day);
          if (dayData) {
            unitsRow.push(dayData.units.toString());
          } else {
            unitsRow.push('');
          }
        }
        rows.push(unitsRow);
      }
      
      return generateCsv(headers, rows);
    } else {
      // Single row per product for other modes
      const rows = apps.map((app) => {
        const name = getProductName(app);
        
        const row: string[] = [name, app.launchDate];
        
        for (const day of dayRange) {
          const dayData = app.days.find((d) => d.day === day);
          if (dayData) {
            let value: string;
            if (displayMode === 'units') {
              value = dayData.units.toString();
            } else if (displayMode === 'avgPrice') {
              if (dayData.units === 0) {
                value = '';
              } else {
                value = (dayData.revenue / dayData.units).toFixed(2);
              }
            } else {
              value = dayData.revenue.toFixed(2);
            }
            row.push(value);
          } else {
            row.push('');
          }
        }
        
        return row;
      });

      return generateCsv(headers, rows);
    }
  }

  function getFilename(): string {
    const typeLabel = productType === 'app' ? 'AppID' : 'PackageID';
    let dataLabel = 'GrossSales';
    if (displayMode === 'units') {
      dataLabel = 'Units';
    } else if (displayMode === 'avgPrice') {
      dataLabel = 'AvgPrice';
    } else if (displayMode === 'combined') {
      dataLabel = 'GrossSalesAndUnits';
    }
    return `launch_comparison_${typeLabel}_${dataLabel}_T${effectiveMax}.csv`;
  }

  function toggleProduct(id: number) {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    selectedIds = newSet;
  }

  function selectAll() {
    selectedIds = new Set(availableProducts().map((p) => p.id));
  }

  function selectNone() {
    selectedIds = new Set();
  }

  function toggleHideRow(app: LaunchComparisonApp) {
    const rowId = getRowId(app);
    const newSet = new Set(hiddenRowIds);
    if (newSet.has(rowId)) {
      newSet.delete(rowId);
    } else {
      newSet.add(rowId);
    }
    hiddenRowIds = newSet;
  }

  function isRowHidden(app: LaunchComparisonApp): boolean {
    const rowId = getRowId(app);
    return hiddenRowIds.has(rowId);
  }

  function getProductName(app: LaunchComparisonApp): string {
    if (app.appId !== null) {
      // Try lookup table first, then appName from data, then fallback
      const lookupName = appsLookup.find((a) => a.appId === app.appId)?.appName;
      return lookupName ?? app.appName ?? `App ${app.appId}`;
    } else if (app.packageId !== null) {
      // Try lookup table first, then packageName from data, then fallback
      const lookupName = packagesLookup.find((p) => p.packageId === app.packageId)?.packageName;
      return lookupName ?? app.packageName ?? `Package ${app.packageId}`;
    }
    return 'Unknown';
  }

  function getChartData() {
    const apps = visibleAppsForExport();
    if (apps.length === 0 || !chartCanvas) return null;

    const labels = dayRange.map((day) => `T+${day}`);
    
    const datasets = apps.map((app, index) => {
      const data = dayRange.map((day) => {
        const dayData = app.days.find((d) => d.day === day);
        if (!dayData) return null;
        
        if (displayMode === 'units') {
          return dayData.units;
        } else if (displayMode === 'avgPrice') {
          if (dayData.units === 0) return null;
          return dayData.revenue / dayData.units;
        } else {
          return dayData.revenue;
        }
      });

      const colorIndex = index % rainbowColors.length;
      const color = rainbowColors[colorIndex];
      
      return {
        label: getProductName(app),
        data,
        borderColor: color,
        backgroundColor: color.replace('0.9', '0.1'),
        tension: 0.4,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 5,
      };
    });

    return {
      labels,
      datasets,
    };
  }

  function createChart() {
    if (!chartCanvas) return;

    // Destroy existing chart
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const chartData = getChartData();
    if (!chartData) return;

    const yAxisLabel = displayMode === 'units' 
      ? 'Units Sold' 
      : displayMode === 'avgPrice' 
        ? 'Average Price (USD)' 
        : 'Gross Sales (USD)';

    chartInstance = new Chart(chartCanvas, {
      type: 'line',
      data: chartData,
      options: {
        ...commonChartOptions,
        scales: {
          x: {
            title: {
              display: true,
              text: 'Days Since Launch',
              color: 'rgba(255, 255, 255, 0.8)',
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.6)',
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
          y: {
            title: {
              display: true,
              text: yAxisLabel,
              color: 'rgba(255, 255, 255, 0.8)',
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.6)',
              callback: function(value) {
                if (displayMode === 'units') {
                  return formatNumber(Number(value));
                } else {
                  return formatCurrency(Number(value));
                }
              },
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
          },
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
      },
    });
  }

  // Update chart when canvas is available and data changes
  $effect(() => {
    const canvas = chartCanvas;
    const apps = filteredApps();
    const mode = displayMode;
    const max = effectiveMax;
    
    // Don't create chart in combined mode
    if (canvas && apps.length > 0 && mode !== 'combined') {
      // Small delay to ensure canvas is fully rendered
      setTimeout(() => {
        createChart();
      }, 0);
    } else if (chartInstance && mode === 'combined') {
      // Destroy chart when switching to combined mode
      chartInstance.destroy();
      chartInstance = null;
    }
  });

  onDestroy(() => {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  });

  const { copy: copyToClipboard, download: downloadCsv } = createCsvExportFunctions(
    generateCsvContent,
    getFilename
  );

  async function handleCopy() {
    await copyToClipboard((value) => {
      copied = value;
    });
  }

  async function handleDownload() {
    await downloadCsv((value) => {
      isExporting = value;
    });
  }
</script>

<div class="space-y-6">
  <div class="glass-card p-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-xl font-bold font-['Fredoka'] rainbow-text">Launch Comparison</h3>
      {#if visibleAppsForExport().length > 0}
        <div
          class="flex p-[2px] rounded-lg bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500"
        >
          <div class="flex bg-purple-900/90 rounded-md">
            <button
              class="px-3 py-1.5 rounded-l-md text-purple-200 text-sm
                     transition-colors flex items-center gap-1.5 border-r border-white/10
                     hover:bg-white/10 hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={handleCopy}
              disabled={visibleAppsForExport().length === 0}
              title="Copy to clipboard"
            >
              {#if copied}
                <span>&#10003;</span>
                <span class="hidden sm:inline">Copied!</span>
              {:else}
                <span>&#128203;</span>
                <span class="hidden sm:inline">Copy</span>
              {/if}
            </button>
            <button
              class="px-3 py-1.5 rounded-r-md text-purple-200 text-sm
                     transition-colors flex items-center gap-1.5
                     hover:bg-white/10 hover:text-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
              onclick={handleDownload}
              disabled={visibleAppsForExport().length === 0 || isExporting}
              title="Download CSV file"
            >
              <span>&#128190;</span>
              <span class="hidden sm:inline">Save</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
    <p class="text-sm text-purple-300 mb-4">
      {#if displayMode === 'combined'}
        Showing Gross Sales (USD) and Units Sold
      {:else if displayMode === 'units'}
        Showing Units Sold
      {:else if displayMode === 'avgPrice'}
        Showing Average Sale Price (USD)
      {:else}
        Showing Gross Sales (USD)
      {/if}
    </p>

    {#if !$databaseLoaded}
      <EmptyState
        title="No Data"
        message="Please load a database file to view launch comparisons."
      />
    {:else}
      <div class="space-y-4">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <label for="launch-max-days" class="text-purple-300 text-sm font-medium">
                Max days (T+):
              </label>
              <input
                id="launch-max-days"
                type="number"
                min="1"
                class="input-magic text-sm py-1 px-2 w-20"
                bind:value={maxDays}
              />
              <button
                type="button"
                onclick={setMaxDays}
                class="text-xs text-purple-300 hover:text-white px-2 py-1 rounded hover:bg-white/10 border border-white/20"
                title="Set to maximum days available for oldest product ({maxPossibleDays()} days)"
              >
                Max
              </button>
            </div>
            <div class="flex items-center gap-2">
              <label for="product-type" class="text-purple-300 text-sm font-medium">
                Product Type:
              </label>
              <select
                id="product-type"
                bind:value={productType}
                class="input-magic text-sm py-1 px-2"
              >
                <option value="app">AppID</option>
                <option value="package">PackageID</option>
              </select>
            </div>
            <div class="flex items-center gap-2">
              <label for="display-mode" class="text-purple-300 text-sm font-medium">
                Display:
              </label>
              <select
                id="display-mode"
                bind:value={displayMode}
                class="input-magic text-sm py-1 px-2"
              >
                <option value="revenue">Gross Sales</option>
                <option value="units">Units</option>
                <option value="avgPrice">Average Sale Price</option>
                <option value="combined">Gross Sales + Units</option>
              </select>
            </div>
          </div>

          {#if availableProducts().length > 0}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-purple-300 text-sm font-medium">
                  Select {productType === 'app' ? 'Apps' : 'Packages'}:
                </span>
                <div class="flex gap-2">
                  <button
                    type="button"
                    onclick={selectAll}
                    class="text-xs text-purple-300 hover:text-white px-2 py-1 rounded hover:bg-white/10"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onclick={selectNone}
                    class="text-xs text-purple-300 hover:text-white px-2 py-1 rounded hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div class="max-h-48 overflow-y-auto border border-white/10 rounded p-2 bg-purple-900/30">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {#each availableProducts() as product}
                    <label class="flex items-center gap-2 cursor-pointer text-sm text-purple-200 hover:text-white">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onchange={() => toggleProduct(product.id)}
                        class="rounded"
                      />
                      <span class="truncate">{product.name}</span>
                    </label>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          {#if isSingleAppSelected && productType === 'app'}
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  bind:checked={showChildPackages}
                  class="rounded"
                />
                <span class="text-purple-300 text-sm">
                  Show child packages
                  {#if loadingChildPackages}
                    <span class="text-purple-400">(loading...)</span>
                  {:else if childPackages.length > 0}
                    <span class="text-purple-400">({childPackages.length} packages)</span>
                  {/if}
                </span>
              </label>
            </div>
          {/if}
        </div>

        {#if error}
          <div class="p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200 text-sm">
            {error}
          </div>
        {/if}

        {#if loading && allApps.length === 0}
          <div class="text-center py-12">
            <div class="inline-block animate-spin text-5xl mb-4 text-purple-300">&#8635;</div>
            <div class="text-purple-200 font-medium">Loading launch comparison data...</div>
            <div class="text-purple-300 text-sm mt-2">This may take a moment</div>
          </div>
        {:else if allApps.length === 0}
          <EmptyState
            icon="&#128640;"
            title={productType === 'app' ? 'No Apps' : 'No Packages'}
            message={productType === 'app' ? 'No app launch data found in the database.' : 'No package launch data found in the database.'}
          />
        {:else if filteredApps().length === 0}
          <EmptyState
            icon="&#128203;"
            title="No Selection"
            message="Please select at least one {productType === 'app' ? 'app' : 'package'} to display."
          />
        {:else}
          <div class="space-y-6 relative">
            {#if loading}
              <div class="absolute inset-0 bg-purple-900/90 backdrop-blur-sm z-50 flex items-center justify-center rounded-lg">
                <div class="text-center">
                  <div class="inline-block animate-spin text-5xl mb-4 text-purple-300">&#8635;</div>
                  <div class="text-purple-200 font-medium text-lg">Calculating launch comparison...</div>
                  {#if loadingProgress}
                    <div class="mt-4 w-64 mx-auto">
                      <div class="h-2 bg-purple-800/50 rounded-full overflow-hidden">
                        <div 
                          class="h-full bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500 transition-all duration-300"
                          style="width: {(loadingProgress.current / loadingProgress.total * 100)}%"
                        ></div>
                      </div>
                      <div class="text-purple-300 text-sm mt-2">
                        Processing {loadingProgress.current} of {loadingProgress.total} products...
                      </div>
                    </div>
                  {:else}
                    <div class="text-purple-300 text-sm mt-2">This may take a moment for large date ranges</div>
                  {/if}
                </div>
              </div>
            {/if}
            <!-- Table -->
            <div class="border border-white/10 rounded overflow-hidden {loading ? 'opacity-30 pointer-events-none' : ''}">
              <div class="overflow-x-auto">
                <table class="w-full text-sm" data-max-days={effectiveMax}>
                  <thead class="sticky top-0 bg-purple-900/95 z-20">
                    <tr class="border-b border-white/10">
                      <th class="text-left p-2 sticky left-0 bg-purple-900/95 z-30 w-12">
                        <span class="sr-only">Hide</span>
                      </th>
                      <th class="text-left p-2 sticky left-12 bg-purple-900/95 z-30">
                        {productType === 'app' ? 'App' : 'Package'}
                      </th>
                      <th class="text-left p-2">Launch (T0)</th>
                      {#each dayRange as day}
                        <th class="text-right p-2 whitespace-nowrap">
                          T+{day}
                        </th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#if displayMode === 'combined'}
                      {#each filteredApps() as app, index ((app.appId !== null ? `app-${app.appId}` : '') + (app.packageId !== null ? `package-${app.packageId}` : '') + `-${index}-${effectiveMax}-${app.days.length}`)}
                        {@const hidden = isRowHidden(app)}
                        {@const appDays = app.days}
                        <!-- Gross Sales Row -->
                        <tr class="border-b border-white/5 hover:bg-white/5 {hidden ? 'opacity-40' : ''}">
                          <td class="p-2 sticky left-0 bg-purple-900/50 z-10" rowspan="2">
                            <label class="flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hidden}
                                onchange={() => toggleHideRow(app)}
                                class="rounded w-4 h-4"
                                title="Hide this row"
                              />
                            </label>
                          </td>
                          <td class="p-2 sticky left-12 bg-purple-900/50 z-10 font-medium" rowspan="2">
                            {getProductName(app)}
                            {#if app.packageId !== null && showChildPackages && isSingleAppSelected}
                              <span class="text-xs text-purple-400 ml-1">(child)</span>
                            {/if}
                          </td>
                          <td class="p-2 text-purple-300" rowspan="2">{app.launchDate}</td>
                          {#each dayRange as day}
                            {@const dayData = appDays.find((d) => d.day === day)}
                            <td class="p-2 text-right tabular-nums">
                              {#if dayData}
                                {formatCurrency(dayData.revenue)}
                              {:else}
                                -
                              {/if}
                            </td>
                          {/each}
                        </tr>
                        <!-- Units Row -->
                        <tr class="border-b border-white/5 hover:bg-white/5 bg-purple-950/30 {hidden ? 'opacity-40' : ''}">
                          {#each dayRange as day}
                            {@const dayData = appDays.find((d) => d.day === day)}
                            <td class="p-2 text-right tabular-nums">
                              {#if dayData}
                                {formatNumber(dayData.units)}
                              {:else}
                                -
                              {/if}
                            </td>
                          {/each}
                        </tr>
                      {/each}
                    {:else}
                      {#each filteredApps() as app, index ((app.appId !== null ? `app-${app.appId}` : '') + (app.packageId !== null ? `package-${app.packageId}` : '') + `-${index}-${effectiveMax}-${app.days.length}`)}
                        {@const hidden = isRowHidden(app)}
                        {@const appDays = app.days}
                        <tr class="border-b border-white/5 hover:bg-white/5 {hidden ? 'opacity-40' : ''}">
                          <td class="p-2 sticky left-0 bg-purple-900/50 z-10">
                            <label class="flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={hidden}
                                onchange={() => toggleHideRow(app)}
                                class="rounded w-4 h-4"
                                title="Hide this row"
                              />
                            </label>
                          </td>
                          <td class="p-2 sticky left-12 bg-purple-900/50 z-10 font-medium">
                            {getProductName(app)}
                            {#if app.packageId !== null && showChildPackages && isSingleAppSelected}
                              <span class="text-xs text-purple-400 ml-1">(child)</span>
                            {/if}
                          </td>
                          <td class="p-2 text-purple-300">{app.launchDate}</td>
                          {#each dayRange as day}
                            {@const dayData = appDays.find((d) => d.day === day)}
                            <td class="p-2 text-right tabular-nums">
                              {#if dayData}
                                {#if displayMode === 'units'}
                                  {formatNumber(dayData.units)}
                                {:else if displayMode === 'avgPrice'}
                                  {dayData.units === 0 ? '-' : formatCurrency(dayData.revenue / dayData.units)}
                                {:else}
                                  {formatCurrency(dayData.revenue)}
                                {/if}
                              {:else}
                                -
                              {/if}
                            </td>
                          {/each}
                        </tr>
                      {/each}
                    {/if}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Chart -->
            {#if visibleAppsForExport().length > 0 && displayMode !== 'combined'}
              <div class="glass-card p-6">
                <h4 class="text-lg font-bold font-['Fredoka'] mb-4 rainbow-text">
                  Launch Comparison Chart
                </h4>
                <div class="h-96">
                  <canvas
                    bind:this={chartCanvas}
                    aria-label="Launch comparison chart"
                  ></canvas>
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
