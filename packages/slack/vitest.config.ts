import { URL, fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const coreDir = fileURLToPath(new URL('../core/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Subpath imports from core packages
      {
        find: /^@night-watch\/core\/(.+)$/,
        replacement: `${coreDir}/$1`,
      },
      {
        find: '@night-watch/core',
        replacement: `${coreDir}/index.ts`,
      },
      // Core-internal @/ aliases (needed when loading core source transitively)
      {
        find: /^@\/(.+)$/,
        replacement: `${coreDir}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 4,
    setupFiles: ['reflect-metadata'],
  },
});
