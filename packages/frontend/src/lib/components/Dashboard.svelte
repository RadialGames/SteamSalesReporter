<script lang="ts">
  import StatsCards from './StatsCards.svelte';
  import FilterBar from './FilterBar.svelte';
  import ChartsView from './ChartsView.svelte';
  import RawDataBrowser from './RawDataBrowser.svelte';
  import LaunchComparison from './LaunchComparison.svelte';
  import PackageMetrics from './PackageMetrics.svelte';
  import { onMount } from 'svelte';
  import { ToggleGroup } from './ui';
  import { databaseLoaded, statsStore } from '$lib/stores/sqlite-stores';

  type TabId = 'charts' | 'rawDataBrowser' | 'launchComparison' | 'packageMetrics';

  const validTabs: TabId[] = ['charts', 'rawDataBrowser', 'launchComparison', 'packageMetrics'];

  let activeTab = $state<TabId>('charts');
  let hasData = $state(false);

  const tabOptions = [
    { value: 'charts', label: 'Charts', icon: '&#128200;' },
    { value: 'rawDataBrowser', label: 'Raw Data Browser', icon: '&#128203;' },
    { value: 'launchComparison', label: 'Launch Comparison', icon: '&#128640;' },
    { value: 'packageMetrics', label: 'Product Details', icon: '&#128202;' },
  ];

  // Read tab from URL hash
  function getTabFromHash(): TabId {
    let hash = window.location.hash.slice(1); // Remove the '#'
    if (hash === 'dataTable') hash = 'rawDataBrowser'; // legacy redirect
    if (validTabs.includes(hash as TabId)) {
      return hash as TabId;
    }
    return 'charts';
  }

  // Update URL hash when tab changes
  function setTabHash(tab: TabId) {
    // Use replaceState to avoid cluttering browser history with tab changes
    const url = new URL(window.location.href);
    url.hash = tab;
    window.history.replaceState(null, '', url.toString());
  }

  // Handle tab change from UI
  function handleTabChange(newTab: string) {
    activeTab = newTab as TabId;
    setTabHash(activeTab);
  }

  // Listen for browser back/forward navigation
  function handleHashChange() {
    activeTab = getTabFromHash();
  }

  onMount(() => {
    // Set initial tab from URL hash
    activeTab = getTabFromHash();

    // Listen for hash changes (back/forward buttons)
    window.addEventListener('hashchange', handleHashChange);

    // Check for data - if database is loaded and stats exist, we have data
    const unsubDb = databaseLoaded.subscribe((loaded) => {
      if (loaded && $statsStore) {
        hasData = ($statsStore.recordCount || 0) > 0;
      } else {
        hasData = false;
      }
    });

    // Also check stats directly
    const unsubStats = statsStore.subscribe((stats) => {
      if (stats && $databaseLoaded) {
        hasData = (stats.recordCount || 0) > 0;
      }
    });

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      unsubDb();
      unsubStats();
    };
  });
</script>

<div class="space-y-6">
  <StatsCards />

  {#if !hasData}
    <!-- Welcome State - Only unicorn bubble when no data (no tabs shown) -->
    <div class="glass-card p-12 text-center">
      <div class="text-8xl mb-4 unicorn-bounce inline-block">&#129412;</div>
      <h2 class="text-2xl font-bold font-['Fredoka'] mb-2 rainbow-text">
        Ready to Analyze Your Sales!
      </h2>
      <p class="text-purple-200 mb-6 max-w-md mx-auto">
        Load your database file to start exploring your financial analytics.
      </p>
      <div class="flex justify-center gap-2 flex-wrap">
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Revenue tracking
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Product comparison
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Geographic insights
        </div>
        <div class="glass-card px-4 py-2 text-sm">
          <span class="text-purple-400">&#10003;</span> Historical trends
        </div>
      </div>
    </div>
  {:else}
    <!-- Top Level Tab Navigation (only shown when data exists) -->
    <div class="border-b border-white/10 pb-4">
      <ToggleGroup
        variant="tabs"
        options={tabOptions}
        value={activeTab}
        onchange={handleTabChange}
      />
    </div>

    {#if activeTab !== 'launchComparison'}
      <FilterBar />
    {/if}

    {#if activeTab === 'charts'}
      <ChartsView />
    {:else if activeTab === 'rawDataBrowser'}
      <RawDataBrowser />
    {:else if activeTab === 'launchComparison'}
      <LaunchComparison />
    {:else if activeTab === 'packageMetrics'}
      <PackageMetrics />
    {/if}
  {/if}
</div>
