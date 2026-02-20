import { URL, fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const coreDir = fileURLToPath(new URL('../core/src', import.meta.url));
const serverDir = fileURLToPath(new URL('../server/src', import.meta.url));
const slackDir = fileURLToPath(new URL('../slack/src', import.meta.url));
const cliDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // CLI package internal imports - map relative imports within the package
      {
        find: '@/cli',
        replacement: cliDir,
      },
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
        find: /^@night-watch\/server\/(.+)$/,
        replacement: `${serverDir}/$1`,
      },
      {
        find: '@night-watch/server',
        replacement: `${serverDir}/index.ts`,
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
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/__tests__/web/**'],
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 4,
    testTimeout: 30000,
  },
});
