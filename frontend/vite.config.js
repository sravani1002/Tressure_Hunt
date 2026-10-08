import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Tressure_Hunt/' : '/',
  plugins: [react()],
  server: {
    port: 5179,
    strictPort: true,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true
      }
    }
  }
});