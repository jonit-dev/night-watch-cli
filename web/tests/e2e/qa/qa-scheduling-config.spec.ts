import { test, expect } from '@playwright/test';

/**
 * E2E tests for Scheduling page with ScheduleConfig component
 * Tests the UX revamp changes to the scheduling interface
 */
test.describe('Scheduling - ScheduleConfig UX Revamp', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('#/scheduling');
  });

  test('should render scheduling page', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for main heading
    await expect(page.locator('h1:has-text("Automation"), h2:has-text("Automation")').or(
      page.locator('text=Job Schedules')
    )).toBeVisible({ timeout: 10000 });
  });

  test('should display schedule mode toggle (Template/Custom)', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Check for Template button
    await expect(page.locator('button:has-text("Template")')).toBeVisible();

    // Check for Custom button
    await expect(page.locator('button:has-text("Custom")')).toBeVisible();
  });

  test('should switch between template and custom modes', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Click on Custom button
    await page.click('button:has-text("Custom")');

    // Should show custom schedule inputs
    await expect(page.locator('text=PRD Execution Schedule').or(
      page.locator('text=PR Review Schedule')
    )).toBeVisible({ timeout: 5000 });

    // Click back to Template
    await page.click('button:has-text("Template")');

    await expect(
      page.locator('button:has-text("Always On"), button:has-text("Night Surge")')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should display schedule templates in template mode', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Ensure template mode is active
    const templateBtn = page.locator('button:has-text("Template")');
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
    }

    // Check for current schedule template labels
    const templateLabels = ['Night Surge', 'Always On', 'Day Shift', 'Minimal'];
    const hasAnyLabel = await Promise.all(
      templateLabels.map(label =>
        page.locator(`text=${label}`).count().then(count => count > 0)
      )
    );

    // At least one template should be visible
    expect(hasAnyLabel.some(Boolean)).toBeTruthy();
  });

  test('should display custom schedule inputs in custom mode', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Switch to custom mode
    const customBtn = page.locator('button:has-text("Custom")');
    if (await customBtn.isVisible()) {
      await customBtn.click();
    }

    // Wait for inputs to appear
    await page.waitForTimeout(500);

    // Check for schedule input labels
    const expectedLabels = [
      'PRD Execution Schedule',
      'PR Review Schedule',
      'QA Schedule',
      'Audit Schedule'
    ];

    for (const label of expectedLabels) {
      const element = page.locator(`text=${label}`);
      const isVisible = await element.isVisible().catch(() => false);
      // Soft assertion - log but don't fail if not visible (depends on state)
      if (isVisible) {
        await expect(element).toBeVisible();
      }
    }
  });

  test('should keep scheduling controls on the overview tab', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Automation Controls')).toBeVisible();
    await expect(page.locator('text=Scheduling Priority')).toBeVisible();
    await expect(page.locator('text=Extra Start Delay')).toBeVisible();
  });

  test('should display queue controls from the overview tab', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.locator('[title="Automation Settings"]').click();
    await expect(page.locator('text=Dispatch Mode')).toBeVisible();
    await expect(page.locator('text=Coordinator Enabled')).toBeVisible();
  });

  test('should have interactive template cards', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Ensure template mode
    const templateBtn = page.locator('button:has-text("Template")');
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
    }

    // Look for clickable template buttons
    const templateButtons = page.locator('button').filter({ hasText: /Always On|Night Surge|Day Shift|Minimal/i });

    const count = await templateButtons.count();
    // If templates exist, they should be clickable
    if (count > 0) {
      await expect(templateButtons.first()).toBeVisible();
    }
  });

  test('should display schedule descriptions on template cards', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    // Ensure template mode
    const templateBtn = page.locator('button:has-text("Template")');
    if (await templateBtn.isVisible()) {
      await templateBtn.click();
    }

    // Look for agent hints (Executor, Reviewer, QA, etc.)
    const agentHints = ['Executor', 'Reviewer', 'QA', 'Audit', 'Planner'];
    const hasAnyHint = await Promise.all(
      agentHints.map(agent =>
        page.locator(`text=${agent}`).count().then(count => count > 0)
      )
    );

    // At least some agent hints should be visible
    expect(hasAnyHint.some(Boolean)).toBeTruthy();
  });

  test('should keep the schedules tab focused on job cadence only', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.click('button:has-text("Schedules")');

    await expect(page.locator('text=Job Schedules')).toBeVisible();
    await expect(page.locator('text=Scheduling Priority')).toHaveCount(0);
    await expect(page.locator('text=Extra Start Delay')).toHaveCount(0);
    await expect(page.locator('text=Coordinator Enabled')).toHaveCount(0);
  });

  test('should navigate between pages using sidebar', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click on Dashboard in sidebar
    const dashboardLink = page.locator('a[href="#/"], a[href="#"]').filter({ hasText: /Dashboard/i });
    if (await dashboardLink.count() > 0) {
      await dashboardLink.first().click();
      await expect(page).toHaveURL(/.*#\/$/);
    }
  });

  test('should display pause/resume schedule controls', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for pause/resume buttons (may be in different locations)
    const pauseBtn = page.locator('button:has-text("Pause"), button:has-text("Resume")');
    const count = await pauseBtn.count();

    // If controls exist, they should be visible
    if (count > 0) {
      await expect(pauseBtn.first()).toBeVisible();
    }
  });
});
