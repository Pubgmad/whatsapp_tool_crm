import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCampaignScheduleWithinPolicy } from '../lib/campaign-operations.js';
import { operationalPolicy } from '../lib/operational-policy.js';

test('operational policy exposes campaign max schedule days from env', () => {
  assert.equal(operationalPolicy({ CAMPAIGN_MAX_SCHEDULE_DAYS: '90' }).campaignMaxScheduleDays, 90);
  assert.equal(operationalPolicy({ CAMPAIGN_MAX_SCHEDULE_DAYS: '0' }).campaignMaxScheduleDays, 60);
  assert.equal(operationalPolicy({}).campaignMaxScheduleDays, 60);
});

test('campaign schedule rejects dates beyond policy window', () => {
  const now = Date.parse('2030-06-01T12:00:00Z');
  const env = { CAMPAIGN_MAX_SCHEDULE_DAYS: '30' };
  const ok = new Date('2030-06-20T12:00:00Z');
  assert.doesNotThrow(() => assertCampaignScheduleWithinPolicy(ok, now, env));
  const tooFar = new Date('2030-07-15T12:00:00Z');
  assert.throws(() => assertCampaignScheduleWithinPolicy(tooFar, now, env), (error) => error.code === 'CAMPAIGN_SCHEDULE_TOO_FAR');
  assert.doesNotThrow(() => assertCampaignScheduleWithinPolicy(new Date('2030-05-01T12:00:00Z'), now, env));
});
