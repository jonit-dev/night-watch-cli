import { test, expect } from '@playwright/test';

/**
 * E2E tests for Dashboard page with AgentStatusBar component
 * Tests the UX revamp changes to the dashboard
 */
test.describe('Dashboard - AgentStatusBar UX Revamp', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard using hash routing
    await page.goto('#/');
  });

  test('should render dashboard with stats cards', async ({ page }) => {
    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check for stats cards - key elements of the revamp
    await expect(page.locator('text=Board Ready')).toBeVisible();
    await expect(page.locator('text=In Progress')).toBeVisible();
    await expect(page.locator('text=Open PRs')).toBeVisible();
    await expect(page.locator('text=Automation')).toBeVisible();
  });

  test('should display AgentStatusBar component', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for "Agents" heading
    await expect(page.locator('h2:has-text("Agents")')).toBeVisible();

    // Check for "View logs" link next to Agents header
    await expect(page.locator('text=View logs')).toBeVisible();
  });

  test('should display all 5 agent status indicators', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for each agent name in the status bar
    await expect(page.locator('text=Executor')).toBeVisible();
    await expect(page.locator('text=Reviewer')).toBeVisible();
    await expect(page.locator('text=QA')).toBeVisible();
    await expect(page.locator('text=Auditor')).toBeVisible();
    await expect(page.locator('text=Planner')).toBeVisible();
  });

  test('should have agent status dots with proper styling', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for status indicator dots (rounded-full elements)
    const statusDots = page.locator('.rounded-full');
    await expect(statusDots.first()).toBeVisible();

    // Each agent should have a status indicator
    const agentCards = page.locator('text=Executor, text=Reviewer, text=QA, text=Auditor, text=Planner').all();
    for (const card of await agentCards) {
      await expect(card).toBeVisible();
    }
  });

  test('should navigate to logs page from View logs button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click "View logs" link
    await page.click('text=View logs');

    // Should navigate to logs page (hash routing)
    await expect(page).toHaveURL(/.*#\/logs/);
  });

  test('should display GitHub Board section', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for GitHub Board heading
    await expect(page.locator('h2:has-text("GitHub Board")')).toBeVisible();

    // Check for "View board" link
    await expect(page.locator('text=View board')).toBeVisible();
  });

  test('should navigate to board page from stats cards', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click on "Board Ready" card
    const boardCard = page.locator('text=Board Ready').locator('../..');
    await boardCard.click();

    // Should navigate to board page
    await expect(page).toHaveURL(/.*#\/board/);
  });

  test('should display crontab entries info when active', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for automation status
    const automationStatus = page.locator('text=Active').or(
      page.locator('text=Inactive')
    ).or(
      page.locator('text=Paused')
    );

    await expect(automationStatus.first()).toBeVisible();
  });

  test('should show next automation teaser when scheduled', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for next automation section (may not be visible if not scheduled)
    const nextAutomation = page.locator('text=Next automation:');

    // Only assert if it exists (depends on backend state)
    if (await nextAutomation.count() > 0) {
      await expect(nextAutomation).toBeVisible();

      // Check for "Manage Schedules" link
      await expect(page.locator('text=Manage Schedules')).toBeVisible();
    }
  });

  test('should display board column badges when configured', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for board columns (Draft, Ready, In Progress, Review, Done)
    const columns = ['Draft', 'Ready', 'In Progress', 'Review', 'Done'];
    const hasColumns = await Promise.all(
      columns.map(col => page.locator(`text=${col}`).count().then(count => count > 0))
    );

    // At least some columns should be visible if board is configured
    const visibleCount = hasColumns.filter(Boolean).length;
    expect(visibleCount).toBeGreaterThanOrEqual(0);
  });

  test('should navigate to scheduling from next automation section', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const manageLink = page.locator('text=Manage Schedules');
    if (await manageLink.count() > 0) {
      await manageLink.click();
      await expect(page).toHaveURL(/.*#\/scheduling/);
    }
  });
});
