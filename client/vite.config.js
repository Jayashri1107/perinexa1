import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the website runs on :5174 and forwards /api requests to the server on :4001,
// so the browser sees one address and the login cookie works with sameSite=strict.
// (Perinexa1 uses 5174/4001 so it can run beside Perinexa, which uses 5173/4000.)
export default defineConfig({
  plugins: [react()],
  // PERINEXA_CLIENT_PORT / PERINEXA_API_PORT: a second copy of perinexa1 (another branch, its own database) beside
  // this one, e.g. 5184 and 4011 – the server's API_PORT in that copy's server/.env must match.
  server: {
    port: Number(process.env.PERINEXA_CLIENT_PORT) || 5174,
    strictPort: true,
    proxy: { '/api': `http://localhost:${Number(process.env.PERINEXA_API_PORT) || 4001}` },
  },
});
