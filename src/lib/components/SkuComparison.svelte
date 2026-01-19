<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  import { appSummary } from '$lib/stores/sales';

  Chart.register(BarController, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

  let canvas: HTMLCanvasElement = $state.raw(null!);
  let chart: Chart | null = null;

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

  function createChart() {
    if (!canvas) return;
    const ctx = canvas;

    if (chart) {
      chart.destroy();
    }

    const data = $appSummary.slice(0, 10);

    chart = new Chart(ctx, {
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

  onMount(() => {
    createChart();
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });

  $effect(() => {
    $appSummary;
    if (canvas) {
      createChart();
    }
  });
</script>

<div class="chart-container">
  <h3 class="text-lg font-bold font-['Fredoka'] mb-4 flex items-center gap-2">
    <span class="text-2xl">&#127918;</span>
    Revenue by Product
  </h3>

  {#if $appSummary.length === 0}
    <div class="flex flex-col items-center justify-center h-64 text-purple-300">
      <span class="text-4xl mb-2">&#128230;</span>
      <p>No products to compare yet</p>
      <p class="text-sm">Sales data will appear here</p>
    </div>
  {:else}
    <div class="h-80">
      <canvas bind:this={canvas}></canvas>
    </div>
  {/if}
</div>
