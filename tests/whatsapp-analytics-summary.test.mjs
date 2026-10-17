import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAnalyticsPayload } from '../lib/whatsapp-analytics-summary.js';
import { readFileSync } from 'node:fs';

test('analytics summary reads Meta messaging and conversation fields', () => {
  const summary = summarizeAnalyticsPayload({
    analytics: { data_points: [{ sent: 10, delivered: 8, read: 3 }, { sent: 2, delivered: 2, read: 1 }] },
    conversation_analytics: { data: [{ conversation: 4, cost: 1.5 }, { conversation: 1 }] }
  });
  assert.equal(summary.sent, 12);
  assert.equal(summary.delivered, 10);
  assert.equal(summary.read, 4);
  assert.equal(summary.conversations, 5);
  assert.equal(summary.cost, 1.5);
  assert.equal(summary.hasMetrics, true);
});

test('analytics summary stays empty for blank payloads', () => {
  assert.equal(summarizeAnalyticsPayload(null).hasMetrics, false);
  assert.equal(summarizeAnalyticsPayload({}).hasMetrics, false);
});

test('invite accept page sends CSRF token with join request', () => {
  const source = readFileSync(new URL('../app/invite/[token]/page.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/security\/csrf/);
  assert.match(source, /x-csrf-token/);
});
