#!/usr/bin/env node
/**
 * Staging-only Super Admin bootstrap.
 * Requires SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD in the process environment
 * (or .env.local). Never prints credentials. Uses ensureConfiguredSuperAdmin.
 */
import nextEnv from '@next/env';
import { enterSystemContext, query } from '../lib/db.js';
import { ensureConfiguredSuperAdmin } from '../lib/super-admin.js';

nextEnv.loadEnvConfig(process.cwd());
const raw = process.env.DATABASE_URL || '';
const db = new URL(raw.includes('://') ? raw : `postgresql://${raw}`).pathname.replace(/^\//, '');
if (!/staging/i.test(db)) {
  console.error('Refusing non-staging database');
  process.exit(2);
}

const email = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
if (!email || !password) {
  console.error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in the staging environment before running.');
  process.exit(1);
}
if (password.length < 12) {
  console.error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

enterSystemContext();
await ensureConfiguredSuperAdmin();
const row = await query('SELECT id, email, active, mfa_enabled, created_at FROM super_admins WHERE email = $1', [email]);
const admin = row.rows[0];
if (!admin?.active) {
  console.error('Super Admin row missing or inactive after bootstrap.');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  database: db,
  loginPath: '/super-admin/login',
  emailConfigured: true,
  emailDomain: email.includes('@') ? email.split('@')[1] : null,
  mfaEnabled: Boolean(admin.mfa_enabled),
  adminIdPrefix: String(admin.id || '').slice(0, 6)
}, null, 2));
