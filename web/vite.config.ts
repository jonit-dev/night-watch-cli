import path from 'path';
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
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
