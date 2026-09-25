import test from 'node:test';
import assert from 'node:assert/strict';
import { requireWorkspaceManager } from '../lib/workspace-permissions.js';

test('workspace mutations require an owner or manager', () => {
  assert.doesNotThrow(() => requireWorkspaceManager({ role: 'Owner' }));
  assert.doesNotThrow(() => requireWorkspaceManager({ role: 'Manager' }));
  assert.throws(() => requireWorkspaceManager({ role: 'Agent' }), { code: 'WORKSPACE_PERMISSION_REQUIRED' });
  assert.throws(() => requireWorkspaceManager(null), { code: 'WORKSPACE_PERMISSION_REQUIRED' });
});
