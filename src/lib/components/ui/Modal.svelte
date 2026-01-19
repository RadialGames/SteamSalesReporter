<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title?: string;
    subtitle?: string;
    icon?: string;
    maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
    onclose?: () => void;
    header?: Snippet;
    children: Snippet;
    footer?: Snippet;
  }

  let { 
    open, 
    title, 
    subtitle,
    icon,
    maxWidth = 'lg',
    onclose, 
    header,
    children, 
    footer 
  }: Props = $props();

  const maxWidthClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl'
  };

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && onclose) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && onclose) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    onclick={handleBackdropClick}
  >
    <div class="rainbow-border {maxWidthClasses[maxWidth]} w-full max-h-[90vh] overflow-hidden flex flex-col">
      <div class="modal-inner p-6 flex flex-col h-full overflow-hidden">
        <!-- Header -->
        {#if header}
          {@render header()}
        {:else if title}
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              {#if icon}
                <span class="text-2xl">{@html icon}</span>
              {/if}
              <div>
                <h3 class="text-lg font-bold font-['Fredoka'] rainbow-text">
                  {title}
                </h3>
                {#if subtitle}
                  <p class="text-purple-300 text-sm">{subtitle}</p>
                {/if}
              </div>
            </div>
            {#if onclose}
              <button
                type="button"
                class="text-purple-300 hover:text-white transition-colors text-2xl"
                onclick={onclose}
              >
                &#10005;
              </button>
            {/if}
          </div>
        {/if}

        <!-- Content -->
        <div class="flex-1 overflow-auto min-h-0">
          {@render children()}
        </div>

        <!-- Footer -->
        {#if footer}
          <div class="mt-4 pt-4 border-t border-white/10">
            {@render footer()}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
