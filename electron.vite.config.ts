import { defineConfig } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'electron/main.ts')
        }
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          preload: path.resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html')
      }
    },
    plugins: [
      svelte(),
      tailwindcss()
    ],
    resolve: {
      alias: {
        '$lib': path.resolve(__dirname, './src/lib')
      }
    }
  }
});
