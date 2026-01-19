<script lang="ts">
  import type { SalesRecord } from '$lib/services/types';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { calculateLaunchDays, calculateDayTotals } from '$lib/utils/launch-metrics';
  import { generateCsv, copyToClipboard as clipboardCopy, downloadFile, sanitizeFilename } from '$lib/utils/csv-export';

  interface Props {
    id: number;
    name: string;
    idLabel?: string;
    records: SalesRecord[];
    maxDays: number;
  }

  let { id, name, idLabel = 'App ID', records, maxDays }: Props = $props();

  // Calculate launch day and aggregate data by day offset
  const tableData = $derived(calculateLaunchDays(records, maxDays));

  let copyFeedback = $state(false);

  function generateCsvContent(): string {
    const data = tableData;
    if (!data.launchDate || data.days.length === 0) return '';

    const headers = ['Day', 'Date', 'Units Sold', 'Returns', 'Activations', 'Bundle', 'Net Revenue (USD)'];
    const rows = data.days.map(d => [
      d.day.toString(),
      d.date,
      d.sold.toString(),
      d.returned.toString(),
      d.activated.toString(),
      d.bundle.toString(),
      d.netRevenue.toFixed(2)
    ]);

    return generateCsv(headers, rows);
  }

  async function copyToClipboard() {
    const csvContent = generateCsvContent();
    if (!csvContent) return;

    const success = await clipboardCopy(csvContent);
    if (success) {
      copyFeedback = true;
      setTimeout(() => copyFeedback = false, 2000);
    }
  }

  function downloadCsv() {
    const csvContent = generateCsvContent();
    if (!csvContent) return;

    downloadFile(csvContent, `${sanitizeFilename(name)}_launch_report.csv`);
  }

  // Calculate totals
  const totals = $derived(calculateDayTotals(tableData.days));
</script>

<div class="glass-card overflow-hidden">
  <!-- Header -->
  <div class="p-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div>
      <h3 class="text-lg font-bold font-['Fredoka'] flex items-center gap-2">
        <span class="text-xl">&#127918;</span>
        {name}
      </h3>
      <p class="text-sm text-purple-300">
        {idLabel}: {id}
        {#if tableData.launchDate}
          <span class="mx-2">|</span>
          Launch: {tableData.launchDate}
        {/if}
      </p>
    </div>
    
    <div class="flex self-start sm:self-auto p-[2px] rounded-lg bg-gradient-to-r from-pink-500 via-purple-500 to-cyan-500">
      <div class="flex bg-purple-900/90 rounded-md">
        <button
          class="px-3 py-1.5 rounded-l-md text-purple-200 text-sm
                 transition-colors flex items-center gap-1.5 border-r border-white/10
                 hover:bg-white/10 hover:text-white
                 disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={copyToClipboard}
          disabled={tableData.days.length === 0}
          title="Copy to clipboard"
        >
          {#if copyFeedback}
            <span>&#10003;</span>
            Copied!
          {:else}
            <span>&#128203;</span>
            Copy
          {/if}
        </button>
        <button
          class="px-3 py-1.5 rounded-r-md text-purple-200 text-sm
                 transition-colors flex items-center gap-1.5
                 hover:bg-white/10 hover:text-white
                 disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={downloadCsv}
          disabled={tableData.days.length === 0}
          title="Download CSV file"
        >
          <span>&#128190;</span>
          Download
        </button>
      </div>
    </div>
  </div>

  {#if tableData.days.length === 0}
    <div class="p-8 text-center text-purple-300">
      <p>No data available for this product within the selected day range.</p>
    </div>
  {:else}
    <!-- Table -->
    <div class="overflow-x-auto">
      <table class="magic-table">
        <thead>
          <tr>
            <th>Day</th>
            <th>Date</th>
            <th>Sold</th>
            <th>Returns</th>
            <th>Activations</th>
            <th>Bundle</th>
            <th>Net Revenue</th>
          </tr>
        </thead>
        <tbody>
          {#each tableData.days as day (day.day)}
            <tr>
              <td class="font-mono font-semibold text-purple-300">Day {day.day}</td>
              <td class="font-mono text-sm">{day.date}</td>
              <td class="font-mono text-green-400">{formatNumber(day.sold)}</td>
              <td class="font-mono text-red-400">{formatNumber(day.returned)}</td>
              <td class="font-mono text-blue-400">{formatNumber(day.activated)}</td>
              <td class="font-mono text-orange-400">{formatNumber(day.bundle)}</td>
              <td class="font-mono font-semibold text-green-400">{formatCurrency(day.netRevenue)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr class="border-t-2 border-white/20 bg-white/5">
            <td colspan="2" class="font-bold text-purple-200">Total ({tableData.days.length} days)</td>
            <td class="font-mono font-bold text-green-400">{totals.sold.toLocaleString()}</td>
            <td class="font-mono font-bold text-red-400">{totals.returned.toLocaleString()}</td>
            <td class="font-mono font-bold text-blue-400">{totals.activated.toLocaleString()}</td>
            <td class="font-mono font-bold text-orange-400">{totals.bundle.toLocaleString()}</td>
            <td class="font-mono font-bold text-green-400">{formatCurrency(totals.netRevenue)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  {/if}
</div>
