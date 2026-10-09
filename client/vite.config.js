import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { loadConfig } from '../config/loadConfig.js';

// Ports and the API address come from config/*.json – the same settings the server uses.
// Only these non-secret values are passed to the website.
const { server, client } = loadConfig();

export default defineConfig({
  plugins: [react()],
  define: {
    __API_PREFIX__: JSON.stringify(server.apiPrefix),
  },
  // Prepare every page's libraries at start-up (owner, 9 Oct 2026): pages load on demand, and without this the
  // development server found new libraries late and reloaded the page by itself – which could swallow a first sign-in.
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.jsx'],
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'lucide-react'],
  },
  server: {
    port: client.port,
    strictPort: true,
    proxy: {
      [server.apiPrefix]: `http://${server.host}:${server.port}`,
    },
  },
});
