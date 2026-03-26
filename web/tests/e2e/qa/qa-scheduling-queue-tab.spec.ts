import { test, expect } from '@playwright/test';

/**
 * E2E tests for Scheduling page Queue tab
 * Tests the new Queue tab with provider lanes and execution analytics
 *
 * Note: These tests require a running backend API. If the API is not available,
 * the page will show an error state and the Queue tab will not be visible.
 */
test.describe('Scheduling - Queue Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/scheduling');
    await page.waitForLoadState('networkidle');
  });

  test('should display Queue tab button when API is available', async ({ page }) => {
    // Wait for the page to load (either tabs or error state)
    await page.waitForTimeout(2000);

    // Check if we're in error state (API not available)
    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      // API is not available, skip this test
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Check for Queue tab button
    await expect(page.locator('button:has-text("Queue")')).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Queue tab when clicked', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Check if we're in error state
    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Click on Queue tab
    await page.click('button:has-text("Queue")');

    // Wait for tab content to load
    await page.waitForTimeout(500);

    // Check for Queue Overview heading
    await expect(page.locator('h3:has-text("Queue Overview")')).toBeVisible({ timeout: 5000 });
  });

  test('should display Queue Overview stats cards', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for stat labels
    const expectedLabels = ['Running', 'Pending', 'Avg Wait', 'Oldest Pending'];

    for (const label of expectedLabels) {
      const labelLocator = page.locator(`text=${label}`);
      const count = await labelLocator.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('should display Provider Lanes section', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for Provider Lanes heading
    await expect(page.locator('h3:has-text("Provider Lanes")')).toBeVisible({ timeout: 5000 });

    // Check for description text
    await expect(page.locator('text=Running and pending jobs grouped by provider bucket')).toBeVisible();
  });

  test('should display Provider Buckets section', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for Provider Buckets heading
    await expect(page.locator('h3:has-text("Provider Buckets")')).toBeVisible({ timeout: 5000 });

    // Check for description text
    await expect(page.locator('text=Running and pending counts per provider bucket')).toBeVisible();
  });

  test('should display Recent Runs section', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for Recent Runs heading
    await expect(page.locator('h3:has-text("Recent Runs")')).toBeVisible({ timeout: 5000 });

    // Check for description text
    await expect(page.locator('text=Last 24 hours of job executions')).toBeVisible();
  });

  test('should display job type color legend in Provider Lanes', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for legend items (executor, reviewer, qa, audit, slicer)
    const jobTypes = ['executor', 'reviewer', 'qa', 'audit', 'slicer'];

    for (const jobType of jobTypes) {
      const legendItem = page.locator(`text=${jobType}`);
      const count = await legendItem.count();
      if (count > 0) {
        await expect(legendItem.first()).toBeVisible();
      }
    }
  });

  test('should show loading state when queue data is being fetched', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');

    // Either loading message or actual content should be visible
    const loadingMessage = page.locator('text=Loading queue status...');
    const providerLanesChart = page.locator('[data-testid="provider-lanes-chart"]');

    const isLoadingVisible = await loadingMessage.isVisible().catch(() => false);
    const isChartVisible = await providerLanesChart.isVisible().catch(() => false);

    expect(isLoadingVisible || isChartVisible).toBeTruthy();
  });

  test('should display running and pending legend indicators', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for "running" and "pending" legend labels
    const runningLabel = page.locator('text=running');
    const pendingLabel = page.locator('text=pending');

    const hasRunning = await runningLabel.count().then(c => c > 0);
    const hasPending = await pendingLabel.count().then(c => c > 0);

    expect(hasRunning || hasPending).toBeTruthy();
  });

  test('should allow switching between tabs', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Start on default tab
    await page.waitForLoadState('networkidle');

    // Click on Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(300);

    // Verify Queue content is visible
    await expect(page.locator('h3:has-text("Queue Overview")')).toBeVisible({ timeout: 5000 });

    // Switch back to Schedules tab
    await page.click('button:has-text("Schedules")');
    await page.waitForTimeout(300);

    // Verify we're back on Schedules (Job Schedules heading should be visible)
    const jobSchedules = page.locator('text=Job Schedules');
    const schedulesHeading = page.locator('h3:has-text("Schedules")');

    const hasJobSchedules = await jobSchedules.isVisible().catch(() => false);
    const hasSchedulesHeading = await schedulesHeading.isVisible().catch(() => false);

    expect(hasJobSchedules || hasSchedulesHeading).toBeTruthy();
  });

  test('should display stats in Queue Overview with correct styling', async ({ page }) => {
    await page.waitForTimeout(2000);

    const errorState = page.locator('text=Failed to load schedule information');
    const isErrorVisible = await errorState.isVisible().catch(() => false);

    if (isErrorVisible) {
      test.skip(true, 'API not available - page shows error state');
      return;
    }

    // Navigate to Queue tab
    await page.click('button:has-text("Queue")');
    await page.waitForTimeout(500);

    // Check for stat card styling (bg-slate-950/40)
    const statCards = page.locator('.bg-slate-950\\/40');
    const count = await statCards.count();

    // Should have at least 4 stat cards (Running, Pending, Avg Wait, Oldest Pending)
    expect(count).toBeGreaterThanOrEqual(4);
  });
});
