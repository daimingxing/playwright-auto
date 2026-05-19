import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [vue()],
  root: resolve(process.cwd(), 'web'),
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/health': 'http://localhost:3001'
    }
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'web/src')
    }
  },
  build: {
    outDir: resolve(process.cwd(), 'dist/web'),
    emptyOutDir: true
  }
});
