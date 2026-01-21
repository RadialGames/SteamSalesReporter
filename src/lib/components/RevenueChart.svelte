<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart } from 'chart.js';
  import { getDisplayCache } from '$lib/db/display-cache';
  import { ToggleGroup } from './ui';
  import { registerChartComponents, commonChartOptions } from '$lib/utils/charts';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';
  import EmptyState from './ui/EmptyState.svelte';

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

  // Chart data from display cache
  let chartData = $state<ChartDataPoint[]>([]);

  // Toggle states
  let showRevenue = $state(true); // true = revenue, false = units
  let isCumulative = $state(false);

  // Load chart data from display cache
  onMount(async () => {
    const cached = await getDisplayCache<ChartDataPoint[]>('revenue_chart_data');
    if (cached) {
      chartData = cached;
    }
  });

  function createChart(canvas: HTMLCanvasElement): Chart {
    const ctx = canvas;

    let rawData = chartData;

    // Filter out data points before the first sale (launch day)
    // This removes activations (free developer copies, press releases) that occur before launch
    if (filterPreLaunch && rawData.length > 0) {
      // Find launch day: earliest date with revenue > 0
      let launchTime = Infinity;
      for (const point of rawData) {
        if (point.revenue > 0) {
          const ts = new Date(point.date).getTime();
          if (ts < launchTime) {
            launchTime = ts;
          }
        }
      }

      if (launchTime !== Infinity) {
        // Filter to only include dates >= launch date
        rawData = rawData.filter((d) => {
          const dateTime = new Date(d.date).getTime();
          return dateTime >= launchTime;
        });
      }
    }

    // Calculate cumulative data if needed
    let chartDataValues: number[];
    if (isCumulative) {
      let cumulative = 0;
      chartDataValues = rawData.map((d) => {
        cumulative += showRevenue ? d.revenue : d.units;
        return cumulative;
      });
    } else {
      chartDataValues = rawData.map((d) => (showRevenue ? d.revenue : d.units));
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

    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: rawData.map((d) => d.date),
        datasets: [
          {
            label,
            data: chartDataValues,
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
          ...commonChartOptions.plugins,
          legend: {
            display: false,
          },
          tooltip: {
            ...commonChartOptions.plugins.tooltip,
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

  const { setCanvas } = useChartLifecycle(createChart, () => [
    chartData,
    showRevenue,
    isCumulative,
    filterPreLaunch,
  ]);
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

  {#if chartData.length === 0}
    <EmptyState
      title="No data to display yet"
      message="Click 'Refresh Data' to fetch your sales data"
    />
  {:else}
    <div class="h-80">
      <canvas use:setCanvas></canvas>
    </div>
  {/if}
</div>
