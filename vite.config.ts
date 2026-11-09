import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: /api is proxied to the game API (FeedingFranzeeAPI on http://localhost:5003).
// Production builds call the API directly via VITE_API_BASE. Add ?demo to the URL to play offline.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    proxy: {
      '/api': { target: 'http://localhost:5003', changeOrigin: true },
    },
  },
});
