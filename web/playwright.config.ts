import { defineConfig, devices } from '@playwright/test';

const NW_QA_ARTIFACTS = process.env.NW_QA_ARTIFACTS || 'both';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:7576',
    trace: 'on-first-retry',
    screenshot: NW_QA_ARTIFACTS === 'screenshot' || NW_QA_ARTIFACTS === 'both' ? 'on' : 'off',
    video: NW_QA_ARTIFACTS === 'video' || NW_QA_ARTIFACTS === 'both'
      ? { mode: 'on', size: { width: 1280, height: 720 } }
      : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'yarn dev',
    url: 'http://localhost:7576',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
