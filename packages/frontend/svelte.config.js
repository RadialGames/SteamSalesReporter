import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true
  },
  onwarn: (warning, handler) => {
    // Suppress a11y warnings
    if (warning.code.startsWith('a11y_')) return;
    handler(warning);
  }
};
