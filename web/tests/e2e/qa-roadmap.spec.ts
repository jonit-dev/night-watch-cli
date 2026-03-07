/**
 * QA E2E tests for PR #66: Horizon-based roadmap planning view
 *
 * Tests the Roadmap page UI including:
 * - Horizon-based layout (short-term, medium-term, long-term)
 * - Filter functionality
 * - Pipeline stage visualization
 * - Scanner controls
 *
 * Note: These tests verify the UI structure and controls.
 * Data-dependent assertions are kept minimal to ensure reliability.
 */

import { test, expect } from '@playwright/test';

test.describe('Roadmap Page - Horizon Layout', () => {
  test('should display horizon-based layout with three columns', async ({ page }) => {
    await page.goto('/#/roadmap');

    // Wait for the page to load
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Check that all three horizon columns are present
    await expect(page.locator('text=Short-term (0-6 wk)')).toBeVisible();
    await expect(page.locator('text=Medium-term (6wk-4mo)')).toBeVisible();
    await expect(page.locator('text=Long-term (4-12mo)')).toBeVisible();

    // Take a screenshot for visual verification
    await page.screenshot({ path: 'test-results/roadmap-horizon-layout.png', fullPage: true });
  });
});

test.describe('Roadmap Page - Filter Functionality', () => {
  test('should toggle filter panel visibility', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Filter button should be visible
    const filterButton = page.locator('button:has-text("Filters")');
    await expect(filterButton).toBeVisible();

    // Click to expand filters
    await filterButton.click();

    // Search input should now be visible
    await expect(page.locator('input[placeholder="Search items..."]')).toBeVisible();

    // Take a screenshot of the expanded filter panel
    await page.screenshot({ path: 'test-results/roadmap-filters-expanded.png', fullPage: true });
  });

  test('should display horizon filter options', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Open filters
    await page.locator('button:has-text("Filters")').click();

    // Horizon filter pills should be visible
    await expect(page.locator('button:has-text("Short-term")')).toBeVisible();
    await expect(page.locator('button:has-text("Medium-term")')).toBeVisible();
    await expect(page.locator('button:has-text("Long-term")')).toBeVisible();
  });

  test('should display stage filter options', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Open filters
    await page.locator('button:has-text("Filters")').click();

    // Stage filter pills should be visible
    await expect(page.locator('button:has-text("Pending")')).toBeVisible();
    await expect(page.locator('button:has-text("PRD Created")')).toBeVisible();
    await expect(page.locator('button:has-text("Done")')).toBeVisible();
  });

  test('should display category filter options', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Open filters
    await page.locator('button:has-text("Filters")').click();

    // Category filter section should be visible
    await expect(page.locator('text=Category')).toBeVisible();
  });

  test('should allow typing in search input', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Open filters
    await page.locator('button:has-text("Filters")').click();

    // Type in search input
    const searchInput = page.locator('input[placeholder="Search items..."]');
    await searchInput.fill('test search query');

    // Verify the value is set
    await expect(searchInput).toHaveValue('test search query');
  });

  test('should toggle filter pills when clicked', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Open filters
    await page.locator('button:has-text("Filters")').click();

    // Click on a horizon filter
    const shortTermButton = page.locator('button:has-text("Short-term")');
    await shortTermButton.click();

    // The button should now have the active state (indigo background)
    // Check for the active state class
    await expect(shortTermButton).toHaveClass(/bg-indigo-500\/20/);
  });
});

test.describe('Roadmap Page - Pipeline Stage Display', () => {
  test('should display pipeline summary in progress card', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Pipeline summary section should exist
    await expect(page.locator('text=Pipeline:')).toBeVisible();
  });

  test('should display progress section', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Progress heading should be visible (use more specific selector)
    await expect(page.locator('h3:has-text("Progress")')).toBeVisible();
  });
});

test.describe('Roadmap Page - Scanner Controls', () => {
  test('should display Scan Now button', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Scan button should be visible
    await expect(page.locator('button:has-text("Scan Now")')).toBeVisible();
  });

  test('should display status banner', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Status should be shown
    await expect(page.locator('text=Scanner Status')).toBeVisible();
  });

  test('should display enable/disable switch', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Switch component should be present (look for checkbox input)
    await expect(page.locator('input[type="checkbox"]')).toBeVisible();
  });
});

test.describe('Roadmap Page - Visual Regression', () => {
  test('should capture full page screenshot', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Wait for any loading states to settle
    await page.waitForTimeout(2000);

    // Take a full page screenshot
    await page.screenshot({ path: 'test-results/roadmap-full-page.png', fullPage: true });
  });

  test('should capture screenshot with filters expanded', async ({ page }) => {
    await page.goto('/#/roadmap');
    await expect(page.locator('h1:has-text("Roadmap")')).toBeVisible({ timeout: 10000 });

    // Expand filters
    await page.locator('button:has-text("Filters")').click();
    await page.waitForTimeout(500);

    // Take screenshot
    await page.screenshot({ path: 'test-results/roadmap-with-filters.png', fullPage: true });
  });
});
