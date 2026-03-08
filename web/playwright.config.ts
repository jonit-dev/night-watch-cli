import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Night Watch Web UI e2e tests
 */
export default defineConfig({
  testDir: './tests/e2e/qa',
  fullyParallel: false, // Run serially for consistent screenshots
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html'], ['list']],

  use: {
    baseURL: 'http://localhost:5173',
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

  // Start dev server before tests
  webServer: {
    command: 'yarn dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
