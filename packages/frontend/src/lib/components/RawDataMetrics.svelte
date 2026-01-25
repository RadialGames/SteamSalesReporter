<script lang="ts">
  import EmptyState from './ui/EmptyState.svelte';
  import { databaseLoaded } from '$lib/stores/sqlite-stores';
</script>

<div class="glass-card p-6">
  <h3 class="text-xl font-bold font-['Fredoka'] mb-4 rainbow-text">Raw Data Metrics</h3>
  {#if !$databaseLoaded}
    <EmptyState title="No Data" message="Please load a database file to view raw data metrics." />
  {:else}
    <EmptyState title="Not Implemented" message="Raw data metrics feature is not yet implemented with the CLI tool database." />
  {/if}
</div>
