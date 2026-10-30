import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReplyRule } from '../lib/reply-bots.js';

test('matchReplyRule exact and contains', () => {
  assert.equal(matchReplyRule({ enabled: true, match_type: 'exact', pattern: 'Price' }, 'price'), true);
  assert.equal(matchReplyRule({ enabled: true, match_type: 'exact', pattern: 'Price' }, 'what is price'), false);
  assert.equal(matchReplyRule({ enabled: true, match_type: 'contains', pattern: 'price' }, 'What is the price?'), true);
});

test('matchReplyRule synonyms and keywords', () => {
  assert.equal(matchReplyRule({
    enabled: true,
    match_type: 'any_keyword',
    pattern: 'price',
    synonyms: ['cost', 'fee']
  }, 'What is the fee?'), true);
});

test('matchReplyRule rejects unsafe regex', () => {
  assert.equal(matchReplyRule({ enabled: true, match_type: 'regex', pattern: '(?i)price' }, 'price'), false);
  assert.equal(matchReplyRule({ enabled: true, match_type: 'regex', pattern: 'pri[cz]e' }, 'prize'), true);
});

test('matchReplyRule ignores disabled rules', () => {
  assert.equal(matchReplyRule({ enabled: false, match_type: 'contains', pattern: 'hello' }, 'hello'), false);
});
