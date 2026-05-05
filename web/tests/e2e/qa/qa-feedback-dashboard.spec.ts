import { expect, test } from '@playwright/test';

const now = Date.now();

const jobSchedule = {
  schedule: '*/30 * * * *',
  installed: true,
  nextRun: null,
  delayMinutes: 0,
  manualDelayMinutes: 0,
  balancedDelayMinutes: 0,
};

const config = {
  cronSchedule: '*/30 * * * *',
  reviewerSchedule: '*/45 * * * *',
  executorEnabled: true,
  reviewerEnabled: true,
  qa: { enabled: true, schedule: '15 */2 * * *' },
  audit: { enabled: true, schedule: '30 */6 * * *' },
  analytics: { enabled: true, schedule: '0 6 * * 1' },
  roadmapScanner: { enabled: true, slicerSchedule: '0 */6 * * *' },
  prResolver: { enabled: true, schedule: '15 6,14,22 * * *' },
  merger: { enabled: true, schedule: '55 */4 * * *' },
};

test.describe('Dashboard - Feedback Performance QA', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/mode', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ globalMode: false }),
      });
    });

    await page.route('**/api/status', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          projectName: 'Night Watch',
          projectDir: '/tmp/night-watch',
          config,
          prds: [],
          processes: [
            { name: 'executor', running: false, pid: null },
            { name: 'reviewer', running: false, pid: null },
            { name: 'qa', running: false, pid: null },
            { name: 'audit', running: false, pid: null },
            { name: 'planner', running: false, pid: null },
            { name: 'analytics', running: false, pid: null },
            { name: 'pr-resolver', running: false, pid: null },
            { name: 'merger', running: false, pid: null },
          ],
          prs: [],
          logs: [],
          crontab: { installed: true, entries: ['night-watch executor'] },
          activePrd: null,
          timestamp: new Date(now).toISOString(),
        }),
      });
    });

    await page.route('**/api/prs', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.route('**/api/schedule-info', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          executor: jobSchedule,
          reviewer: jobSchedule,
          qa: jobSchedule,
          audit: jobSchedule,
          planner: jobSchedule,
          analytics: jobSchedule,
          prResolver: jobSchedule,
          merger: jobSchedule,
          paused: false,
          schedulingPriority: 50,
          entries: ['night-watch executor'],
        }),
      });
    });

    await page.route('**/api/board/status', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          columns: {
            Draft: [],
            Ready: [],
            'In Progress': [],
            Review: [],
            Done: [],
          },
        }),
      });
    });

    await page.route('**/api/feedback/summary', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          projectPath: '/tmp/night-watch',
          windows: {
            last7Days: {
              days: 7,
              fromFinishedAt: now - 7 * 24 * 60 * 60 * 1000,
              toFinishedAt: now,
              totalCount: 5,
              successCount: 4,
              failureCount: 1,
              timeoutCount: 0,
              rateLimitedCount: 0,
              skippedCount: 0,
              successRate: 0.8,
              averageDurationSeconds: 72,
              byOutcome: { success: 4, failure: 1 },
              byFailureCategory: { tests: 1 },
              byJobType: {
                executor: {
                  totalCount: 5,
                  successCount: 4,
                  failureCount: 1,
                  timeoutCount: 0,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.8,
                },
              },
              byProvider: {
                codex: {
                  totalCount: 5,
                  successCount: 4,
                  failureCount: 1,
                  timeoutCount: 0,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.8,
                },
              },
            },
            last30Days: {
              days: 30,
              fromFinishedAt: now - 30 * 24 * 60 * 60 * 1000,
              toFinishedAt: now,
              totalCount: 12,
              successCount: 9,
              failureCount: 2,
              timeoutCount: 1,
              rateLimitedCount: 1,
              skippedCount: 0,
              successRate: 0.75,
              averageDurationSeconds: 95,
              byOutcome: { success: 9, failure: 2, timeout: 1 },
              byFailureCategory: { tests: 2, lint: 1 },
              byJobType: {
                executor: {
                  totalCount: 8,
                  successCount: 6,
                  failureCount: 2,
                  timeoutCount: 0,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.75,
                },
                reviewer: {
                  totalCount: 4,
                  successCount: 3,
                  failureCount: 0,
                  timeoutCount: 1,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.75,
                },
              },
              byProvider: {
                codex: {
                  totalCount: 9,
                  successCount: 7,
                  failureCount: 1,
                  timeoutCount: 1,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.78,
                },
                claude: {
                  totalCount: 3,
                  successCount: 2,
                  failureCount: 1,
                  timeoutCount: 0,
                  rateLimitedCount: 0,
                  skippedCount: 0,
                  successRate: 0.67,
                },
              },
            },
          },
          activeAugmentations: [
            {
              id: 7,
              projectPath: '/tmp/night-watch',
              patternId: 1,
              jobType: 'executor',
              promptText: 'Check known flaky test setup before editing.',
              status: 'active',
              createdAt: now,
              updatedAt: now,
              expiresAt: null,
              appliedCount: 2,
              successCount: 1,
            },
          ],
        }),
      });
    });

    await page.route('**/api/feedback/patterns', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          projectPath: '/tmp/night-watch',
          patterns: [
            {
              id: 1,
              projectPath: '/tmp/night-watch',
              patternKey: 'executor:tests',
              jobType: 'executor',
              category: 'tests',
              title: 'Repeated test failures',
              description: 'Executor runs repeatedly fail in vitest.',
              sampleCount: 3,
              confidence: 0.86,
              firstSeenAt: now - 10_000,
              lastSeenAt: now,
              status: 'active',
              metadata: {},
            },
          ],
          topFailurePatterns: [
            {
              key: 'executor:codex:tests:vitest failed',
              jobType: 'executor',
              providerKey: 'codex',
              category: 'tests',
              signature: 'vitest failed',
              sampleCount: 3,
              lastSeenAt: now,
            },
          ],
        }),
      });
    });
  });

  test('should render feedback performance metrics and augmentation controls', async ({ page }) => {
    await page.goto('#/');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Feedback Performance' })).toBeVisible();
    await expect(page.getByText('80%').first()).toBeVisible();
    await expect(page.getByText('75%').first()).toBeVisible();
    await expect(page.getByText('Success-Rate Trend')).toBeVisible();
    await expect(page.getByText('Failure Categories')).toBeVisible();
    await expect(page.getByText('Job Breakdown')).toBeVisible();
    await expect(page.getByText('Provider Breakdown')).toBeVisible();
    await expect(page.getByText('Repeated test failures')).toBeVisible();
    await expect(page.getByText('Check known flaky test setup before editing.')).toBeVisible();
    await expect(page.getByRole('button', { name: /disable/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /expire/i })).toBeVisible();

    await page.screenshot({
      path: 'test-results/qa-feedback-dashboard.png',
      fullPage: true,
    });
  });
});
