import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyRange } from '../lib/whatsapp-journey-analytics.js';

test('journey analytics range rejects invalid and oversized windows', () => {
  assert.deepEqual(journeyRange(new URLSearchParams({ since: '2026-01-01', until: '2026-01-31' })), {
    since: '2026-01-01',
    until: '2026-01-31'
  });
  assert.throws(() => journeyRange(new URLSearchParams({ since: '2026-02-01', until: '2026-01-01' })), {
    code: 'REPORT_RANGE_INVALID'
  });
  assert.throws(() => journeyRange(new URLSearchParams({ since: '2024-01-01', until: '2026-01-02' })), {
    code: 'REPORT_RANGE_INVALID'
  });
  assert.throws(() => journeyRange(new URLSearchParams({ since: '2026-1-1', until: '2026-01-02' })), {
    code: 'REPORT_RANGE_INVALID'
  });
});
