import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      build: {
        outDir: 'dist',
        emptyOutDir: true,
      },
      server: {
        port: 7576,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
          '^/api(?:/|$)': {
            target: 'http://localhost:7575',
            changeOrigin: true,
          },
        },
      },
      plugins: [tailwindcss(), react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@night-watch/types': path.resolve(__dirname, '../packages/types/src/index.ts'),
        }
      }
    };
});
