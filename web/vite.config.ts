import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      publicDir: 'public',
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
          '@shared/types': path.resolve(__dirname, '../shared/types.ts'),
        }
      }
    };
});
