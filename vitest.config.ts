import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.config.ts',
      'packages/server/vitest.config.ts',
      'packages/cli/vitest.config.ts',
    ],
  },
});
