import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('inbox API route bootstraps full loadState rather than slim conversations payload', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/workspace/inbox/route.js'), 'utf8');
  assert.match(source, /loadState/);
  assert.match(source, /view:\s*['"]inbox['"]/);
  assert.doesNotMatch(source, /loadWorkspaceInbox/);
});

test('workspace shell guards missing setup and maps setup subviews to setup API', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/workspace-app.js'), 'utf8');
  assert.match(source, /setup:\s*\{\s*status:\s*'Not connected'/);
  assert.match(source, /setupSectionByView\[view\]\s*\?\s*'setup'/);
  assert.match(source, /state\.setup\?\.status/);
});

test('agent inbox listing clamps assignment for non-mine filters', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/workspace-inbox-loader.js'), 'utf8');
  assert.match(source, /filter !== 'mine' && filter !== 'unassigned'/);
  assert.match(source, /assigned_user_id IS NULL OR c\.assigned_user_id/);
});
