<script lang="ts">
  import UnicornLoader from '../UnicornLoader.svelte';
  import EmptyState from './EmptyState.svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    isLoading: boolean;
    hasData: boolean;
    loadingMessage?: string;
    emptyIcon?: string;
    emptyTitle?: string;
    emptyMessage?: string;
    children?: Snippet;
  }

  let {
    isLoading,
    hasData,
    loadingMessage = 'Loading...',
    emptyIcon = '&#128202;',
    emptyTitle = 'No Data Available',
    emptyMessage,
    children,
  }: Props = $props();
</script>

{#if isLoading}
  <div class="glass-card p-12 text-center">
    <UnicornLoader message={loadingMessage} />
  </div>
{:else if !hasData}
  <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
{:else if children}
  {@render children()}
{/if}
