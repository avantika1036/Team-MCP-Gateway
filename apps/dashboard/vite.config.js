import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  css: {
    postcss: {
      plugins: [],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4016',
        changeOrigin: true,
        secure: false,
      },
      '/healthz': {
        target: 'http://localhost:4016',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
