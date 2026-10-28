import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('automation UI separates list and canvas-first editor', () => {
  const app = readFileSync(join(root, 'components/workspace-app.js'), 'utf8');
  assert.match(app, /automationListView/);
  assert.match(app, /automationEditorShell/);
  assert.match(app, /startNewWorkflow/);
  assert.match(app, /duplicateFlow/);
  assert.match(app, /Back to list/);
  const css = readFileSync(join(root, 'components/automation-flow-canvas.css'), 'utf8');
  assert.match(css, /automationEditorShell/);
  assert.match(css, /minmax\(0,1fr\) minmax\(280px,340px\)/);
});

test('media and ai-agent routes exist', () => {
  assert.ok(existsSync(join(root, 'app/app/ai-agents/page.js')));
  assert.ok(existsSync(join(root, 'app/app/automations/page.js')));
  assert.ok(existsSync(join(root, 'app/app/settings/whatsapp/flows/page.js')));
  assert.ok(existsSync(join(root, 'app/app/settings/whatsapp/media/page.js')));
});
