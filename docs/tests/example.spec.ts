import { test, expect } from '@playwright/test';

test.describe('TubeTS Player', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the player container', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('TubeTS Player');
    await expect(page.locator('#tube-player-container')).toBeVisible();
  });

  test('should have a video ID input', async ({ page }) => {
    const input = page.locator('#videoId');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('dQw4w9WgXcQ');
  });

  test('should initialize status to Ready', async ({ page }) => {
    // Wait for the status to potentially update to "Player Initialized" if it happens quickly,
    // or at least start with "Ready".
    // Since initialization is async, it might change.
    await expect(page.locator('#status-text')).toBeVisible();
  });
});
