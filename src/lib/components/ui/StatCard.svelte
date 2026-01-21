<script lang="ts">
  interface Props {
    icon: string;
    label: string;
    value: string | number;
    colorClass?: string;
    isLoading?: boolean;
  }

  let { icon, label, value, colorClass = 'text-white', isLoading = false }: Props = $props();
</script>

<div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
  <div
    class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
  >
    {icon}
  </div>
  <div class="relative">
    <p class="text-purple-300 text-sm font-medium">{label}</p>
    {#if isLoading}
      <div class="h-8 mt-1 flex items-center">
        <div class="h-6 w-20 bg-white/20 rounded animate-pulse"></div>
      </div>
    {:else}
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 {colorClass}">
        {value}
      </p>
    {/if}
  </div>
</div>
