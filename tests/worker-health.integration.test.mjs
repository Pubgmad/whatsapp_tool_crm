import test from 'node:test';
import assert from 'node:assert/strict';
import {enterSystemContext,query} from '../lib/db.js';
import {readiness} from '../lib/health.js';

test('readiness reports a live worker with a failing queue as degraded',async()=>{
  if(!process.env.TEST_DATABASE_URL)return;
  enterSystemContext();
  await query(`INSERT INTO worker_heartbeats(worker_name,last_success_at,last_cycle_errors)
    VALUES('queue',NOW(),$1::jsonb) ON CONFLICT(worker_name) DO UPDATE SET
    last_success_at=NOW(),last_cycle_errors=EXCLUDED.last_cycle_errors`,[JSON.stringify({crmSync:'PROVIDER_TIMEOUT'})]);
  const response=await readiness();
  const body=await response.json();
  assert.equal(response.status,503);
  assert.equal(body.worker,'degraded');
  assert.deepEqual(body.workerFailures,{crmSync:'PROVIDER_TIMEOUT'});
});
