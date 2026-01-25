<script lang="ts">
  import { onMount } from 'svelte';
  import { salesRecordsStore, filterStore } from '$lib/stores/sqlite-stores';
  import type { SalesRecord } from '$lib/api/query-client';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { getCountryName } from '$lib/utils/countries';
  import Modal from './ui/Modal.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  // Access nested stores
  const loadingStore = salesRecordsStore.loading;
  const errorStore = salesRecordsStore.error;
  const paginationStore = salesRecordsStore.pagination;

  type SortField = 'date' | 'appName' | 'countryCode' | 'grossUnitsSold' | 'netSalesUsd';
  type SortDirection = 'asc' | 'desc';

  let sortField = $state<SortField>('date');
  let sortDirection = $state<SortDirection>('desc');

  // Raw record modal state
  let selectedRecord = $state<SalesRecord | null>(null);
  let showRecordModal = $state(false);

  onMount(async () => {
    await salesRecordsStore.load($filterStore, 'date', 'desc');
  });

  // React to filter changes
  $effect(() => {
    const filters = $filterStore;
    const sortBy = sortField === 'date' ? 'date' : sortField === 'netSalesUsd' ? 'revenue' : 'units';
    salesRecordsStore.load(filters, sortBy, sortDirection);
  });

  function handleSort(field: SortField) {
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDirection = 'desc';
    }
  }

  function showRecordDetails(record: SalesRecord) {
    selectedRecord = record;
    showRecordModal = true;
  }

  function loadMore() {
    salesRecordsStore.loadMore();
  }
</script>

<div class="glass-card p-6">
  <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Sales Records</h3>

  {#if $loadingStore && $salesRecordsStore.length === 0}
    <div class="text-center py-12 text-purple-300">Loading sales data...</div>
  {:else if $errorStore}
    <EmptyState title="Error" message="Error loading sales data: {$errorStore}" />
  {:else if $salesRecordsStore.length === 0}
    <EmptyState title="No Data" message="No sales records found for the selected filters" />
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-white/10">
            <th
              class="text-left p-2 cursor-pointer hover:text-purple-300"
              onclick={() => handleSort('date')}
            >
              Date {sortField === 'date' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th
              class="text-left p-2 cursor-pointer hover:text-purple-300"
              onclick={() => handleSort('appName')}
            >
              App {sortField === 'appName' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th
              class="text-left p-2 cursor-pointer hover:text-purple-300"
              onclick={() => handleSort('countryCode')}
            >
              Country {sortField === 'countryCode' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th
              class="text-right p-2 cursor-pointer hover:text-purple-300"
              onclick={() => handleSort('grossUnitsSold')}
            >
              Units {sortField === 'grossUnitsSold' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </th>
            <th
              class="text-right p-2 cursor-pointer hover:text-purple-300"
              onclick={() => handleSort('netSalesUsd')}
            >
              Revenue {sortField === 'netSalesUsd' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {#each $salesRecordsStore as record (record.id)}
            <tr
              class="border-b border-white/5 hover:bg-white/5 cursor-pointer"
              onclick={() => showRecordDetails(record)}
            >
              <td class="p-2">{record.date}</td>
              <td class="p-2">{record.appName || `App ${record.appId || 'N/A'}`}</td>
              <td class="p-2">{getCountryName(record.countryCode || '') || record.countryCode || 'N/A'}</td>
              <td class="p-2 text-right">{formatNumber(record.netUnitsSold)}</td>
              <td class="p-2 text-right">{formatCurrency(record.netSalesUsd)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if $paginationStore.hasMore}
      <div class="mt-4 text-center">
        <button class="btn-primary" onclick={loadMore} disabled={$loadingStore}>
          {#if $loadingStore}
            Loading...
          {:else}
            Load More ({$paginationStore.total - $salesRecordsStore.length} remaining)
          {/if}
        </button>
      </div>
    {/if}
  {/if}
</div>

{#if showRecordModal && selectedRecord}
  <Modal open={showRecordModal} onclose={() => (showRecordModal = false)} title="Record Details">
    <div class="space-y-2">
      <div><strong>Date:</strong> {selectedRecord.date}</div>
      <div><strong>App:</strong> {selectedRecord.appName || `App ${selectedRecord.appId || 'N/A'}`}</div>
      <div><strong>Country:</strong> {getCountryName(selectedRecord.countryCode || '') || selectedRecord.countryCode || 'N/A'}</div>
      <div><strong>Units Sold:</strong> {formatNumber(selectedRecord.netUnitsSold)}</div>
      <div><strong>Revenue:</strong> {formatCurrency(selectedRecord.netSalesUsd)}</div>
      {#if selectedRecord.discountPercentage}
        <div><strong>Discount:</strong> {selectedRecord.discountPercentage}%</div>
      {/if}
    </div>
  </Modal>
{/if}
