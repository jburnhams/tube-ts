import { test, expect } from '@playwright/test';

test.describe('TubeTS Proxy Verification', () => {
    test('should load video successfully with session id', async ({ page }) => {
        // Check for session ID and skip if missing (e.g. in CI/sandbox without secrets)
        if (!process.env.PROXY_SESSION_ID) {
            test.skip(true, 'Skipping proxy test because PROXY_SESSION_ID is not set');
            return;
        }

        // Go to page first to establish origin for localStorage
        await page.goto('/');

        // Set the session ID in localStorage
        const sessionId = process.env.PROXY_SESSION_ID;
        await page.evaluate((id) => {
            localStorage.setItem('tube-ts-session-id', id);
        }, sessionId);

        // Listen for console errors to catch the nFunction error
        const consoleErrors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                const text = msg.text();
                // Filter out harmless warnings if any, but capture the specific one
                if (text.includes('nFunction not exported') || text.includes('Failed to decipher nsig')) {
                    consoleErrors.push(text);
                }
            }
        });

        // Ensure input is visible and fill it with a VEVO video ID known to need signature
        const input = page.locator('#videoId');
        await expect(input).toBeVisible();
        await input.fill('QAo_Ycocl1E');

        // Wait for the player to initialize (button becomes enabled)
        const loadButton = page.getByRole('button', { name: 'Load Video' });
        await expect(loadButton).toBeEnabled({ timeout: 15000 });

        // Click the load button
        await loadButton.click();

        // Wait for some indication of success (e.g., video element has src or status text updates)
        // Adjust selector based on actual generic UI
        await expect(page.locator('video').first()).toBeVisible({ timeout: 10000 });

        // Wait a bit to ensure async processing happens
        await page.waitForTimeout(3000);

        if (consoleErrors.length > 0) {
            console.error('Captured console errors:', consoleErrors);
        }

        expect(consoleErrors).toHaveLength(0);
    });
});
