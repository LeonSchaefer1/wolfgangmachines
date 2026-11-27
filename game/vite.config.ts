import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html') } },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
