import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLeadgenFields } from '../lib/meta-leadgen-ingest.js';

test('normalizeLeadgenFields maps phone and email from Meta field_data', () => {
  const normalized = normalizeLeadgenFields([
    { name: 'phone_number', values: ['+91 98765 43210'] },
    { name: 'email', values: ['lead@example.test'] },
    { name: 'full_name', values: ['Ada Lead'] }
  ]);
  assert.match(normalized.phone, /9876543210/);
  assert.equal(normalized.email, 'lead@example.test');
  assert.equal(normalized.name, 'Ada Lead');
});
