import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContactEligibleForTemplate,
  contactEligibleSql,
  requiresMarketingOptIn
} from '../lib/campaign-audience-eligibility.js';

test('utility templates do not require marketing opt-in', () => {
  assert.equal(requiresMarketingOptIn('UTILITY'), false);
  assert.equal(contactEligibleSql('UTILITY'), 'unsubscribed = FALSE');
  assert.equal(contactEligibleSql('UTILITY', 'c'), 'c.unsubscribed = FALSE');
  assert.doesNotThrow(() =>
    assertContactEligibleForTemplate({ marketing_permission: false, unsubscribed: false }, 'UTILITY')
  );
});

test('marketing templates require marketing opt-in', () => {
  assert.equal(requiresMarketingOptIn('MARKETING'), true);
  assert.match(contactEligibleSql('MARKETING'), /marketing_permission = TRUE/);
  assert.throws(
    () => assertContactEligibleForTemplate({ marketing_permission: false, unsubscribed: false }, 'MARKETING'),
    (error) => error.code === 'RECIPIENT_OPTED_OUT'
  );
});
