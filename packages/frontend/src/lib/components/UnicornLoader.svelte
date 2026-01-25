<script lang="ts">
  interface Props {
    message?: string;
    size?: 'small' | 'medium' | 'large';
  }

  let { message = 'Loading...', size = 'medium' }: Props = $props();

  const sizeClasses = {
    small: 'w-12 h-12',
    medium: 'w-24 h-24',
    large: 'w-32 h-32',
  };
</script>

<div class="flex flex-col items-center justify-center gap-4">
  <!-- Animated unicorn -->
  <div class="relative {sizeClasses[size]}">
    <!-- Rainbow trail -->
    <div class="absolute inset-0 rainbow-shimmer rounded-full opacity-30 blur-xl"></div>

    <!-- Bouncing unicorn -->
    <div class="relative unicorn-bounce">
      <svg viewBox="0 0 64 64" class="w-full h-full drop-shadow-lg">
        <defs>
          <linearGradient id="loaderRainbow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ff6b6b">
              <animate
                attributeName="stop-color"
                values="#ff6b6b;#feca57;#48dbfb;#ff9ff3;#a55eea;#ff6b6b"
                dur="3s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="50%" style="stop-color:#48dbfb">
              <animate
                attributeName="stop-color"
                values="#48dbfb;#ff9ff3;#a55eea;#ff6b6b;#feca57;#48dbfb"
                dur="3s"
                repeatCount="indefinite"
              />
            </stop>
            <stop offset="100%" style="stop-color:#a55eea">
              <animate
                attributeName="stop-color"
                values="#a55eea;#ff6b6b;#feca57;#48dbfb;#ff9ff3;#a55eea"
                dur="3s"
                repeatCount="indefinite"
              />
            </stop>
          </linearGradient>
        </defs>
        <!-- Unicorn body -->
        <ellipse cx="32" cy="40" rx="18" ry="12" fill="#f8f9fa" />
        <!-- Head -->
        <circle cx="46" cy="28" r="10" fill="#f8f9fa" />
        <!-- Horn (animated gradient) -->
        <polygon points="52,18 54,6 56,18" fill="url(#loaderRainbow)" />
        <!-- Mane (animated gradient) -->
        <path
          d="M38 24 Q32 20 36 14 Q30 18 34 10 Q28 16 30 8"
          stroke="url(#loaderRainbow)"
          stroke-width="3"
          fill="none"
          stroke-linecap="round"
        />
        <!-- Eye -->
        <circle cx="50" cy="26" r="2" fill="#5f27cd" />
        <!-- Blush -->
        <circle cx="44" cy="32" r="3" fill="#ffb6c1" opacity="0.5" />
        <!-- Legs -->
        <rect x="20" y="48" width="4" height="10" rx="2" fill="#f8f9fa" />
        <rect x="28" y="48" width="4" height="10" rx="2" fill="#f8f9fa" />
        <rect x="36" y="48" width="4" height="10" rx="2" fill="#f8f9fa" />
        <rect x="44" y="48" width="4" height="10" rx="2" fill="#f8f9fa" />
        <!-- Tail (animated gradient) -->
        <path
          d="M14 38 Q6 34 8 42 Q2 38 6 46 Q0 44 4 50"
          stroke="url(#loaderRainbow)"
          stroke-width="3"
          fill="none"
          stroke-linecap="round"
        />
      </svg>
    </div>

    <!-- Sparkles around unicorn -->
    <div class="absolute -top-2 -left-2 text-yellow-300 sparkle" style="animation-delay: 0s;">
      &#10022;
    </div>
    <div class="absolute -top-1 -right-3 text-pink-300 sparkle" style="animation-delay: 0.5s;">
      &#10022;
    </div>
    <div class="absolute -bottom-1 -left-3 text-blue-300 sparkle" style="animation-delay: 1s;">
      &#10022;
    </div>
    <div class="absolute -bottom-2 -right-2 text-purple-300 sparkle" style="animation-delay: 1.5s;">
      &#10022;
    </div>
  </div>

  <!-- Loading message -->
  {#if message}
    <div class="text-center">
      <p class="text-purple-200 font-medium font-['Fredoka']">{message}</p>
      <div class="flex justify-center gap-1 mt-2">
        <span
          class="w-2 h-2 bg-purple-400 rounded-full animate-bounce"
          style="animation-delay: 0ms;"
        ></span>
        <span
          class="w-2 h-2 bg-pink-400 rounded-full animate-bounce"
          style="animation-delay: 150ms;"
        ></span>
        <span
          class="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
          style="animation-delay: 300ms;"
        ></span>
      </div>
    </div>
  {/if}
</div>
