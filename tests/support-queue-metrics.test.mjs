import test from 'node:test';
import assert from 'node:assert/strict';
import { openSupportQueueCounts } from '../lib/support-queue-metrics.js';

test('openSupportQueueCounts maps waiting and breached for open conversations', async () => {
  const run = async (sql) => {
    if (sql.includes('DISTINCT assigned_user_id')) {
      return { rows: [{ open_assigned: 4 }] };
    }
    return { rows: [{ waiting_now: 3, breached_now: 1 }] };
  };
  const counts = await openSupportQueueCounts('biz', run);
  assert.equal(counts.waitingNow, 3);
  assert.equal(counts.breachedNow, 1);
  assert.equal(counts.openAssigned, 4);
});
