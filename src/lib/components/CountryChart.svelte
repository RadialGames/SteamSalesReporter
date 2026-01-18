<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Chart,
    DoughnutController,
    ArcElement,
    Title,
    Tooltip,
    Legend
  } from 'chart.js';
  import { countrySummary } from '$lib/stores/sales';

  Chart.register(
    DoughnutController,
    ArcElement,
    Title,
    Tooltip,
    Legend
  );

  let canvas: HTMLCanvasElement = $state.raw(null!);
  let chart: Chart | null = null;

  // Rainbow colors for segments
  const rainbowColors = [
    'rgba(168, 85, 247, 0.9)',
    'rgba(255, 107, 107, 0.9)',
    'rgba(254, 202, 87, 0.9)',
    'rgba(72, 219, 251, 0.9)',
    'rgba(255, 159, 243, 0.9)',
    'rgba(95, 39, 205, 0.9)',
    'rgba(94, 213, 122, 0.9)',
    'rgba(255, 159, 64, 0.9)',
    'rgba(153, 102, 255, 0.9)',
    'rgba(255, 99, 132, 0.9)',
  ];

  // Country code to name mapping
  const countryNames: Record<string, string> = {
    US: 'United States',
    GB: 'United Kingdom',
    DE: 'Germany',
    FR: 'France',
    CA: 'Canada',
    AU: 'Australia',
    JP: 'Japan',
    CN: 'China',
    KR: 'South Korea',
    BR: 'Brazil',
    RU: 'Russia',
    IN: 'India',
    MX: 'Mexico',
    IT: 'Italy',
    ES: 'Spain',
    NL: 'Netherlands',
    SE: 'Sweden',
    PL: 'Poland',
    NO: 'Norway',
    DK: 'Denmark'
  };

  function getCountryName(code: string): string {
    return countryNames[code] || code;
  }

  function getTopCountries() {
    const top = $countrySummary.slice(0, 8);
    const rest = $countrySummary.slice(8);
    
    if (rest.length > 0) {
      const otherRevenue = rest.reduce((sum, c) => sum + c.totalRevenue, 0);
      const otherUnits = rest.reduce((sum, c) => sum + c.totalUnits, 0);
      return [...top, { countryCode: 'Other', totalRevenue: otherRevenue, totalUnits: otherUnits }];
    }
    
    return top;
  }

  function createChart() {
    if (!canvas) return;
    const ctx = canvas;
    
    if (chart) {
      chart.destroy();
    }

    const data = getTopCountries();
    
    chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(c => getCountryName(c.countryCode)),
        datasets: [
          {
            data: data.map(c => c.totalRevenue),
            backgroundColor: rainbowColors.slice(0, data.length),
            borderColor: 'rgba(88, 28, 135, 1)',
            borderWidth: 2,
            hoverOffset: 10
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: 'rgba(255, 255, 255, 0.8)',
              font: {
                family: 'Nunito',
                size: 11
              },
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(88, 28, 135, 0.9)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(168, 85, 247, 0.5)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: function(context) {
                const total = (context.dataset.data as number[]).reduce((a: number, b: number) => a + b, 0);
                const percentage = ((context.parsed / total) * 100).toFixed(1);
                return `${context.label}: $${context.parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
              }
            }
          }
        }
      }
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
    $countrySummary;
    if (canvas) {
      createChart();
    }
  });
</script>

<div class="chart-container">
  <h3 class="text-lg font-bold font-['Fredoka'] mb-4 flex items-center gap-2">
    <span class="text-2xl">&#127758;</span>
    Revenue by Country
  </h3>
  
  {#if $countrySummary.length === 0}
    <div class="flex flex-col items-center justify-center h-64 text-purple-300">
      <span class="text-4xl mb-2">&#127759;</span>
      <p>No country data yet</p>
      <p class="text-sm">Geographic breakdown will appear here</p>
    </div>
  {:else}
    <div class="h-72">
      <canvas bind:this={canvas}></canvas>
    </div>
  {/if}
</div>
