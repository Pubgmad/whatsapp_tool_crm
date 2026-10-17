import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspaceManager } from '../lib/workspace-roles.ts';

test('team management roles match shared workspace manager gate', () => {
  assert.equal(isWorkspaceManager('Owner'), true);
  assert.equal(isWorkspaceManager('Manager'), true);
  assert.equal(isWorkspaceManager('Agent'), false);
  assert.equal(isWorkspaceManager('Viewer'), false);
  assert.equal(isWorkspaceManager(null), false);
});
