import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the website runs on :5174 and forwards /api requests to the server on :4001,
// so the browser sees one address and the login cookie works with sameSite=strict.
// (Perinexa1 uses 5174/4001 so it can run beside Perinexa, which uses 5173/4000.)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4001' },
  },
});
