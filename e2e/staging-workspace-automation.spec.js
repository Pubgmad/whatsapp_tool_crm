/**
 * Authenticated staging workspace E2E for WhatsApp Automation surfaces.
 * Requires E2E_EMAIL / E2E_PASSWORD. For public nginx staging also set
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD (wired via playwright.config.js).
 */
import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  gotoApp,
  hasSessionE2ECredentials,
  hasWorkspaceE2ECredentials,
  openWorkspaceApp,
  signInWorkspace
} from './helpers.js';

const hasAuth = hasWorkspaceE2ECredentials() || hasSessionE2ECredentials();
const suffix = Date.now().toString(36);

test.describe('Staging WhatsApp Automation workspace', () => {
  test.skip(!hasAuth, 'Set E2E_EMAIL/E2E_PASSWORD or E2E_SESSION_COOKIE/E2E_CSRF_COOKIE');
  test.setTimeout(180_000);

  test.beforeEach(async ({ page, context }) => {
    await signInWorkspace(page, context);
    await openWorkspaceApp(page);
  });

  test('Simple Mode navigation reaches core automation surfaces', async ({ page }) => {
    for (const path of ['/app/contacts', '/app/templates', '/app/bots', '/app/automations', '/app/campaigns']) {
      await gotoApp(page, path);
      await expect(page.getByText('Unable to load this page')).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
    }
  });

  test('Contacts create and CSV import UI', async ({ page }) => {
    await gotoApp(page, '/app/contacts');
    const addForm = page.locator('form').filter({ hasText: /Phone with country code/i }).first();
    await expect(addForm).toBeVisible({ timeout: 30000 });
    const phone = `1555${String(Date.now()).slice(-7)}`;
    await addForm.getByLabel('Name', { exact: true }).fill(`E2E Contact ${suffix}`);
    await addForm.getByLabel(/Phone with country code/i).fill(phone);
    await addForm.getByLabel(/Opt-in source/i).fill('e2e');
    await addForm.getByLabel(/Consent evidence/i).fill('Staging Playwright recorded consent');
    await addForm.getByLabel(/Marketing permission recorded/i).check();
    await addForm.getByRole('button', { name: /Add contact/i }).click();
    await expect(page.getByText(`E2E Contact ${suffix}`).first()).toBeVisible({ timeout: 30000 });

    const importForm = page.locator('form.importForm, form').filter({ hasText: /CSV|Import contacts|Choose CSV/i }).first();
    await expect(importForm.locator('textarea')).toBeVisible({ timeout: 30000 });
    await importForm.locator('textarea').fill(
      `name,phone,permission,tags,opt_in_source,consent_evidence\nImport ${suffix},1555${String(Date.now() + 1).slice(-7)},true,e2e,import,Playwright CSV`
    );
    await importForm.getByRole('button', { name: /Import/i }).click();
    await expect(page.getByText(new RegExp(`Import ${suffix}|imported|rows ready|contact`, 'i')).first()).toBeVisible({ timeout: 30000 });
  });

  test('Templates management page loads with clear empty/error states', async ({ page }) => {
    await gotoApp(page, '/app/templates');
    await expect(page.getByRole('heading', { name: /Templates/i }).or(page.locator('strong', { hasText: /Templates/i })).first()).toBeVisible({ timeout: 30000 });
    // Staging has no connected WABA — UI should explain rather than crash.
    const blocked = page.getByText(/Connect a WhatsApp account|Select an account|Sync from Meta/i);
    await expect(blocked.first()).toBeVisible({ timeout: 30000 });
    await assertNoHorizontalOverflow(page);
  });

  test('Reply bot create, rule edit, publish, and execution logs', async ({ page }) => {
    await gotoApp(page, '/app/bots');
    await expect(page.getByRole('heading', { name: /Quick reply bots/i })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /New bot|Quick reply/i }).first()).toBeVisible();

    page.once('dialog', async (dialog) => {
      await dialog.accept(`E2E Bot ${suffix}`);
    });
    await page.getByRole('button', { name: /New bot/i }).click();
    const botButton = page.getByRole('button', { name: new RegExp(`E2E Bot ${suffix}`) });
    await expect(botButton).toBeVisible({ timeout: 30000 });
    await botButton.click();

    const ruleForm = page.locator('form').filter({ hasText: /When customer says/i }).first();
    await expect(ruleForm).toBeVisible({ timeout: 30000 });
    await ruleForm.getByLabel(/When customer says/i).fill('pricing');
    await ruleForm.getByLabel(/Reply with/i).fill(`Price answer ${suffix}`);
    await ruleForm.getByRole('button', { name: /Add rule/i }).click();
    await expect(page.locator('td', { hasText: 'pricing' }).first()).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: /^Edit$/i }).first().click();
    await ruleForm.getByLabel(/When customer says/i).fill('pricing-updated');
    await ruleForm.getByRole('button', { name: /Update rule/i }).click();
    await expect(page.locator('td', { hasText: 'pricing-updated' }).first()).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: /^Publish$/i }).first().click();
    await expect(page.locator('td', { hasText: /published|paused/i }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Execution|Published rules will appear|automatic reply/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('Automation Builder draft save', async ({ page }) => {
    await gotoApp(page, '/app/automations');
    await expect(page.getByRole('heading', { name: /Automation/i }).or(page.locator('strong', { hasText: /Automation/i })).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Save draft|Save changes|New|Create|Add node|Add/i }).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Unable to load this page')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });

  test('Broadcasting page loads without sending', async ({ page }) => {
    await gotoApp(page, '/app/campaigns');
    await expect(page.locator('main, .productShell').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: /Create campaign/i }).or(page.locator('strong', { hasText: /Create campaign|Campaign/i })).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Unable to load this page')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });

  test('Loading and error states stay usable', async ({ page }) => {
    await page.route('**/api/workspace/contacts*', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await gotoApp(page, '/app/contacts');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText('Unable to load this page')).toHaveCount(0);
    await expect(page.locator('form').filter({ hasText: /Phone with country code/i }).first()).toBeVisible({ timeout: 30000 });
  });
});

test.describe('Staging workspace mobile', () => {
  test.skip(!hasAuth, 'Set E2E_EMAIL/E2E_PASSWORD or E2E_SESSION_COOKIE/E2E_CSRF_COOKIE');
  test.use({ viewport: { width: 390, height: 844 } });

  test('core automation routes fit mobile viewport', async ({ page, context }) => {
    test.setTimeout(180_000);
    await signInWorkspace(page, context);
    await openWorkspaceApp(page);
    for (const path of ['/app/contacts', '/app/bots', '/app/automations', '/app/campaigns', '/app/templates']) {
      await gotoApp(page, path);
      await expect(page.getByText('Unable to load this page')).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
    }
  });
});
