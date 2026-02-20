import { URL, fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const coreDir = fileURLToPath(new URL('../core/src', import.meta.url));
const slackDir = fileURLToPath(new URL('../slack/src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Subpath imports from packages
      {
        find: /^@night-watch\/core\/(.+)$/,
        replacement: `${coreDir}/$1`,
      },
      {
        find: '@night-watch/core',
        replacement: `${coreDir}/index.ts`,
      },
      {
        find: /^@night-watch\/slack\/(.+)$/,
        replacement: `${slackDir}/$1`,
      },
      {
        find: '@night-watch/slack',
        replacement: `${slackDir}/index.ts`,
      },
      // Core-internal @/ aliases
      {
        find: /^@\/(.+)$/,
        replacement: `${coreDir}/$1`,
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 4,
  },
});
