<script lang="ts">
  import { salesStore, filterStore } from '$lib/stores/sales';
  import type { SalesRecord } from '$lib/services/types';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { getCountryName } from '$lib/utils/countries';
  import { applyFilters } from '$lib/utils/filters';
  import Modal from './ui/Modal.svelte';

  type SortField = 'date' | 'appName' | 'countryCode' | 'grossUnitsSold' | 'netSalesUsd';
  type SortDirection = 'asc' | 'desc';

  let sortField = $state<SortField>('date');
  let sortDirection = $state<SortDirection>('desc');
  let currentPage = $state(1);
  const pageSize = 25;

  // Raw record modal state
  let selectedRecord = $state<SalesRecord | null>(null);

  // Apply filters and sorting
  const filteredData = $derived.by(() => {
    // Use shared filter utility instead of duplicating filter logic
    const data = applyFilters([...$salesStore], $filterStore);

    // Apply sorting
    data.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'date':
          aVal = a.date;
          bVal = b.date;
          break;
        case 'appName':
          aVal = a.appName || `App ${a.appId}`;
          bVal = b.appName || `App ${b.appId}`;
          break;
        case 'countryCode':
          aVal = a.countryCode;
          bVal = b.countryCode;
          break;
        case 'grossUnitsSold':
          aVal = a.grossUnitsSold ?? 0;
          bVal = b.grossUnitsSold ?? 0;
          break;
        case 'netSalesUsd':
          aVal = a.netSalesUsd ?? 0;
          bVal = b.netSalesUsd ?? 0;
          break;
        default:
          return 0;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return data;
  });

  // Pagination
  const totalPages = $derived(Math.ceil(filteredData.length / pageSize));
  const paginatedData = $derived.by(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDirection = 'desc';
    }
    currentPage = 1;
  }

  function getSortIcon(field: SortField): string {
    if (sortField !== field) return '&#8693;'; // Up-down arrows
    return sortDirection === 'asc' ? '&#9650;' : '&#9660;'; // Up or down arrow
  }

  function showRawRecord(record: SalesRecord) {
    selectedRecord = record;
  }

  function closeRawModal() {
    selectedRecord = null;
  }

  function formatJson(obj: object): string {
    return JSON.stringify(obj, null, 2);
  }
</script>

