import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src/lib')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      timeout: 5000
    },
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**']
    },
    // No proxy needed - using Tauri APIs directly
  },
  clearScreen: false,
  envPrefix: ['VITE_'],
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  }
});
