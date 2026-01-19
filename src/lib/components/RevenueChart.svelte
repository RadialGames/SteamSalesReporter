<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Chart,
    LineController,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
  } from 'chart.js';
  import { dailySummary, salesStore } from '$lib/stores/sales';
  import { ToggleGroup } from './ui';

  Chart.register(
    LineController,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
  );

  interface Props {
    filterPreLaunch?: boolean; // Filter out data points before first sale (launch day)
  }

  let { filterPreLaunch = false }: Props = $props();

  let canvas: HTMLCanvasElement = $state.raw(null!);
  let chart: Chart | null = null;

  // Toggle states
  let showRevenue = $state(true); // true = revenue, false = units
  let isCumulative = $state(false);

  function createChart() {
    if (!canvas) return;
    const ctx = canvas;

    // Destroy existing chart
    if (chart) {
      chart.destroy();
    }

    let rawData = $dailySummary;

    // Filter out data points before the first sale (launch day)
    // This removes activations (free developer copies, press releases) that occur before launch
    // Uses the same logic as calculateLaunchDays in launch-metrics.ts
    if (filterPreLaunch && rawData.length > 0) {
      // Find launch day: earliest date with netSalesUsd > 0
      // This matches the logic in calculateLaunchDays
      const sales = $salesStore;
      let launchDate: string | null = null;
      let launchTime = Infinity;

      for (let i = 0; i < sales.length; i++) {
        const record = sales[i];
        if (record.netSalesUsd && record.netSalesUsd > 0) {
          const ts = new Date(record.date).getTime();
          if (ts < launchTime) {
            launchTime = ts;
            launchDate = record.date;
          }
        }
      }

      if (launchDate) {
        // Filter dailySummary to only include dates >= launch date
        // This ensures we start from the launch day, excluding pre-launch activations
        rawData = rawData.filter((d) => {
          const dateTime = new Date(d.date).getTime();
          return dateTime >= launchTime;
        });
      }
      // If no launchDate found, there's no revenue data, so show all data
    }

    // Calculate cumulative data if needed
    let chartData: number[];
    if (isCumulative) {
      let cumulative = 0;
      chartData = rawData.map((d) => {
        cumulative += showRevenue ? d.totalRevenue : d.totalUnits;
        return cumulative;
      });
    } else {
      chartData = rawData.map((d) => (showRevenue ? d.totalRevenue : d.totalUnits));
    }

    const label = showRevenue
      ? isCumulative
        ? 'Cumulative Revenue (USD)'
        : 'Net Revenue (USD)'
      : isCumulative
        ? 'Cumulative Units Sold'
        : 'Units Sold';

    const color = showRevenue ? 'rgba(168, 85, 247, 1)' : 'rgba(255, 107, 107, 1)';
    const bgColor = showRevenue ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 107, 107, 0.2)';

    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rawData.map((d) => d.date),
        datasets: [
          {
            label,
            data: chartData,
            borderColor: color,
            backgroundColor: bgColor,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointBackgroundColor: color,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
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
            displayColors: true,
            callbacks: {
              label: function (context) {
                const value = context.parsed.y ?? 0;
                if (showRevenue) {
                  return `${label}: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                }
                return `${label}: ${value.toLocaleString()}`;
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
              maxTicksLimit: 10,
            },
          },
          y: {
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
                if (showRevenue) {
                  return '$' + value.toLocaleString();
                }
                return value.toLocaleString();
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

  // Recreate chart when data or toggles change
  $effect(() => {
    $dailySummary;
    $salesStore; // Also watch salesStore for filterPreLaunch logic
    showRevenue;
    isCumulative;
    filterPreLaunch;
    if (canvas) {
      createChart();
    }
  });
</script>

<div class="chart-container">
  <div class="flex items-center justify-between mb-4">
    <h3 class="text-lg font-bold font-['Fredoka'] flex items-center gap-2">
      <span class="text-2xl">&#128200;</span>
      {showRevenue ? 'Revenue' : 'Units Sold'} Over Time
    </h3>

    <!-- Toggle Controls -->
    <div class="flex items-center gap-3">
      <!-- Revenue / Units Toggle -->
      <ToggleGroup
        size="sm"
        options={[
          { value: 'revenue', label: 'Revenue', activeClass: 'bg-purple-500' },
          { value: 'units', label: 'Units', activeClass: 'bg-pink-500' },
        ]}
        value={showRevenue ? 'revenue' : 'units'}
        onchange={(v) => (showRevenue = v === 'revenue')}
      />

      <!-- Cumulative Toggle -->
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          bind:checked={isCumulative}
          class="w-4 h-4 rounded border-purple-400 bg-white/10 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
        />
        <span class="text-xs text-purple-300">Cumulative</span>
      </label>
    </div>
  </div>

  {#if $dailySummary.length === 0}
    <div class="flex flex-col items-center justify-center h-64 text-purple-300">
      <span class="text-4xl mb-2">&#128202;</span>
      <p>No data to display yet</p>
      <p class="text-sm">Click "Refresh Data" to fetch your sales data</p>
    </div>
  {:else}
    <div class="h-80">
      <canvas bind:this={canvas}></canvas>
    </div>
  {/if}
</div>
