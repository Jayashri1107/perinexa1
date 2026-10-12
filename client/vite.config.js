import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the website runs on :5173 and forwards /api requests to the server on :4000,
// so the browser sees one address and the login cookie works with sameSite=strict.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
