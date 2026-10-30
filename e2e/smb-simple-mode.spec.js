/**
 * Browser smoke for SMB Simple Mode / onboarding routes (auth-gated).
 * Skips when E2E credentials are not configured.
 */
const { test, expect } = require('@playwright/test');

const email = process.env.E2E_WORKSPACE_EMAIL || '';
const password = process.env.E2E_WORKSPACE_PASSWORD || '';
const hasAuth = Boolean(email && password);

test.describe('SMB competitive routes', () => {
  test.skip(!hasAuth, 'E2E_WORKSPACE_EMAIL / E2E_WORKSPACE_PASSWORD required');

  test('bots and onboarding pages load for signed-in workspace', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
    await page.waitForURL(/\/app\//, { timeout: 60000 });

    await page.goto('/app/bots');
    await expect(page.locator('main, .productShell').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/WhatsApp bots|Quick reply|Google Sheets/i).first()).toBeVisible({ timeout: 30000 });

    await page.goto('/app/onboarding');
    await expect(page.getByText(/Get started|Choose your goal|Checklist/i).first()).toBeVisible({ timeout: 30000 });

    await page.goto('/app/settings/integrations');
    await expect(page.getByText(/Connector marketplace|Integration/i).first()).toBeVisible({ timeout: 30000 });
  });
});
