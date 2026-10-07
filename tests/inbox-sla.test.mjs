import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxSlaSnapshot } from '../lib/inbox-sla-snapshot.js';

test('inboxSlaSnapshot reads slaMinutes from support policy config', async () => {
  const run = async (sql) => {
    if (sql.includes('support_waiting')) {
      return { rows: [{ waiting_now: 2, breached_now: 1, breached_7d: 3 }] };
    }
    return { rows: [{ config: { slaMinutes: 15 }, last_checked_at: '2026-01-01T00:00:00.000Z' }] };
  };
  const snapshot = await inboxSlaSnapshot('biz_test', run);
  assert.equal(snapshot.waitingNow, 2);
  assert.equal(snapshot.breachedNow, 1);
  assert.equal(snapshot.responseMinutes, 15);
  assert.equal(snapshot.policyConfigured, true);
});
