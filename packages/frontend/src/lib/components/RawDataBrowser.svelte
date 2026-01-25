<script lang="ts">
  import { onMount } from 'svelte';
  import { getDatesList, getRawDataByDate } from '$lib/api/query-client';
  import type { SalesRecord } from '$lib/api/query-client';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import { getCountryName } from '$lib/utils/countries';
  import Modal from './ui/Modal.svelte';
  import EmptyState from './ui/EmptyState.svelte';

  let dates = $state<string[]>([]);
  let selectedDate = $state<string | null>(null);
  let transactions = $state<SalesRecord[]>([]);
  let showRawModal = $state(false);
  let loadingDates = $state(false);
  let loadingTransactions = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    loadDates();
  });

  async function loadDates() {
    loadingDates = true;
    error = null;
    try {
      dates = await getDatesList();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load dates';
      console.error('[RawDataBrowser] Error loading dates:', e);
      error = errorMessage;
      dates = [];
    } finally {
      loadingDates = false;
    }
  }

  async function selectDate(date: string) {
    selectedDate = date;
    loadingTransactions = true;
    error = null;
    try {
      transactions = await getRawDataByDate(date);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load transactions';
      console.error('[RawDataBrowser] Error loading transactions for date', date, ':', e);
      error = errorMessage;
      transactions = [];
    } finally {
      loadingTransactions = false;
    }
  }

  function openRawModal() {
    showRawModal = true;
  }

  function rawJson(): string {
    return JSON.stringify(transactions, null, 2);
  }
</script>

<div class="space-y-6">
  <div class="glass-card p-6">
    <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Raw Data Browser</h3>

    {#if loadingDates}
      <div class="text-center py-12 text-purple-300">Loading dates...</div>
    {:else if error && dates.length === 0}
      <EmptyState title="Error" message={error} />
    {:else if dates.length === 0}
      <EmptyState
        icon="&#128197;"
        title="No Dates"
        message="No dates found in the database."
      />
    {:else}
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Date list -->
        <div class="lg:col-span-1">
          <h4 class="text-sm font-medium text-purple-300 mb-2">Dates in database</h4>
          <div class="max-h-64 overflow-y-auto border border-white/10 rounded-lg divide-y divide-white/5">
            {#each dates as date (date)}
              <button
                type="button"
                class="block w-full text-left px-4 py-2 hover:bg-white/10 transition-colors {selectedDate === date
                  ? 'bg-purple-500/30 text-white'
                  : 'text-purple-200'}"
                onclick={() => selectDate(date)}
              >
                {date}
              </button>
            {/each}
          </div>
        </div>

        <!-- Transactions for selected date -->
        <div class="lg:col-span-2">
          {#if !selectedDate}
            <p class="text-purple-400 text-sm">Select a date to view transactions.</p>
          {:else if loadingTransactions}
            <div class="text-center py-12 text-purple-300">Loading transactions...</div>
          {:else if error && transactions.length === 0}
            <EmptyState title="Error" message={error} />
          {:else}
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-medium text-purple-300">
                Transactions for {selectedDate} ({transactions.length} records)
              </h4>
              <button
                type="button"
                class="btn-primary text-sm py-1 px-3"
                onclick={openRawModal}
              >
                View Raw Data
              </button>
            </div>
            <div class="overflow-x-auto max-h-96 overflow-y-auto border border-white/10 rounded-lg">
              <table class="w-full text-sm">
                <thead class="sticky top-0 bg-purple-900/95">
                  <tr class="border-b border-white/10">
                    <th class="text-left p-2">Line Type</th>
                    <th class="text-left p-2">App</th>
                    <th class="text-left p-2">Package</th>
                    <th class="text-left p-2">Country</th>
                    <th class="text-right p-2">Units</th>
                    <th class="text-right p-2">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {#each transactions as record, i (selectedDate + '-' + i)}
                    <tr class="border-b border-white/5 hover:bg-white/5">
                      <td class="p-2">{record.lineItemType || '-'}</td>
                      <td class="p-2">{record.appName || `App ${record.appId ?? 'N/A'}`}</td>
                      <td class="p-2">{record.packageName || `Pkg ${record.packageId ?? 'N/A'}`}</td>
                      <td class="p-2">{getCountryName(record.countryCode || '') || record.countryCode || 'N/A'}</td>
                      <td class="p-2 text-right">{formatNumber(record.netUnitsSold)}</td>
                      <td class="p-2 text-right">{formatCurrency(record.netSalesUsd)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if showRawModal && selectedDate}
  <Modal
    open={showRawModal}
    onclose={() => (showRawModal = false)}
    title="Raw Data: {selectedDate}"
    maxWidth="3xl"
  >
    <pre class="text-xs text-purple-200 overflow-x-auto overflow-y-auto max-h-[70vh] p-4 bg-black/30 rounded-lg whitespace-pre-wrap break-all">{rawJson()}</pre>
  </Modal>
{/if}
