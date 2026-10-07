import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWebhookAddress } from '../lib/workspace-integrations.js';

test('publicWebhookAddress rejects private IPv4', () => {
  assert.equal(publicWebhookAddress('8.8.8.8'), true);
  assert.equal(publicWebhookAddress('10.0.0.1'), false);
});
