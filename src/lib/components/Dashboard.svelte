<script lang="ts">
  import ChartsView from './ChartsView.svelte';
  import DataTableView from './DataTableView.svelte';
  import LaunchComparison from './LaunchComparison.svelte';
  import PackageMetrics from './PackageMetrics.svelte';
  import { onMount } from 'svelte';
  import { ToggleGroup } from './ui';
  import type { ApiKeyInfo } from '$lib/services/types';
  import { getParsedRecordsCount } from '$lib/db/parsed-data';

  type TabId = 'charts' | 'dataTable' | 'launchComparison' | 'packageMetrics';

  const validTabs: TabId[] = ['charts', 'dataTable', 'launchComparison', 'packageMetrics'];

  interface Props {
    apiKeys?: ApiKeyInfo[];
  }

  let { apiKeys = [] }: Props = $props();

  let activeTab = $state<TabId>('charts');
  let hasData = $state(false);

  const tabOptions = [
    { value: 'charts', label: 'Charts', icon: '&#128200;' },
    { value: 'dataTable', label: 'Data Table', icon: '&#128203;' },
    { value: 'launchComparison', label: 'Launch Comparison', icon: '&#128640;' },
    { value: 'packageMetrics', label: 'Package Metrics', icon: '&#128202;' },
  ];

  // Read tab from URL hash
  function getTabFromHash(): TabId {
    const hash = window.location.hash.slice(1); // Remove the '#'
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

    // Check for data asynchronously
    getParsedRecordsCount().then((count) => {
      hasData = count > 0;
    });

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  });
</script>

<div class="space-y-6">
  {#if !hasData}
    <!-- Welcome State - Only unicorn bubble when no data (no tabs shown) -->
    <div class="glass-card p-12 text-center">
      <div class="text-8xl mb-4 unicorn-bounce inline-block">&#129412;</div>
      <h2 class="text-2xl font-bold font-['Fredoka'] mb-2 rainbow-text">
        {apiKeys.length === 0 ? 'Welcome to Steam Sales Analyzer!' : 'Ready to Analyze Your Sales!'}
      </h2>
      <p class="text-purple-200 mb-6 max-w-md mx-auto">
        {#if apiKeys.length === 0}
          Get started by clicking the <strong>"Settings"</strong> button above to add your Steam API key.
          Once configured, you'll be able to fetch and analyze your sales data.
        {:else}
          Click the <strong>"Refresh Data"</strong> button above to fetch your Steam sales data and start
          exploring your financial analytics.
        {/if}
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

    {#if activeTab === 'charts'}
      <ChartsView />
    {:else if activeTab === 'dataTable'}
      <DataTableView />
    {:else if activeTab === 'launchComparison'}
      <LaunchComparison />
    {:else if activeTab === 'packageMetrics'}
      <PackageMetrics />
    {/if}
  {/if}
</div>
