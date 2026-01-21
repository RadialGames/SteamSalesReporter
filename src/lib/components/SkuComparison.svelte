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
  import { getAppAggregates } from '$lib/db/aggregates';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';

  interface AppData {
    appId: number;
    appName: string;
    totalRevenue: number;
    totalUnits: number;
  }

  let appData = $state<AppData[]>([]);

  onMount(async () => {
    const aggregates = await getAppAggregates();
    appData = aggregates.slice(0, 10).map((a) => ({
      appId: a.app_id,
      appName: a.app_name,
      totalRevenue: a.total_revenue,
      totalUnits: a.total_units,
    }));
  });

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

  function createChart(canvas: HTMLCanvasElement): Chart {
    const ctx = canvas;

    const data = appData;

    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map((a) => a.appName),
        datasets: [
          {
            label: 'Net Revenue (USD)',
            data: data.map((a) => a.totalRevenue),
            backgroundColor: data.map((_, i) => rainbowColors[i % rainbowColors.length]),
            borderColor: data.map((_, i) =>
              rainbowColors[i % rainbowColors.length].replace('0.8', '1')
            ),
            borderWidth: 2,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(88, 28, 135, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(168, 85, 247, 0.5)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function (context) {
                const value = context.parsed.x ?? 0;
                return `Revenue: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.1)',
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.7)',
              font: {
                family: 'Nunito',
              },
              callback: function (tickValue) {
                const value = typeof tickValue === 'string' ? parseFloat(tickValue) : tickValue;
                if (value >= 1000000) {
                  return '$' + (value / 1000000).toFixed(1) + 'M';
                } else if (value >= 1000) {
                  return '$' + (value / 1000).toFixed(1) + 'K';
                }
                return '$' + value;
              },
            },
          },
          y: {
            grid: {
              display: false,
            },
            ticks: {
              color: 'rgba(255, 255, 255, 0.9)',
              font: {
                family: 'Nunito',
                weight: 600,
              },
            },
          },
        },
      },
    });
  }

  const { setCanvas } = useChartLifecycle(createChart, () => [appData]);
</script>

<div class="chart-container">
  <h3 class="text-lg font-bold font-['Fredoka'] mb-4 flex items-center gap-2">
    <span class="text-2xl">&#127918;</span>
    Revenue by Product
  </h3>

  {#if appData.length === 0}
    <div class="flex flex-col items-center justify-center h-64 text-purple-300">
      <span class="text-4xl mb-2">&#128230;</span>
      <p>No products to compare yet</p>
      <p class="text-sm">Sales data will appear here</p>
    </div>
  {:else}
    <div class="h-80">
      <canvas use:setCanvas></canvas>
    </div>
  {/if}
</div>
