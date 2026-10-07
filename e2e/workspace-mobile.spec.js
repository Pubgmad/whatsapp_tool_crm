import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import pg from 'pg';
import nextEnv from '@next/env';

async function seedOwner(baseURL) {
  nextEnv.loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL) return null;
  const { hashPassword } = await import('../lib/auth.js');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `mob_b_${suffix}`;
  const userId = `mob_u_${suffix}`;
  const email = `mobile-${suffix}@example.test`;
  const password = crypto.randomBytes(24).toString('base64url');
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$2,$3,$4,NOW())', [userId, 'Mobile QA', email, hashPassword(password)]);
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)', [businessId, 'Mobile QA', `mobile-${suffix}`]);
    await client.query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Owner')", [`mob_m_${suffix}`, userId, businessId]);
    return { email, password, businessId, userId };
  } finally {
    await client.end();
  }
}

test('authenticated owner navigates core workspace on mobile viewport', async ({ page, baseURL }) => {
  test.skip(!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Local database fixture only');
  const account = await seedOwner(baseURL);
  test.skip(!account, 'DATABASE_URL required for mobile workspace test');
  try {
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/, { timeout: 30000 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Contacts' }).click();
  await expect(page.getByRole('heading', { name: 'Audience' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Campaigns' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign builder' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign results' })).toBeVisible();
  await expect(page.getByText(/Campaign operations/i)).toBeVisible();
  } finally {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('DELETE FROM businesses WHERE id=$1', [account.businessId]);
      await client.query('DELETE FROM users WHERE id=$1', [account.userId]);
    } finally {
      await client.end();
    }
  }
});
