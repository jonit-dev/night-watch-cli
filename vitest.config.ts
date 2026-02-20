import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/server/vitest.config.ts',
  'packages/slack/vitest.config.ts',
  'packages/cli/vitest.config.ts',
]);
