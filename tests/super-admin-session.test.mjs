import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('super admin uses a browser session cookie without Max-Age persistence', () => {
  const source = fs.readFileSync('./lib/super-admin.js', 'utf8');
  assert.match(source, /SUPER_ADMIN_SESSION_HOURS/);
  const cookieFn = source.slice(source.indexOf('export function superSessionCookie'), source.indexOf('export function clearSuperSessionCookie'));
  assert.doesNotMatch(cookieFn, /Max-Age=/);
  assert.doesNotMatch(cookieFn, /Expires=/);
  assert.match(cookieFn, /Session cookie/);
});

test('middleware clears super admin session when leaving admin pages', () => {
  const middleware = fs.readFileSync('./middleware.js', 'utf8');
  assert.match(middleware, /wcrm_super_session/);
  assert.match(middleware, /pathname\.startsWith\('\/super-admin'\)/);
  assert.match(middleware, /maxAge:\s*0/);
});

test('super admin login page does not auto-skip authentication', () => {
  const page = fs.readFileSync('./app/super-admin/login/page.js', 'utf8');
  const auth = fs.readFileSync('./lib/page-auth.js', 'utf8');
  assert.doesNotMatch(page, /prepareSuperAdminLoginPage/);
  assert.doesNotMatch(auth, /prepareSuperAdminLoginPage/);
});
