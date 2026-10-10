import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateAdCreditHoldMinor, metaSpendToMinor } from '../lib/ad-credits.js';

test('estimateAdCreditHoldMinor uses lifetime budget when present', () => {
  assert.equal(
    estimateAdCreditHoldMinor({
      payload: { adset: { lifetime_budget: 50000, daily_budget: 1000 } }
    }),
    50000
  );
});

test('estimateAdCreditHoldMinor multiplies daily budget by schedule days', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  const hold = estimateAdCreditHoldMinor(
    {
      payload: {
        adset: {
          daily_budget: 10000,
          start_time: '2026-01-01T00:00:00.000Z',
          end_time: '2026-01-04T00:00:00.000Z'
        }
      }
    },
    { now }
  );
  assert.equal(hold, 30000);
});

test('metaSpendToMinor converts Meta spend to wallet minor units', () => {
  assert.equal(metaSpendToMinor('12.50', 'INR'), 1250);
  assert.equal(metaSpendToMinor('', 'INR'), 0);
});
