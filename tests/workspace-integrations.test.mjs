import assert from 'node:assert/strict';
import test from 'node:test';
import {INTEGRATION_EVENT_TYPES,INTEGRATION_SCOPES,publicWebhookAddress} from '../lib/workspace-integrations.js';

test('publicWebhookAddress rejects private IPv4', () => {
  assert.equal(publicWebhookAddress('8.8.8.8'), true);
  assert.equal(publicWebhookAddress('10.0.0.1'), false);
});

test('public integration contract exposes granular scopes and expanded events',()=>{
  assert.deepEqual(INTEGRATION_SCOPES,['contacts:read','contacts:write','templates:read','messages:template:send','workflows:execute']);
  assert.ok(INTEGRATION_EVENT_TYPES.length>10);
  assert.ok(INTEGRATION_EVENT_TYPES.includes('whatsapp_flow_completed'));
  assert.ok(INTEGRATION_EVENT_TYPES.includes('interactive_button_reply'));
});
