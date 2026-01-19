<script lang="ts">
  interface Option {
    value: string;
    label: string;
    icon?: string;
    /** Custom active background color class (e.g., 'bg-pink-500') */
    activeClass?: string;
  }

  interface Props {
    options: Option[];
    value: string;
    size?: 'sm' | 'md' | 'lg';
    /** Label shown before the toggle group */
    label?: string;
    /** Visual variant: 'default' for inline toggles, 'tabs' for larger tab-style buttons */
    variant?: 'default' | 'tabs' | 'tabs-secondary';
    onchange?: (value: string) => void;
  }

  let { options, value, size = 'md', label, variant = 'default', onchange }: Props = $props();

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  function handleClick(newValue: string) {
    if (onchange) {
      onchange(newValue);
    }
  }

  function getActiveClass(option: Option): string {
    return option.activeClass || 'bg-purple-500';
  }

  function getButtonClasses(option: Option, isActive: boolean): string {
    if (variant === 'tabs') {
      // Primary tabs - larger, with shadows, rounded-top
      return isActive
        ? 'px-6 py-3 rounded-t-lg font-bold text-lg bg-purple-600 text-white shadow-lg shadow-purple-600/30 transition-all'
        : 'px-6 py-3 rounded-t-lg font-bold text-lg bg-white/5 text-purple-300 hover:bg-white/10 transition-all';
    }
    if (variant === 'tabs-secondary') {
      // Secondary tabs - medium size, with shadows
      return isActive
        ? `px-4 py-2 rounded-lg font-semibold ${getActiveClass(option)} text-white shadow-lg shadow-purple-500/30 transition-all`
        : 'px-4 py-2 rounded-lg font-semibold bg-white/10 text-purple-200 hover:bg-white/20 transition-all';
    }
    // Default toggle style
    return isActive
      ? `rounded-md transition-colors ${sizeClasses[size]} ${getActiveClass(option)} text-white`
      : `rounded-md transition-colors ${sizeClasses[size]} text-purple-300 hover:text-white`;
  }
</script>

<div class="flex items-center gap-2">
  {#if label}
    <span class="text-purple-200 text-sm">{label}</span>
  {/if}
  {#if variant === 'default'}
    <div class="flex rounded-lg bg-white/10 p-1">
      {#each options as option (option.value)}
        <button
          type="button"
          class={getButtonClasses(option, value === option.value)}
          onclick={() => handleClick(option.value)}
        >
          {#if option.icon}
            <span class="mr-1">{@html option.icon}</span>
          {/if}
          {option.label}
        </button>
      {/each}
    </div>
  {:else}
    <div class="flex gap-2">
      {#each options as option (option.value)}
        <button
          type="button"
          class={getButtonClasses(option, value === option.value)}
          onclick={() => handleClick(option.value)}
        >
          {#if option.icon}
            <span class="mr-2">{@html option.icon}</span>
          {/if}
          {option.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
