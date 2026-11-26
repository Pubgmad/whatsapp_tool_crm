import test from 'node:test';
import assert from 'node:assert/strict';
import { planInboundAutomationOutcome } from '../lib/inbound-automation-orchestration.js';

test('planInboundAutomationOutcome cancels AI when reply bot handled', () => {
  assert.equal(planInboundAutomationOutcome({ botHandled: true, automationJob: null, hasDeferredFallback: false }), 'cancel_ai');
});

test('planInboundAutomationOutcome prefers automation over deferred fallback', () => {
  assert.equal(
    planInboundAutomationOutcome({ botHandled: false, automationJob: { jobId: 'aj_1' }, hasDeferredFallback: true }),
    'cancel_ai'
  );
});

test('planInboundAutomationOutcome delivers deferred fallback when nothing else claimed', () => {
  assert.equal(
    planInboundAutomationOutcome({ botHandled: false, automationJob: null, hasDeferredFallback: true }),
    'deliver_deferred_fallback'
  );
});

test('planInboundAutomationOutcome allows AI when no bot or automation claim', () => {
  assert.equal(planInboundAutomationOutcome({ botHandled: false, automationJob: null, hasDeferredFallback: false }), 'allow_ai');
});