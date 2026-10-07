import { expect, test } from '@playwright/test';

test('login page exposes accessible form controls', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('public login has no duplicate main landmarks', async ({ page }) => {
  await page.goto('/login');
  const mains = await page.locator('main').count();
  expect(mains).toBeLessThanOrEqual(2);
});
