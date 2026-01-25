<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart } from 'chart.js';
  import { countrySummariesStore, filterStore } from '$lib/stores/sqlite-stores';

  // Access nested stores
  const loadingStore = countrySummariesStore.loading;
  const errorStore = countrySummariesStore.error;
  import { getCountryName } from '$lib/utils/countries';
  import { registerChartComponents, commonChartOptions, rainbowColors } from '$lib/utils/charts';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  interface CountryData {
    countryCode: string;
    totalRevenue: number;
    totalUnits: number;
  }

  onMount(async () => {
    await countrySummariesStore.load($filterStore);
  });

  // React to filter changes
  $effect(() => {
    const filters = $filterStore;
    countrySummariesStore.load(filters);
  });

  // Register chart components
  registerChartComponents();

  function getTopCountries(): CountryData[] {
    const data: CountryData[] = $countrySummariesStore.map(c => ({
      countryCode: c.countryCode,
      totalRevenue: c.totalRevenue,
      totalUnits: c.totalUnits,
    }));

    const top = data.slice(0, 8);
    const rest = data.slice(8);

    if (rest.length > 0) {
      const otherRevenue = rest.reduce((sum, c) => sum + c.totalRevenue, 0);
      const otherUnits = rest.reduce((sum, c) => sum + c.totalUnits, 0);
      return [...top, { countryCode: 'Other', totalRevenue: otherRevenue, totalUnits: otherUnits }];
    }

    return top;
  }

  function createChart(canvas: HTMLCanvasElement) {
    const data = getTopCountries();

    return new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.map((c) => getCountryName(c.countryCode)),
        datasets: [
          {
            data: data.map((c) => c.totalRevenue),
            backgroundColor: rainbowColors.slice(0, data.length),
          },
        ],
      },
      options: {
        ...commonChartOptions,
        plugins: {
          ...commonChartOptions.plugins,
          legend: {
            position: 'right',
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const value = context.parsed || 0;
                return `${label}: $${value.toLocaleString()}`;
              },
            },
          },
        },
      },
    });
  }

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  const chartLifecycle = useChartLifecycle(createChart, () => [$countrySummariesStore]);
  
  $effect(() => {
    if (canvasElement) {
      chartLifecycle.setCanvas(canvasElement);
    }
  });
</script>

<div class="glass-card p-6">
  <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Revenue by Country</h3>

  {#if $loadingStore}
    <div class="text-center py-12 text-purple-300">Loading chart data...</div>
  {:else if $errorStore}
    <EmptyState title="Error" message="Error loading chart data: {$errorStore}" />
  {:else if $countrySummariesStore.length === 0}
    <EmptyState title="No Data" message="No data available for the selected filters" />
  {:else}
    <div class="h-64">
      <canvas bind:this={canvasElement}></canvas>
    </div>
  {/if}
</div>
