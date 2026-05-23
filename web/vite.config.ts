import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { getAppConfig } from '../server/src/lib/app-config';

const appConfig = getAppConfig();

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
  define: {
    'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE ?? appConfig.web.apiBase)
  },
  build: {
    outDir: resolve(process.cwd(), 'dist/web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const name = id.replace(/\\/g, '/');

          if (name.includes('node_modules/element-plus') || name.includes('node_modules/@element-plus')) {
            return 'element-vendor';
          }

          if (name.includes('node_modules/vue') || name.includes('node_modules/vue-router') || name.includes('node_modules/pinia')) {
            return 'vue-vendor';
          }

          if (name.includes('node_modules')) {
            return 'vendor';
          }

          return undefined;
        }
      }
    }
  }
});
