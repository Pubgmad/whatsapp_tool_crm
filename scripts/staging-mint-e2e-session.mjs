#!/usr/bin/env node
/**
 * Mint a short-lived workspace session + CSRF for Playwright.
 * Emits JSON to stdout when STAGING_E2E_EMIT=1 (redirect to a 0600 file).
 */
import nextEnv from '@next/env';
import { enterSystemContext, query } from '../lib/db.js';
import { createSessionToken } from '../lib/auth.js';
import { createCsrfToken } from '../lib/security.js';

nextEnv.loadEnvConfig(process.cwd());
const raw = process.env.DATABASE_URL || '';
const db = new URL(raw.includes('://') ? raw : `postgresql://${raw}`).pathname.replace(/^\//, '');
if (!/staging/i.test(db)) {
  console.error('Refusing non-staging database');
  process.exit(2);
}

enterSystemContext();
const owner = (await query(`
  SELECT u.id AS user_id, COALESCE(u.session_version,0) AS session_version, m.business_id, m.role
  FROM users u
  JOIN memberships m ON m.user_id=u.id
  WHERE m.role='Owner'
  ORDER BY u.created_at LIMIT 1
`)).rows[0];
if (!owner) {
  console.error('No owner');
  process.exit(1);
}

const session = createSessionToken({
  userId: owner.user_id,
  businessId: owner.business_id,
  role: owner.role,
  sessionVersion: Number(owner.session_version) || 0
});
const csrf = createCsrfToken();
const payload = {
  cookies: [
    { name: 'wcrm_session', value: session, httpOnly: true, sameSite: 'Lax', path: '/' },
    { name: 'wcrm_csrf', value: csrf, httpOnly: false, sameSite: 'Lax', path: '/' }
  ]
};

if (process.env.STAGING_E2E_EMIT === '1') {
  process.stdout.write(JSON.stringify(payload));
} else {
  console.log(JSON.stringify({ ok: true, cookieCount: payload.cookies.length, database: db }));
}
