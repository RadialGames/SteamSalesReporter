<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Chart,
    BarController,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
  } from 'chart.js';
  import { appSummariesStore, filterStore } from '$lib/stores/sqlite-stores';

  // Access nested stores
  const loadingStore = appSummariesStore.loading;
  const errorStore = appSummariesStore.error;
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  Chart.register(BarController, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

  // Rainbow colors for bars
  const rainbowColors = [
    'rgba(168, 85, 247, 0.8)',
    'rgba(255, 107, 107, 0.8)',
    'rgba(254, 202, 87, 0.8)',
    'rgba(72, 219, 251, 0.8)',
    'rgba(255, 159, 243, 0.8)',
    'rgba(95, 39, 205, 0.8)',
    'rgba(94, 213, 122, 0.8)',
  ];

  onMount(async () => {
    await appSummariesStore.load($filterStore);
  });

  // React to filter changes
  $effect(() => {
    const filters = $filterStore;
    appSummariesStore.load(filters);
  });

  function createChart(canvas: HTMLCanvasElement): Chart {
    const topApps = $appSummariesStore.slice(0, 10);

    return new Chart(canvas, {
      type: 'bar',
      data: {
        labels: topApps.map((a) => a.appName || `App ${a.appId}`),
        datasets: [
          {
            label: 'Revenue (USD)',
            data: topApps.map((a) => a.totalRevenue),
            backgroundColor: rainbowColors.slice(0, topApps.length),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return `$${Number(context.parsed.y).toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => {
                return `$${Number(value).toLocaleString()}`;
              },
            },
          },
        },
      },
    });
  }

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  const chartLifecycle = useChartLifecycle(createChart, () => [$appSummariesStore]);

  $effect(() => {
    if (canvasElement) {
      chartLifecycle.setCanvas(canvasElement);
    }
  });
</script>

<div class="glass-card p-6">
  <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Top Products by Revenue</h3>

  {#if $loadingStore}
    <div class="text-center py-12 text-purple-300">Loading chart data...</div>
  {:else if $errorStore}
    <EmptyState title="Error" message="Error loading chart data: {$errorStore}" />
  {:else if $appSummariesStore.length === 0}
    <EmptyState title="No Data" message="No data available for the selected filters" />
  {:else}
    <div class="h-64">
      <canvas bind:this={canvasElement}></canvas>
    </div>
  {/if}
</div>
