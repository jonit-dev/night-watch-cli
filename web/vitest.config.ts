import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'components/**/__tests__/**/*.test.ts',
    ],
  },
});
