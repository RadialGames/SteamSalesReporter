<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart } from 'chart.js';
  import { ToggleGroup } from './ui';
  import { registerChartComponents, commonChartOptions } from '$lib/utils/charts';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import { dailySummariesStore, filterStore } from '$lib/stores/sqlite-stores';

  // Access nested stores
  const loadingStore = dailySummariesStore.loading;
  const errorStore = dailySummariesStore.error;

  interface ChartDataPoint {
    date: string;
    revenue: number;
    units: number;
  }

  // Register chart components
  registerChartComponents();

  interface Props {
    filterPreLaunch?: boolean; // Filter out data points before first sale (launch day)
  }

  let { filterPreLaunch = false }: Props = $props();

  // Toggle states
  let showRevenue = $state(true); // true = revenue, false = units
  let isCumulative = $state(false);

  onMount(async () => {
    await dailySummariesStore.load($filterStore);
  });

  // React to filter changes
  $effect(() => {
    const filters = $filterStore;
    dailySummariesStore.load(filters);
  });

  function createChart(canvas: HTMLCanvasElement): Chart {
    const ctx = canvas;

    let rawData: ChartDataPoint[] = $dailySummariesStore.map(s => ({
      date: s.date,
      revenue: s.totalRevenue,
      units: s.totalUnits,
    }));

    // Filter out data points before the first sale (launch day)
    if (filterPreLaunch && rawData.length > 0) {
      let launchTime = Infinity;
      for (const point of rawData) {
        if (point.revenue > 0) {
          const time = new Date(point.date).getTime();
          if (time < launchTime) {
            launchTime = time;
          }
        }
      }
      if (launchTime !== Infinity) {
        rawData = rawData.filter((point) => new Date(point.date).getTime() >= launchTime);
      }
    }

    // Sort by date
    rawData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate cumulative if needed
    if (isCumulative) {
      let cumulative = 0;
      rawData = rawData.map((point) => {
        cumulative += showRevenue ? point.revenue : point.units;
        return {
          ...point,
          [showRevenue ? 'revenue' : 'units']: cumulative,
        };
      });
    }

    const labels = rawData.map((d) => d.date);
    const data = rawData.map((d) => (showRevenue ? d.revenue : d.units));

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: showRevenue ? 'Revenue (USD)' : 'Units Sold',
            data,
            borderColor: 'rgb(168, 85, 247)',
            backgroundColor: 'rgba(168, 85, 247, 0.1)',
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: {
        ...commonChartOptions,
        scales: {
          ...(commonChartOptions.scales ?? {}),
          y: {
            ...(commonChartOptions.scales?.y ?? {}),
            ticks: {
              callback: (value) => {
                if (showRevenue) {
                  return `$${Number(value).toLocaleString()}`;
                }
                return Number(value).toLocaleString();
              },
            },
          },
        },
      },
    });
  }

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  const chartLifecycle = useChartLifecycle(createChart, () => [showRevenue, isCumulative, $dailySummariesStore]);
  
  $effect(() => {
    if (canvasElement) {
      chartLifecycle.setCanvas(canvasElement);
    }
  });
</script>

<div class="glass-card p-6">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-xl font-bold font-['Fredoka'] rainbow-text">Revenue & Units Over Time</h3>
    <div class="flex items-center gap-4">
      <ToggleGroup
        variant="tabs-secondary"
        options={[
          { value: 'revenue', label: 'Revenue' },
          { value: 'units', label: 'Units' },
        ]}
        value={showRevenue ? 'revenue' : 'units'}
        onchange={(val) => (showRevenue = val === 'revenue')}
      />
      <ToggleGroup
        variant="tabs-secondary"
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'cumulative', label: 'Cumulative' },
        ]}
        value={isCumulative ? 'cumulative' : 'daily'}
        onchange={(val) => (isCumulative = val === 'cumulative')}
      />
    </div>
  </div>

  {#if $loadingStore}
    <div class="text-center py-12 text-purple-300">Loading chart data...</div>
  {:else if $errorStore}
    <EmptyState title="Error" message="Error loading chart data: {$errorStore}" />
  {:else if $dailySummariesStore.length === 0}
    <EmptyState title="No Data" message="No data available for the selected filters" />
  {:else}
    <div class="h-64">
      <canvas bind:this={canvasElement}></canvas>
    </div>
  {/if}
</div>
