import assert from 'node:assert/strict';
import test from 'node:test';
import { managedFlowRuntimeUrl } from '../lib/flow-runtime-url.js';
import { validateCallingHours } from '../lib/calling-business-hours.js';
import { requireStringField, requireObject } from '../lib/api-body.js';

test('managedFlowRuntimeUrl requires HTTPS APP_URL', () => {
  const prev = process.env.APP_URL;
  delete process.env.APP_URL;
  assert.equal(managedFlowRuntimeUrl().ok, false);
  process.env.APP_URL = prev;
});

test('validateCallingHours accepts support policy fallback', () => {
  const hours = validateCallingHours({ useSupportPolicy: true });
  assert.equal(hours.useSupportPolicy, true);
});

test('api-body validators reject invalid payloads', () => {
  assert.throws(() => requireObject(null), /JSON object/);
  assert.throws(() => requireStringField({ name: '' }, 'name'), /name/);
});
