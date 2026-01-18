import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Custom plugin to handle Steam API proxy with proper redirect following
function steamApiProxy(): Plugin {
  return {
    name: 'steam-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/steam/')) {
          return next();
        }

        try {
          // Extract the path after /api/steam/
          const steamPath = req.url.replace('/api/steam/', '');
          
          // Use the correct partner API endpoint (not partner.steamgames.com which is the web portal)
          // See: https://partner.steamgames.com/doc/webapi_overview
          const targetUrl = `https://partner.steam-api.com/${steamPath}`;
          
          const response = await fetch(targetUrl, {
            method: req.method || 'GET',
            headers: {
              'User-Agent': 'SteamSalesAnalyzer/1.0',
              'Accept': 'application/json'
            },
            redirect: 'follow'
          });

          // Only log errors or non-200 responses to reduce noise
          if (response.status !== 200) {
            console.log(`[Steam Proxy] ${req.url} -> ${response.status} ${response.statusText}`);
          }
          
          // Copy status and headers
          res.statusCode = response.status;
          
          // Set CORS headers to allow browser access
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          
          // Copy content-type if present
          const contentType = response.headers.get('content-type');
          if (contentType) {
            res.setHeader('Content-Type', contentType);
          }

          // Get the response body
          const body = await response.text();
          
          res.end(body);
        } catch (error) {
          console.error('[Steam Proxy] Error:', error);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Proxy error', message: String(error) }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    steamApiProxy()
  ],
  resolve: {
    alias: {
      '$lib': path.resolve(__dirname, './src/lib')
    }
  },
  server: {
    port: 5173,
    hmr: {
      // Increase timeout to prevent premature reloads
      timeout: 5000
    },
    watch: {
      // Ignore certain files/patterns that might trigger unnecessary reloads
      ignored: ['**/node_modules/**', '**/.git/**']
    }
  }
});
