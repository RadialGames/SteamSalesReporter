import {
  Chart,
  DoughnutController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  LineController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
} from 'chart.js';

// Register all Chart.js components once
export function registerChartComponents() {
  Chart.register(
    DoughnutController,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    LineController,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler
  );
}

// Common chart options
export const commonChartOptions: {
  responsive: boolean;
  maintainAspectRatio: boolean;
  plugins: Record<string, unknown>;
  scales?: { x?: Record<string, unknown>; y?: Record<string, unknown> };
} = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: 'rgba(255, 255, 255, 0.8)',
        font: {
          family: 'Nunito',
          size: 11,
        },
        padding: 12,
        usePointStyle: true,
        pointStyle: 'circle',
      },
    },
    tooltip: {
      backgroundColor: 'rgba(88, 28, 135, 0.9)',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: 'rgba(168, 85, 247, 0.5)',
      borderWidth: 1,
      padding: 12,
    },
  },
};

// Rainbow colors for charts
export const rainbowColors = [
  'rgba(168, 85, 247, 0.9)', // Purple
  'rgba(255, 107, 107, 0.9)', // Pink
  'rgba(254, 202, 87, 0.9)', // Yellow
  'rgba(72, 219, 251, 0.9)', // Cyan
  'rgba(255, 159, 243, 0.9)', // Pink
  'rgba(95, 39, 205, 0.9)', // Dark purple
  'rgba(94, 213, 122, 0.9)', // Green
  'rgba(255, 159, 64, 0.9)', // Orange
  'rgba(153, 102, 255, 0.9)', // Light purple
  'rgba(255, 99, 132, 0.9)', // Red
];

// Common chart setup function - kept for future use
// export function setupChartLifecycle(
//   canvas: HTMLCanvasElement | null,
//   chart: { value: Chart | null },
//   createChartFn: () => void
// ): { mount: () => void; destroy: () => void } {
//   const mount = () => {
//     if (canvas) {
//       createChartFn();
//     }
//   };

//   const destroy = () => {
//     if (chart.value) {
//       chart.value.destroy();
//       chart.value = null;
//     }
//   };

//   return { mount, destroy };
// }
