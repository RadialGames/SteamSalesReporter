<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    icon?: string;
    title: string;
    message?: string;
    children?: Snippet;
  }

  let { icon = '&#128202;', title, message, children }: Props = $props();
</script>

<div class="glass-card p-12 text-center">
  <div class="text-6xl mb-4">{@html icon}</div>
  <h3 class="text-xl font-bold text-purple-200 mb-2">{title}</h3>
  {#if message}
    <p class="text-purple-300 mb-4">{message}</p>
  {/if}
  {#if children}
    <div class="mt-4">
      {@render children()}
    </div>
  {/if}
</div>
