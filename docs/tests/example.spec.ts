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

  test('should display load button and status', async ({ page }) => {
    const loadButton = page.getByRole('button', { name: 'Load Video' });
    const statusText = page.locator('#status-text');

    await expect(loadButton).toBeVisible();
    await expect(statusText).toBeVisible();

    // Check that status text is not empty
    const text = await statusText.innerText();
    expect(text.length).toBeGreaterThan(0);
  });
});
