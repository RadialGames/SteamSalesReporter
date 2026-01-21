<script lang="ts">
  import { onMount } from 'svelte';
  import StatsCards from './StatsCards.svelte';
  import FilterBar from './FilterBar.svelte';
  import ChartsGrid from './ChartsGrid.svelte';
  import UnicornLoader from './UnicornLoader.svelte';
  import EmptyState from './ui/EmptyState.svelte';
  import { getParsedRecordsCount } from '$lib/db/parsed-data';

  let isLoading = $state(true);
  let hasData = $state(false);

  onMount(async () => {
    isLoading = true;
    try {
      const count = await getParsedRecordsCount();
      hasData = count > 0;
    } catch (error) {
      console.error('Error checking data availability:', error);
      hasData = false;
    } finally {
      isLoading = false;
    }
  });
</script>

<div class="space-y-6">
  {#if isLoading}
    <div class="glass-card p-12 text-center">
      <UnicornLoader message="Loading charts..." />
    </div>
  {:else if !hasData}
    <EmptyState
      icon="&#128202;"
      title="No Data Available"
      message="Refresh your sales data to see charts and analytics."
    />
  {:else}
    <!-- Stats Overview -->
    <StatsCards />

    <!-- Filter Bar -->
    <FilterBar />

    <!-- Charts Grid -->
    <ChartsGrid />
  {/if}
</div>
