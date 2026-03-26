import { test, expect } from '@playwright/test';

/**
 * E2E tests for UX Revamp: Command Palette, Activity Center, Log Filters
 * PR #92: feat(web): UX Revamp - Command Palette, Activity Center, Log Filters
 */
test.describe('UX Revamp - Command Palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/');
    await page.waitForLoadState('networkidle');
    // Wait for app to be ready
    await page.waitForTimeout(2000);
  });

  test('should open command palette with Ctrl+K keyboard shortcut', async ({ page }) => {
    // Press Ctrl+K to open command palette
    await page.keyboard.press('Control+k');

    // Command palette should be visible
    const commandPalette = page.locator('[data-command-palette]');
    await expect(commandPalette).toBeVisible({ timeout: 10000 });

    // Take screenshot
    await page.screenshot({ path: 'test-results/command-palette-open.png', fullPage: false });
  });

  test('should display navigation commands in command palette', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    // Check for navigation category - using more flexible selector
    const navigateCategory = page.locator('text=/navigate/i');
    await expect(navigateCategory.first()).toBeVisible({ timeout: 5000 });

    // Check for common navigation commands
    await expect(page.locator('text=Dashboard')).toBeVisible();
    await expect(page.locator('text=Logs')).toBeVisible();

    await page.screenshot({ path: 'test-results/command-palette-navigation.png', fullPage: false });
  });

  test('should filter commands by search term', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    // Type search term
    const input = page.locator('[data-command-palette] input');
    await input.fill('log');

    // Should show Logs command
    await expect(page.locator('button:has-text("Logs")')).toBeVisible();

    await page.screenshot({ path: 'test-results/command-palette-filtered.png', fullPage: false });
  });

  test('should close command palette with Escape', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    // Command palette should be visible
    await expect(page.locator('[data-command-palette]')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Command palette should be hidden
    await expect(page.locator('[data-command-palette]')).not.toBeVisible({ timeout: 5000 });
  });

  test('should navigate to Logs page when selecting Logs command', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    // Click on Logs command
    await page.click('button:has-text("Logs")');

    // Should navigate to logs page
    await expect(page).toHaveURL(/.*#\/logs/);

    await page.screenshot({ path: 'test-results/navigated-to-logs.png', fullPage: false });
  });
});

test.describe('UX Revamp - Activity Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should have activity center button in top bar', async ({ page }) => {
    // Check for bell icon button using svg selector
    const bellButton = page.locator('button').filter({ has: page.locator('svg') }).nth(0);
    await expect(bellButton.first()).toBeVisible();

    await page.screenshot({ path: 'test-results/top-bar-activity-button.png', fullPage: false });
  });

  test('should open activity center when clicking bell icon', async ({ page }) => {
    // Find and click the bell icon button
    const bellButton = page.locator('button').filter({ has: page.locator('svg.lucide-bell, svg[class*="bell"]') });
    await bellButton.first().click();

    // Activity center panel should be visible
    await expect(page.locator('text=/activity/i')).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/activity-center-open.png', fullPage: false });
  });
});

test.describe('UX Revamp - Log Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/logs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should display log filter bar on logs page', async ({ page }) => {
    // Check for filter elements - look for buttons with agent names or "All"
    const allButton = page.locator('button:has-text("All")');
    await expect(allButton.first()).toBeVisible({ timeout: 10000 });

    await page.screenshot({ path: 'test-results/log-filter-bar.png', fullPage: false });
  });

  test('should display search input for log filtering', async ({ page }) => {
    // Check for search input with filter placeholder
    const searchInput = page.locator('input[placeholder*="filter" i], input[placeholder*="search" i]');
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display agent filter pills', async ({ page }) => {
    // Check for agent pills (Executor, Reviewer, etc.)
    const executorPill = page.locator('button:has-text("Executor")');
    await expect(executorPill.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/log-agent-pills.png', fullPage: false });
  });

  test('should display errors only checkbox', async ({ page }) => {
    // Check for errors only toggle
    const errorToggle = page.locator('text=/error.*only/i, label:has(input[type="checkbox"])');
    await expect(errorToggle.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('UX Revamp - Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('should navigate from command palette to logs and see filters', async ({ page }) => {
    // Open command palette
    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-command-palette]')).toBeVisible({ timeout: 5000 });

    // Navigate to logs
    await page.click('button:has-text("Logs")');
    await expect(page).toHaveURL(/.*#\/logs/);

    // Log filters should be visible
    const allButton = page.locator('button:has-text("All")');
    await expect(allButton.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/integration-logs-filters.png', fullPage: false });
  });

  test('should display top bar with status indicator', async ({ page }) => {
    // Check for online status indicator
    const statusIndicator = page.locator('text=/online|offline/i');
    await expect(statusIndicator.first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/top-bar-status.png', fullPage: false });
  });
});
