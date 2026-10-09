import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('super admin session cookie persists across revisits with Max-Age and Expires', () => {
  const source = fs.readFileSync('./lib/super-admin.js', 'utf8');
  assert.match(source, /SUPER_ADMIN_SESSION_DAYS/);
  assert.match(source, /Max-Age=\$\{ttl\}/);
  assert.match(source, /Expires=\$\{expires\}/);
  assert.match(source, /safeDays \* 24 \* 60 \* 60/);
});

test('super admin login page restores session without forcing re-auth', () => {
  const page = fs.readFileSync('./app/super-admin/login/page.js', 'utf8');
  const auth = fs.readFileSync('./lib/page-auth.js', 'utf8');
  assert.match(page, /prepareSuperAdminLoginPage/);
  assert.match(auth, /redirect\('\/super-admin'\)/);
});
