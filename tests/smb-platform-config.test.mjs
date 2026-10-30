import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHEETS_SYNC,
  DEFAULT_PROVIDERS,
  DEFAULT_PLAYBOOKS,
  DEFAULT_BOT_TEMPLATES,
  MARKETPLACE_ADAPTERS
} from '../lib/smb-platform-config.js';

test('sheets sync defaults are within safe bounds', () => {
  assert.ok(DEFAULT_SHEETS_SYNC.pollIntervalMinutes >= DEFAULT_SHEETS_SYNC.minIntervalMinutes);
  assert.ok(DEFAULT_SHEETS_SYNC.pollIntervalMinutes <= DEFAULT_SHEETS_SYNC.maxIntervalMinutes);
  assert.ok(DEFAULT_SHEETS_SYNC.maxRowsPerSync >= 100);
});

test('marketplace adapters are a closed allowlist', () => {
  for (const provider of DEFAULT_PROVIDERS) {
    assert.ok(MARKETPLACE_ADAPTERS.has(provider.adapter), provider.id);
  }
  assert.equal(MARKETPLACE_ADAPTERS.has('arbitrary_script'), false);
});

test('default playbooks only use safe kinds', () => {
  for (const playbook of DEFAULT_PLAYBOOKS) {
    assert.ok(['checkout_recovery', 'commerce_preset'].includes(playbook.kind));
  }
});

test('reply bot templates include rules with pattern and reply', () => {
  assert.ok(DEFAULT_BOT_TEMPLATES.length >= 1);
  for (const template of DEFAULT_BOT_TEMPLATES) {
    assert.ok(template.rules.length >= 1);
    for (const rule of template.rules) {
      assert.ok(rule.pattern);
      assert.ok(rule.replyText);
    }
  }
});
