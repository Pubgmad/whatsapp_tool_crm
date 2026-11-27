#!/usr/bin/env node
/**
 * Sets a temporary Owner password for staging E2E. Writes KEY=value to stdout only
 * when STAGING_E2E_EMIT=1 (caller should redirect to a 0600 file). Never logs secrets.
 */
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import { enterSystemContext, query } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';

nextEnv.loadEnvConfig(process.cwd());

const raw = process.env.DATABASE_URL || '';
const db = new URL(raw.includes('://') ? raw : `postgresql://${raw}`).pathname.replace(/^\//, '');
if (!/staging/i.test(db)) {
  console.error('Refusing non-staging database');
  process.exit(2);
}

enterSystemContext();
const owner = (await query(`
  SELECT u.id, u.email FROM users u
  JOIN memberships m ON m.user_id=u.id
  WHERE m.role='Owner'
  ORDER BY u.created_at LIMIT 1
`)).rows[0];
if (!owner) {
  console.error('No owner user');
  process.exit(1);
}

const password = crypto.randomBytes(24).toString('base64url');
await query('UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at,NOW()), updated_at=NOW() WHERE id=$1', [
  owner.id,
  hashPassword(password)
]);

if (process.env.STAGING_E2E_EMIT === '1') {
  process.stdout.write(`E2E_EMAIL=${owner.email}\nE2E_PASSWORD=${password}\n`);
} else {
  console.log(JSON.stringify({ ok: true, email: owner.email, passwordSet: true, database: db }));
}
