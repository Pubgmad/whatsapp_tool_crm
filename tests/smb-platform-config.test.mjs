import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHEETS_SYNC,
  DEFAULT_PROVIDERS,
  DEFAULT_PLAYBOOKS,
  DEFAULT_BOT_TEMPLATES,
  DEFAULT_ONBOARDING_GOALS,
  DEFAULT_CONCIERGE_TOPICS,
  DEFAULT_ZOHO_POLICY,
  DEFAULT_FALLBACK,
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

test('onboarding goals and concierge topics have ids and labels', () => {
  assert.ok(DEFAULT_ONBOARDING_GOALS.length >= 3);
  for (const goal of DEFAULT_ONBOARDING_GOALS) {
    assert.ok(goal.id && goal.label && goal.next);
  }
  assert.ok(DEFAULT_CONCIERGE_TOPICS.length >= 3);
  for (const topic of DEFAULT_CONCIERGE_TOPICS) {
    assert.ok(topic.id && topic.label);
  }
});

test('zoho sync policy and default fallback are defined', () => {
  assert.ok(DEFAULT_ZOHO_POLICY.intervalMinutes >= DEFAULT_ZOHO_POLICY.minIntervalMinutes);
  assert.ok(DEFAULT_ZOHO_POLICY.modules.includes('Contacts'));
  assert.ok(String(DEFAULT_FALLBACK).length > 10);
});
