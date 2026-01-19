<script lang="ts">
  import { totalStats } from '$lib/stores/sales';
  import { formatCurrency, formatNumber } from '$lib/utils/formatters';
</script>

<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
  <!-- Total Revenue -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128176;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Total Revenue</p>
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 rainbow-text">
        {formatCurrency($totalStats.totalRevenue, { compact: true })}
      </p>
    </div>
  </div>

  <!-- Units Sold -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128230;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Units Sold</p>
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-pink-400">
        {formatNumber($totalStats.totalUnits, { showZero: true })}
      </p>
    </div>
  </div>

  <!-- Unique Products -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#127918;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Products</p>
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-blue-400">
        {formatNumber($totalStats.uniqueApps, { showZero: true })}
      </p>
    </div>
  </div>

  <!-- Countries -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#127758;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Countries</p>
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-green-400">
        {formatNumber($totalStats.uniqueCountries, { showZero: true })}
      </p>
    </div>
  </div>

  <!-- Records -->
  <div class="glass-card p-4 relative overflow-hidden group hover:scale-105 transition-transform">
    <div
      class="absolute -top-4 -right-4 text-6xl opacity-10 group-hover:opacity-20 transition-opacity"
    >
      &#128202;
    </div>
    <div class="relative">
      <p class="text-purple-300 text-sm font-medium">Data Records</p>
      <p class="text-2xl font-bold font-['Fredoka'] mt-1 text-yellow-400">
        {formatNumber($totalStats.totalRecords, { showZero: true })}
      </p>
    </div>
  </div>
</div>
