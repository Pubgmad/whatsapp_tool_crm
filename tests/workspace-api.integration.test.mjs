import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxSlaDashboard } from '../lib/inbox-sla-snapshot.js';
import { workspaceProductionCertification } from '../lib/production-certification.js';
import { isWorkspaceManager } from '../lib/workspace-roles.js';

test('workspace role helper identifies managers', () => {
  assert.equal(isWorkspaceManager('Owner'), true);
  assert.equal(isWorkspaceManager('Manager'), true);
  assert.equal(isWorkspaceManager('Agent'), false);
});

test('inbox SLA dashboard returns role-aware payload', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { query } = await import('../lib/db.js');
  const row = (await query('SELECT id FROM businesses ORDER BY created_at LIMIT 1')).rows[0];
  if (!row) return;
  const member = (
    await query(
      'SELECT u.id, m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 LIMIT 1',
      [row.id]
    )
  ).rows[0];
  if (!member) return;
  const payload = await inboxSlaDashboard(row.id, member.id, member.role);
  assert.ok(typeof payload.waitingNow === 'number');
  assert.ok(Array.isArray(payload.waiting));
});

test('production certification uses cached Meta health by default', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { query } = await import('../lib/db.js');
  const row = (await query('SELECT id FROM businesses ORDER BY created_at LIMIT 1')).rows[0];
  if (!row) return;
  const cert = await workspaceProductionCertification(row.id, { deepProbe: false });
  const meta = cert.checks.find((item) => item.id === 'whatsapp_meta');
  if (meta) {
    assert.match(meta.label, /cached/i);
  }
});
