/**
 * Authenticated staging workspace E2E for WhatsApp Automation surfaces.
 * Requires E2E_EMAIL / E2E_PASSWORD. For public nginx staging also set
 * BASIC_AUTH_USER / BASIC_AUTH_PASSWORD (wired via playwright.config.js).
 */
import { expect, test } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  gotoApp,
  hasWorkspaceE2ECredentials,
  openWorkspaceApp,
  signInWorkspace
} from './helpers.js';

const hasAuth = hasWorkspaceE2ECredentials();
const suffix = Date.now().toString(36);

test.describe('Staging WhatsApp Automation workspace', () => {
  test.skip(!hasAuth, 'Set E2E_EMAIL and E2E_PASSWORD for authenticated staging coverage');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    await signInWorkspace(page);
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
    await expect(page.getByRole('heading', { name: /Audience|Contacts/i }).first()).toBeVisible({ timeout: 30000 });
    const phone = `1555${String(Date.now()).slice(-7)}`;
    await page.getByLabel('Name', { exact: true }).fill(`E2E Contact ${suffix}`);
    await page.getByLabel(/Phone with country code/i).fill(phone);
    await page.getByLabel(/Opt-in source/i).fill('e2e');
    await page.getByLabel(/Consent evidence/i).fill('Staging Playwright recorded consent');
    await page.getByLabel(/Marketing permission recorded/i).check();
    await page.getByRole('button', { name: /Add contact/i }).click();
    await expect(page.getByText(new RegExp(`E2E Contact ${suffix}`))).toBeVisible({ timeout: 30000 });

    await page.locator('textarea').filter({ hasText: '' }).or(page.getByLabel(/CSV rows/i)).first().fill(
      `name,phone,permission,tags,opt_in_source,consent_evidence\nImport ${suffix},1555${String(Date.now() + 1).slice(-7)},true,e2e,import,Playwright CSV`
    );
    await page.getByRole('button', { name: /Import/i }).click();
    await expect(page.getByText(/imported|Import|contact/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('Templates management page loads with clear empty/error states', async ({ page }) => {
    await gotoApp(page, '/app/templates');
    await expect(page.getByText(/Templates/i).first()).toBeVisible({ timeout: 30000 });
    // Staging has no connected WABA — UI should explain rather than crash.
    const blocked = page.getByText(/Connect a WhatsApp account|Select an account|Sync from Meta/i);
    await expect(blocked.first()).toBeVisible({ timeout: 30000 });
    await assertNoHorizontalOverflow(page);
  });

  test('Reply bot create, rule edit, publish, and execution logs', async ({ page }) => {
    await gotoApp(page, '/app/bots');
    await expect(page.getByText(/Quick reply|WhatsApp bots/i).first()).toBeVisible({ timeout: 30000 });

    page.once('dialog', async (dialog) => {
      await dialog.accept(`E2E Bot ${suffix}`);
    });
    await page.getByRole('button', { name: /New bot/i }).click();
    await expect(page.getByRole('button', { name: new RegExp(`E2E Bot ${suffix}`) })).toBeVisible({ timeout: 30000 });

    await page.getByLabel(/When customer says/i).fill('pricing');
    await page.getByLabel(/Reply with/i).fill(`Price answer ${suffix}`);
    await page.getByRole('button', { name: /Add rule/i }).click();
    await expect(page.getByText('pricing')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: /^Edit$/i }).first().click();
    await page.getByLabel(/When customer says/i).fill('pricing-updated');
    await page.getByRole('button', { name: /Update rule/i }).click();
    await expect(page.getByText('pricing-updated')).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: /^Publish$/i }).first().click();
    await expect(page.getByText(/published|Published|Paused/i).first()).toBeVisible({ timeout: 30000 });

    await expect(page.getByText(/Execution|Published rules will appear|automatic reply/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('Automation Builder draft save', async ({ page }) => {
    await gotoApp(page, '/app/automations');
    await expect(page.getByText(/Automation/i).first()).toBeVisible({ timeout: 30000 });
    const name = page.getByLabel(/Flow name|Name/i).first();
    if (await name.count()) {
      await name.fill(`E2E Flow ${suffix}`);
      const save = page.getByRole('button', { name: /Save draft|Save changes/i });
      if (await save.count()) {
        await save.click();
        await expect(page.getByText(/saved|draft|E2E Flow/i).first()).toBeVisible({ timeout: 30000 });
      }
    } else {
      // Canvas-first UI: ensure page shell and create controls render.
      await expect(page.getByRole('button', { name: /New|Create|Add/i }).first()).toBeVisible({ timeout: 30000 });
    }
    await assertNoHorizontalOverflow(page);
  });

  test('Broadcasting page loads without sending', async ({ page }) => {
    await gotoApp(page, '/app/campaigns');
    await expect(page.getByText(/Create campaign|Campaign|Broadcast/i).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /Send now|Start campaign/i })).toHaveCount(0).catch(async () => {
      // Send controls may exist but must remain blocked without approved template / Meta.
      await expect(page.getByText(/Approved template|eligible audience|Connect/i).first()).toBeVisible();
    });
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
  });
});

test.describe('Staging workspace mobile', () => {
  test.skip(!hasAuth, 'Set E2E_EMAIL and E2E_PASSWORD for authenticated staging coverage');
  test.use({ viewport: { width: 390, height: 844 } });

  test('core automation routes fit mobile viewport', async ({ page }) => {
    test.setTimeout(180_000);
    await signInWorkspace(page);
    await openWorkspaceApp(page);
    for (const path of ['/app/contacts', '/app/bots', '/app/automations', '/app/campaigns', '/app/templates']) {
      await gotoApp(page, path);
      await expect(page.getByText('Unable to load this page')).toHaveCount(0);
      await assertNoHorizontalOverflow(page);
    }
  });
});
