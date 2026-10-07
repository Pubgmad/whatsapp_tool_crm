import assert from 'node:assert/strict';
import test from 'node:test';
import { A11Y_E2E_PROJECTS } from '../lib/a11y-certification.js';

test('a11y certification defines five browser projects', () => {
  assert.equal(A11Y_E2E_PROJECTS.length, 5);
});
