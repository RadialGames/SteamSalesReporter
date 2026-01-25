import { onMount, onDestroy } from 'svelte';
import { Chart } from 'chart.js';

/**
 * Chart lifecycle management hook for Svelte components
 * Handles canvas reference, chart instance management, and automatic recreation
 */
export function useChartLifecycle(
  createChartFn: (canvas: HTMLCanvasElement) => Chart | null,
  dependencies: () => unknown[] = () => []
) {
  let canvas: HTMLCanvasElement = $state.raw(null!);
  let chart: Chart | null = null;

  function updateChart() {
    if (!canvas) return;

    // Destroy existing chart
    if (chart) {
      chart.destroy();
    }

    // Create new chart
    chart = createChartFn(canvas);
  }

  onMount(() => {
    updateChart();
  });

  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });

  // React to dependency changes
  $effect(() => {
    dependencies(); // Track dependencies
    if (canvas) {
      updateChart();
    }
  });

  return {
    canvas: () => canvas,
    setCanvas: (el: HTMLCanvasElement) => {
      canvas = el;
    },
    getChart: () => chart,
    updateChart,
  };
}
