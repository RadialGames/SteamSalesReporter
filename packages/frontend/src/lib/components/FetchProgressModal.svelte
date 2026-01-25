<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import UnicornLoader from './UnicornLoader.svelte';

  interface Props {
    open: boolean;
    onclose?: () => void;
  }

  let { open, onclose }: Props = $props();
  let progressLines = $state<string[]>([]);
  let isComplete = $state(false);
  let progressContainer: HTMLDivElement | null = $state(null);

  let unsubscribeProgress: (() => void) | null = $state(null);
  let unsubscribeComplete: (() => void) | null = $state(null);

  // Set up and clean up event listeners based on modal state
  $effect(() => {
    if (open) {
      // Reset state when modal opens
      progressLines = [];
      isComplete = false;

      // Set up event listeners only when modal is open
      let progressUnsub: (() => void) | null = null;
      let completeUnsub: (() => void) | null = null;

      // Listen for progress events from Rust
      listen<string>('fetch-progress', (event) => {
        const line = event.payload;
        if (line) {
          progressLines = [...progressLines, line];
          // Keep only last 50 lines to prevent memory issues
          if (progressLines.length > 50) {
            progressLines = progressLines.slice(-50);
          }
          // Auto-scroll to bottom
          if (progressContainer) {
            setTimeout(() => {
              progressContainer?.scrollTo({
                top: progressContainer.scrollHeight,
                behavior: 'smooth',
              });
            }, 0);
          }
        }
      })
        .then((unsub) => {
          progressUnsub = unsub;
          unsubscribeProgress = unsub;
        })
        .catch((err) => {
          console.warn('[FetchProgressModal] Failed to set up progress listener:', err);
        });

      // Listen for completion event
      listen('fetch-complete', () => {
        isComplete = true;
      })
        .then((unsub) => {
          completeUnsub = unsub;
          unsubscribeComplete = unsub;
        })
        .catch((err) => {
          console.warn('[FetchProgressModal] Failed to set up complete listener:', err);
        });

      // Cleanup function
      return () => {
        if (progressUnsub) {
          try {
            progressUnsub();
          } catch (err) {
            // Ignore cleanup errors during hot reload
            console.debug('[FetchProgressModal] Error cleaning up progress listener:', err);
          }
        }
        if (completeUnsub) {
          try {
            completeUnsub();
          } catch (err) {
            // Ignore cleanup errors during hot reload
            console.debug('[FetchProgressModal] Error cleaning up complete listener:', err);
          }
        }
        unsubscribeProgress = null;
        unsubscribeComplete = null;
      };
    } else {
      // Clean up when modal closes
      if (unsubscribeProgress) {
        try {
          unsubscribeProgress();
        } catch (err) {
          // Ignore cleanup errors
          console.debug('[FetchProgressModal] Error cleaning up progress listener:', err);
        }
        unsubscribeProgress = null;
      }
      if (unsubscribeComplete) {
        try {
          unsubscribeComplete();
        } catch (err) {
          // Ignore cleanup errors
          console.debug('[FetchProgressModal] Error cleaning up complete listener:', err);
        }
        unsubscribeComplete = null;
      }
    }
  });
</script>

{#if open}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
    <div class="rainbow-border max-w-2xl w-full max-h-[80vh] flex flex-col">
      <div class="modal-inner p-6 flex flex-col flex-1 min-h-0">
        <!-- Header -->
        <div class="flex items-center gap-4 mb-4">
          <div class="text-4xl unicorn-bounce">
            {#if isComplete}
              &#10024;
            {:else}
              &#128176;
            {/if}
          </div>
          <div>
            <h2 class="text-xl font-bold font-['Fredoka'] rainbow-text">
              {#if isComplete}
                Fetch Complete!
              {:else}
                Fetching Sales Data
              {/if}
            </h2>
            <p class="text-purple-200 text-sm mt-1">
              {#if isComplete}
                Your sales data has been downloaded successfully.
              {:else}
                This may take several minutes. Please wait...
              {/if}
            </p>
          </div>
        </div>

        <!-- Progress Output -->
        <div class="flex-1 overflow-hidden flex flex-col">
          <div
            bind:this={progressContainer}
            class="glass-card p-4 flex-1 overflow-y-auto font-mono text-sm"
          >
            {#if progressLines.length === 0}
              <div class="flex items-center justify-center h-full">
                <UnicornLoader message="Starting fetch..." />
              </div>
            {:else}
              <div class="space-y-1">
                {#each progressLines as line, i (i)}
                  <div class="text-purple-200 whitespace-pre-wrap break-words">
                    {line}
                  </div>
                {/each}
                {#if !isComplete}
                  <div class="text-purple-400 flex items-center gap-2">
                    <span class="inline-block animate-spin">&#10226;</span>
                    <span>Processing...</span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <!-- Actions -->
        <div class="mt-4 flex justify-end">
          {#if isComplete}
            <button
              type="button"
              class="btn-rainbow flex items-center justify-center gap-2"
              onclick={() => onclose?.()}
            >
              <span>&#10024;</span>
              Continue
            </button>
          {:else}
            <div class="flex items-center gap-2 text-purple-300">
              <span class="inline-block animate-spin">&#10226;</span>
              <span>Please wait...</span>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
