import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/qa',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [['html'], ['list']],

  use: {
    baseURL: 'http://localhost:7576',
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Don't start a server - use existing
  webServer: undefined,
});
