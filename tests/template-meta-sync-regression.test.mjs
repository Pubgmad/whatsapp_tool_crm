import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTemplateStatus } from '../lib/template-meta-sync.js';

test('normalizeTemplateStatus treats Meta non-sendable states as Pending', () => {
  for (const status of ['PAUSED', 'DISABLED', 'IN_APPEAL', 'pending', 'PENDING']) {
    assert.equal(normalizeTemplateStatus(status), 'Pending', status);
  }
});

test('normalizeTemplateStatus preserves sendable and terminal states', () => {
  assert.equal(normalizeTemplateStatus('APPROVED'), 'Approved');
  assert.equal(normalizeTemplateStatus('REJECTED'), 'Rejected');
  assert.equal(normalizeTemplateStatus('DRAFT'), 'Draft');
});