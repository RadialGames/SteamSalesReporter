<script lang="ts">
  import { statsStore } from '$lib/stores/sqlite-stores';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
  import StatCard from './ui/StatCard.svelte';
</script>

<div class="glass-card p-6">
  <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Database Statistics</h3>
  {#if $statsStore}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon="&#128202;"
        label="Total Records"
        value={formatNumber($statsStore.recordCount || 0)}
        colorClass="text-blue-400"
      />
      <StatCard
        icon="&#127918;"
        label="Products"
        value={formatNumber($statsStore.appCount || 0)}
        colorClass="text-green-400"
      />
      <StatCard
        icon="&#127758;"
        label="Countries"
        value={formatNumber($statsStore.countryCount || 0)}
        colorClass="text-yellow-400"
      />
      <StatCard
        icon="&#128176;"
        label="Total Revenue"
        value={formatCurrency($statsStore.totalRevenue || 0, { compact: true })}
        colorClass="rainbow-text"
      />
    </div>
  {:else}
    <p class="text-purple-300">No statistics available. Load a database file to see stats.</p>
  {/if}
</div>
