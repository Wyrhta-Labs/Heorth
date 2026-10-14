import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split vendor code by package family so no chunk crosses Vite's
        // 500 kB warning. Order matters: react-dom must match before react.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/]node_modules[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'vendor-react';
          if (id.includes('@tanstack')) return 'vendor-tanstack';
          if (/[\/]node_modules[\/](i18next|react-i18next)[\/]/.test(id)) return 'vendor-i18n';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('date-fns')) return 'vendor-date';
          if (/[\/]node_modules[\/](zod|react-hook-form|@hookform)[\/]/.test(id)) return 'vendor-forms';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:14000',
    },
  },
});
