<script lang="ts">
  import { salesStore, filterStore } from '$lib/stores/sales';
  import type { SalesRecord } from '$lib/services/types';

  type SortField = 'date' | 'appName' | 'countryCode' | 'grossUnitsSold' | 'netSalesUsd';
  type SortDirection = 'asc' | 'desc';

  let sortField = $state<SortField>('date');
  let sortDirection = $state<SortDirection>('desc');
  let currentPage = $state(1);
  const pageSize = 25;

  // Apply filters and sorting
  const filteredData = $derived(() => {
    // Filter out AppID 0 (Valve placeholder data)
    let data = [...$salesStore].filter(r => r.appId !== 0);
    const filters = $filterStore;

    // Apply filters
    if (filters.startDate) {
      data = data.filter(r => r.date >= filters.startDate!);
    }
    if (filters.endDate) {
      data = data.filter(r => r.date <= filters.endDate!);
    }
    if (filters.appId) {
      data = data.filter(r => r.appId === filters.appId);
    }
    if (filters.countryCode) {
      data = data.filter(r => r.countryCode === filters.countryCode);
    }

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
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      
      return sortDirection === 'asc' 
        ? (aVal as number) - (bVal as number) 
        : (bVal as number) - (aVal as number);
    });

    return data;
  });

  // Pagination
  const totalPages = $derived(Math.ceil(filteredData().length / pageSize));
  const paginatedData = $derived(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredData().slice(start, start + pageSize);
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

  function formatCurrency(value: number | undefined): string {
    if (value === undefined || value === null) return '-';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(value: number | undefined): string {
    if (value === undefined || value === null || value === 0) return '-';
    return value.toLocaleString();
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
      {filteredData().length.toLocaleString()} records
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
                gross_units_sold
                <span class="text-xs">{@html getSortIcon('grossUnitsSold')}</span>
              </button>
            </th>
            <th>gross_units_returned</th>
            <th>gross_units_activated</th>
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
          {#each paginatedData() as record}
            <tr>
              <td class="font-mono text-sm">{record.date}</td>
              <td>
                <div class="flex flex-col">
                  <span class="font-medium">{record.appName || `App ${record.appId}`}</span>
                  <span class="text-xs text-purple-400">ID: {record.appId}</span>
                </div>
              </td>
              <td>
                <span class="inline-flex items-center gap-1 px-2 py-1 bg-purple-500/20 rounded text-sm">
                  {record.countryCode}
                </span>
              </td>
              <td class="font-mono">{formatNumber(record.grossUnitsSold)}</td>
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
            onclick={() => currentPage = Math.max(1, currentPage - 1)}
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
          }) as page}
            <button
              class="w-8 h-8 rounded transition-colors {page === currentPage 
                ? 'bg-purple-500 text-white' 
                : 'bg-purple-500/20 hover:bg-purple-500/40'}"
              onclick={() => currentPage = page}
            >
              {page}
            </button>
          {/each}

          <button
            class="px-3 py-1 rounded bg-purple-500/20 hover:bg-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onclick={() => currentPage = Math.min(totalPages, currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next &#9654;
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
