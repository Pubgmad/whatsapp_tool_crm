import test from 'node:test';
import assert from 'node:assert/strict';
import { configurationEvent, applyMetaConfigurationEvent } from '../lib/meta-configuration-events.js';

test('failed Meta refresh invalidates stale eligibility and requests a webhook retry', async () => {
  const calls = [];
  await assert.rejects(applyMetaConfigurationEvent('company', '123', 'account_update', {}, {
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'account', access_token_encrypted: 'encrypted' }] }; },
    decrypt: () => 'test-token',
    fetch: async () => { throw new Error('offline'); }
  }), { code: 'META_CONFIGURATION_REFRESH_FAILED', status: 503 });
  assert.match(calls[1].sql, /UNKNOWN/);
  assert.deepEqual(calls[1].params, ['account', 'company']);
});

test('configuration events reject malformed and unrelated inputs', () => {
  assert.equal(configurationEvent('messages', {}), null);
  assert.equal(configurationEvent('account_update', []), null);
  assert.equal(configurationEvent('message_template_quality_update', { message_template_id: '../bad' }), null);
});

test('template updates are scoped to the resolved company and Meta template ID', async () => {
  const calls = [];
  await applyMetaConfigurationEvent('company', '123', 'message_template_quality_update', { message_template_id: '456', new_quality_score: 'RED' }, {
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'account' }] }; }
  });
  assert.deepEqual(calls[0].params, ['company', '123']);
  assert.deepEqual(calls[1].params.slice(2), ['company', '456']);
  assert.match(calls[1].sql, /business_id=\$3 AND meta_template_id=\$4/);
});

test('an unknown WABA cannot update another company', async () => {
  let count = 0;
  await applyMetaConfigurationEvent('company', '123', 'account_update', {}, {
    query: async () => { count++; return { rows: [] }; }
  });
  assert.equal(count, 1);
});

test('terms notifications use authoritative onboarding status, not assumed approval', async () => {
  const calls = [];
  await applyMetaConfigurationEvent('company', '123', 'account_update', { event: 'MM_LITE_TERMS_SIGNED' }, {
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'account', access_token_encrypted: 'encrypted' }] }; },
    decrypt: () => 'test-token',
    fetch: async (url, options) => {
      assert.equal(url.searchParams.get('fields'), 'marketing_messages_onboarding_status');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ marketing_messages_onboarding_status: 'ELIGIBLE' }) };
    }
  });
  assert.equal(JSON.parse(calls[1].params[0]).status, 'ELIGIBLE');
});
