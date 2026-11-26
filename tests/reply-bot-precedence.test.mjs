import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReplyBotOutcome } from '../lib/reply-bots.js';
import { normalizeTemplateStatus } from '../lib/template-meta-sync.js';

test('selectReplyBotOutcome prefers rule match over fallback', () => {
  const bots = [
    { id: 'b1', name: 'FAQ', fallback_text: 'Default help' }
  ];
  const rules = new Map([
    ['b1', [
      { id: 'r1', enabled: true, match_type: 'contains', pattern: 'price', reply_text: 'Our pricing…', synonyms: [] }
    ]]
  ]);
  const outcome = selectReplyBotOutcome(bots, rules, 'What is the price?');
  assert.equal(outcome.matched?.replyText, 'Our pricing…');
  assert.equal(outcome.matched?.fallback, false);
  assert.equal(outcome.deferredFallback, null);
});

test('selectReplyBotOutcome defers fallback instead of treating it as a hard match', () => {
  const bots = [
    { id: 'b1', name: 'FAQ', fallback_text: 'Default help' }
  ];
  const rules = new Map([
    ['b1', [
      { id: 'r1', enabled: true, match_type: 'contains', pattern: 'hours', reply_text: '9 to 5', synonyms: [] }
    ]]
  ]);
  const outcome = selectReplyBotOutcome(bots, rules, 'I need a human');
  assert.equal(outcome.matched, null);
  assert.equal(outcome.deferredFallback?.fallback, true);
  assert.equal(outcome.deferredFallback?.replyText, 'Default help');
});

test('selectReplyBotOutcome skips empty-rule bots for fallback starvation', () => {
  const bots = [
    { id: 'empty', name: 'Empty', fallback_text: 'should not win' },
    { id: 'faq', name: 'FAQ', fallback_text: 'FAQ fallback' }
  ];
  const rules = new Map([
    ['empty', []],
    ['faq', [{ id: 'r1', enabled: true, match_type: 'contains', pattern: 'x', reply_text: 'X', synonyms: [] }]]
  ]);
  const outcome = selectReplyBotOutcome(bots, rules, 'unrelated');
  assert.equal(outcome.deferredFallback?.bot.id, 'faq');
});

test('normalizeTemplateStatus maps Meta statuses for send gating', () => {
  assert.equal(normalizeTemplateStatus('APPROVED'), 'Approved');
  assert.equal(normalizeTemplateStatus('REJECTED'), 'Rejected');
  assert.equal(normalizeTemplateStatus('PENDING'), 'Pending');
  assert.equal(normalizeTemplateStatus('PAUSED'), 'Pending');
  assert.equal(normalizeTemplateStatus('DISABLED'), 'Pending');
  assert.equal(normalizeTemplateStatus('DRAFT'), 'Draft');
});
