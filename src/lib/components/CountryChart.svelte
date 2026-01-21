<script lang="ts">
  import { onMount } from 'svelte';
  import { Chart } from 'chart.js';
  import { getCountryAggregates } from '$lib/db/aggregates';
  import { getCountryName } from '$lib/utils/countries';
  import { registerChartComponents, commonChartOptions, rainbowColors } from '$lib/utils/charts';
  import { useChartLifecycle } from '$lib/utils/chart-lifecycle.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  interface CountryData {
    countryCode: string;
    totalRevenue: number;
    totalUnits: number;
  }

  let countryData = $state<CountryData[]>([]);

  onMount(async () => {
    const aggregates = await getCountryAggregates();
    countryData = aggregates.map((a) => ({
      countryCode: a.country_code,
      totalRevenue: a.total_revenue,
      totalUnits: a.total_units,
    }));
  });

  // Register chart components
  registerChartComponents();

  function getTopCountries() {
    const top = countryData.slice(0, 8);
    const rest = countryData.slice(8);

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
            borderColor: 'rgba(88, 28, 135, 1)',
            borderWidth: 2,
            hoverOffset: 10,
          },
        ],
      },
      options: {
        ...commonChartOptions,
        cutout: '60%',
        plugins: {
          ...commonChartOptions.plugins,
          legend: {
            ...commonChartOptions.plugins.legend,
            position: 'right',
          },
          tooltip: {
            ...commonChartOptions.plugins.tooltip,
            callbacks: {
              label: function (context) {
                const total = (context.dataset.data as number[]).reduce(
                  (a: number, b: number) => a + b,
                  0
                );
                const percentage = ((context.parsed / total) * 100).toFixed(1);
                return `${context.label}: $${context.parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${percentage}%)`;
              },
            },
          },
        },
      },
    });
  }

  const { setCanvas } = useChartLifecycle(createChart, () => countryData);
</script>

<div class="chart-container">
  <h3 class="text-lg font-bold font-['Fredoka'] mb-4 flex items-center gap-2">
    <span class="text-2xl">&#127758;</span>
    Revenue by Country
  </h3>

  {#if countryData.length === 0}
    <EmptyState
      icon="&#127758;"
      title="No country data yet"
      message="Geographic breakdown will appear here"
    />
  {:else}
    <div class="h-72">
      <canvas use:setCanvas></canvas>
    </div>
  {/if}
</div>