<div class="glass-card overflow-hidden">
  <!-- Table Header with title and record count -->
  <div class="p-4 border-b border-white/10 flex items-center justify-between">
    <h3 class="text-lg font-bold font-['Fredoka'] flex items-center gap-2">
      <span class="text-2xl">&#128203;</span>
      Sales Records
    </h3>
    <span class="text-purple-300 text-sm">
      {filteredData.length.toLocaleString()} records
    </span>
  </div>

  {#if $salesStore.length === 0}
    <div class="p-12 text-center text-purple-300">
      <span class="text-4xl block mb-2">&#128202;</span>
      <p>No data to display</p>
    </div>
  {:else}
    <!-- Table -->
    <div class="overflow-x-auto">
      <table class="magic-table">
        <thead>
          <tr>
            <th class="w-8"></th>
            <th>
              <button
                class="flex items-center gap-1 hover:text-purple-300 transition-colors"
                onclick={() => toggleSort('date')}
              >
                Date
                <span class="text-xs">{@html getSortIcon('date')}</span>
              </button>
            </th>
            <th>
              <button
                class="flex items-center gap-1 hover:text-purple-300 transition-colors"
                onclick={() => toggleSort('appName')}
              >
                Product
                <span class="text-xs">{@html getSortIcon('appName')}</span>
              </button>
            </th>
            <th>
              <button
                class="flex items-center gap-1 hover:text-purple-300 transition-colors"
                onclick={() => toggleSort('countryCode')}
              >
                Country
                <span class="text-xs">{@html getSortIcon('countryCode')}</span>
              </button>
            </th>
            <th>
              <button
                class="flex items-center gap-1 hover:text-purple-300 transition-colors"
                onclick={() => toggleSort('grossUnitsSold')}
              >
                Sold
                <span class="text-xs">{@html getSortIcon('grossUnitsSold')}</span>
              </button>
            </th>
            <th>Returns</th>
            <th>Activations</th>
            <th>
              <button
                class="flex items-center gap-1 hover:text-purple-300 transition-colors"
                onclick={() => toggleSort('netSalesUsd')}
              >
                net_sales_usd
                <span class="text-xs">{@html getSortIcon('netSalesUsd')}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {#each paginatedData as record (record.id)}
            <tr>
              <td class="text-center">
                <button
                  type="button"
                  class="w-6 h-6 rounded bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 hover:text-white text-xs transition-colors"
                  onclick={() => showRawRecord(record)}
                  title="View raw record"
                >
                  &#123;&#125;
                </button>
              </td>
              <td class="font-mono text-sm">{record.date}</td>
              <td>
                <div class="flex flex-col">
                  <span class="font-medium">{record.appName || `App ${record.appId}`}</span>
                  <span class="text-xs text-purple-400">ID: {record.appId}</span>
                </div>
              </td>
              <td>
                <span
                  class="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 rounded text-sm cursor-help"
                  title={getCountryName(record.countryCode)}
                >
                  {record.countryCode}
                </span>
              </td>
              <td class="font-mono text-green-400">{formatNumber(record.grossUnitsSold)}</td>
              <td class="font-mono text-red-400">{formatNumber(record.grossUnitsReturned)}</td>
              <td class="font-mono text-blue-400">{formatNumber(record.grossUnitsActivated)}</td>
              <td class="font-mono font-semibold text-green-400">
                {formatCurrency(record.netSalesUsd)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    {#if totalPages > 1}
      <div class="p-4 border-t border-white/10 flex items-center justify-between">
        <span class="text-sm text-purple-300">
          Page {currentPage} of {totalPages}
        </span>
        <div class="flex gap-2">
          <button
            class="px-3 py-1 rounded bg-purple-500/20 hover:bg-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onclick={() => (currentPage = Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            &#9664; Prev
          </button>

          {#each Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            // Show pages around current page
            let page: number;
            if (totalPages <= 5) {
              page = i + 1;
            } else if (currentPage <= 3) {
              page = i + 1;
            } else if (currentPage >= totalPages - 2) {
              page = totalPages - 4 + i;
            } else {
              page = currentPage - 2 + i;
            }
            return page;
          }) as page (page)}
            <button
              class="w-8 h-8 rounded transition-colors {page === currentPage
                ? 'bg-purple-500 text-white'
                : 'bg-purple-500/20 hover:bg-purple-500/40'}"
              onclick={() => (currentPage = page)}
            >
              {page}
            </button>
          {/each}

          <button
            class="px-3 py-1 rounded bg-purple-500/20 hover:bg-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onclick={() => (currentPage = Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
          >
            Next &#9654;
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>

<!-- Raw Record Modal -->
<Modal
  open={selectedRecord !== null}
  title="Raw Record Data"
  subtitle={selectedRecord
    ? `${selectedRecord.date} | ${selectedRecord.appName || `App ${selectedRecord.appId}`} | ${selectedRecord.countryCode}`
    : ''}
  icon="&#128203;"
  maxWidth="3xl"
  onclose={closeRawModal}
>
  {#if selectedRecord}
    <div class="bg-purple-900/50 rounded-lg p-4">
      <pre class="text-sm text-purple-100 font-mono whitespace-pre-wrap break-words">{formatJson(
          selectedRecord
        )}</pre>
    </div>
  {/if}

  {#snippet footer()}
    <div class="flex justify-end">
      <button type="button" class="btn-primary" onclick={closeRawModal}> Close </button>
    </div>
  {/snippet}
</Modal>
