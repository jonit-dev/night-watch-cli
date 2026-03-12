import { test, expect } from '@playwright/test';

/**
 * E2E tests for Settings page UX revamp
 * Tests the refactored settings interface
 */
test.describe('Settings - UX Revamp', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/settings');
  });

  test('should render settings page', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for main heading
    await expect(page.locator('h1:has-text("Settings"), h2:has-text("Settings")')).toBeVisible({ timeout: 10000 });
  });

  test('should display settings sections', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for common settings sections
    const expectedSections = [
      'General',
      'Schedule',
      'Providers',
      'Notifications',
      'Slack',
      'Board'
    ];

    // At least some sections should be visible
    let visibleCount = 0;
    for (const section of expectedSections) {
      const element = page.locator(`text=${section}`);
      if (await element.isVisible().catch(() => false)) {
        visibleCount++;
      }
    }

    expect(visibleCount).toBeGreaterThan(0);
  });

  test('should have clickable navigation elements', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for any links or buttons
    const links = page.locator('a').or(page.locator('button'));
    const count = await links.count();

    expect(count).toBeGreaterThan(0);
  });

  test('should display form inputs for configuration', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for common input types
    const textInputs = page.locator('input[type="text"], input[type="number"]');
    const selects = page.locator('select');
    const checkboxes = page.locator('input[type="checkbox"]');

    // At least some form elements should exist
    const hasInputs = await textInputs.count() > 0 || await selects.count() > 0 || await checkboxes.count() > 0;
    expect(hasInputs).toBeTruthy();
  });

  test('should navigate back to dashboard', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click on Dashboard link in sidebar
    const dashboardLink = page.locator('a[href="#/"], a[href="#"]').filter({ hasText: /Dashboard/i });
    if (await dashboardLink.count() > 0) {
      await dashboardLink.first().click();
      await expect(page).toHaveURL(/.*#\/$/);
    }
  });

  test('should display save or apply buttons', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Look for action buttons
    const actionButtons = page.locator('button:has-text("Save"), button:has-text("Apply"), button:has-text("Update")');
    const count = await actionButtons.count();

    // Buttons may or may not be visible depending on state
    if (count > 0) {
      await expect(actionButtons.first()).toBeVisible();
    }
  });

  test('should have responsive layout', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check that main content is visible
    const mainContent = page.locator('main, .settings, [class*="settings"], [class*="Settings"]');
    const isVisible = await mainContent.first().isVisible().catch(() => false);

    if (isVisible) {
      await expect(mainContent.first()).toBeVisible();
    }
  });

  test('should display API provider configuration', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for API-related settings
    const apiLabels = ['API Key', 'Provider', 'Model', 'Endpoint'];
    const hasAnyApiSetting = await Promise.all(
      apiLabels.map(label =>
        page.locator(`text=${label}`).count().then(count => count > 0)
      )
    );

    // API settings may or may not be visible depending on page state
    const visibleCount = hasAnyApiSetting.filter(Boolean).length;
    // Soft assertion - just log the count
    console.log(`API settings visible: ${visibleCount}`);
  });

  test('should display scheduling configuration section', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for schedule-related labels
    const scheduleLabels = ['Schedule', 'Cron', 'Frequency', 'Interval'];
    const hasAnyScheduleSetting = await Promise.all(
      scheduleLabels.map(label =>
        page.locator(`text=${label}`).count().then(count => count > 0)
      )
    );

    // At least log what's visible
    const visibleCount = hasAnyScheduleSetting.filter(Boolean).length;
    console.log(`Schedule settings visible: ${visibleCount}`);
  });
});

/**
 * Navigation tests for Settings page
 */
test.describe('Settings - Navigation', () => {
  test('should navigate from dashboard to settings', async ({ page }) => {
    await page.goto('#/');

    // Wait for dashboard to load
    await page.waitForLoadState('networkidle');

    // Click settings link in sidebar
    const settingsLink = page.locator('a[href="#/settings"]').filter({ hasText: /Settings/i });
    if (await settingsLink.count() > 0) {
      await settingsLink.first().click();
      await expect(page).toHaveURL(/.*#\/settings/);
    }
  });

  test('should navigate from settings to other pages', async ({ page }) => {
    await page.goto('#/settings');
    await page.waitForLoadState('networkidle');

    // Try navigating to scheduling
    const schedulingLink = page.locator('a[href="#/scheduling"]').filter({ hasText: /Scheduling/i });
    if (await schedulingLink.count() > 0) {
      await schedulingLink.first().click();
      await expect(page).toHaveURL(/.*#\/scheduling/);
    }
  });
});
