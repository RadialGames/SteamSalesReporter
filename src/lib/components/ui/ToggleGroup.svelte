<script lang="ts">
  interface Option {
    value: string;
    label: string;
    icon?: string;
  }

  interface Props {
    options: Option[];
    value: string;
    size?: 'sm' | 'md' | 'lg';
    onchange?: (value: string) => void;
  }

  let { options, value, size = 'md', onchange }: Props = $props();

  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-2 text-base'
  };

  function handleClick(newValue: string) {
    if (onchange) {
      onchange(newValue);
    }
  }
</script>

<div class="flex rounded-lg bg-white/10 p-1">
  {#each options as option}
    <button
      class="rounded-md transition-colors {sizeClasses[size]} {value === option.value 
        ? 'bg-purple-500 text-white' 
        : 'text-purple-300 hover:text-white'}"
      onclick={() => handleClick(option.value)}
    >
      {#if option.icon}
        <span class="mr-1">{@html option.icon}</span>
      {/if}
      {option.label}
    </button>
  {/each}
</div>
