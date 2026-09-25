import { expect, test } from '@playwright/test';

for (const path of ['/login', '/signup', '/forgot-password', '/privacy-policy']) {
  test(`${path} is usable without horizontal overflow`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBeFalsy();
  });
}

test('sign-in controls are visible and failed authentication is safe', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('invalid@example.com');
  await page.getByLabel('Password', { exact: true }).fill('invalid-password-value');
  const submit = page.getByRole('button', { name: 'Sign in' });
  await expect(submit).toBeVisible();
  await submit.click();
  await expect(page.locator('.formError[role=\'alert\']')).toBeVisible();
});

test('authenticated route suite', async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, 'Set E2E_EMAIL and E2E_PASSWORD for authenticated coverage.');
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 30_000 });
  for (const path of ['/app/contacts', '/app/templates', '/app/campaigns', '/app/automations', '/app/inbox', '/app/settings/billing', '/app/settings/security']) {
    await page.goto(path);
    await expect(page).toHaveURL(path);
    await expect(page.locator('section.workspace').last()).toBeVisible();
    await expect(page.getByText('Workspace could not be loaded')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBeFalsy();
  }
});
