import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCampaignTimezone } from '../lib/campaign-operations.js';

test('validateCampaignTimezone accepts IANA zones and falls back safely', () => {
  assert.equal(validateCampaignTimezone('Asia/Kolkata'), 'Asia/Kolkata');
  assert.equal(validateCampaignTimezone('Not/AZone'), 'UTC');
});
