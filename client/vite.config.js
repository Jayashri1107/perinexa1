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
  server: {
    port: client.port,
    strictPort: true,
    proxy: {
      [server.apiPrefix]: `http://${server.host}:${server.port}`,
    },
  },
});
