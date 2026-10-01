import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportSuggestion, parseSupportResponse } from '../lib/ai-support.js';

const response = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });

test('assistant accepts only grounded, bounded responses and explicit handoff', () => {
  assert.deepEqual(parseSupportResponse(response({ decision: 'answer', answer: 'A documented answer.', source_ids: ['doc1'] }), ['doc1']), { handoff: false, suggestion: 'A documented answer.', sourceIds: ['doc1'] });
  assert.deepEqual(parseSupportResponse(response({ decision: 'handoff', answer: '', source_ids: [] }), ['doc1']), { handoff: true, suggestion: '', sourceIds: [] });
  assert.throws(() => parseSupportResponse(response({ decision: 'answer', answer: 'Invented.', source_ids: ['other'] }), ['doc1']), { code: 'OPENAI_INVALID_RESPONSE' });
  assert.throws(() => parseSupportResponse(response({ decision: 'answer', answer: 'Duplicated citation.', source_ids: ['doc1', 'doc1'] }), ['doc1']), { code: 'OPENAI_INVALID_RESPONSE' });
  assert.throws(() => parseSupportResponse(response({ decision: 'answer', answer: 'Malformed citation.', source_ids: [null] }), ['doc1']), { code: 'OPENAI_INVALID_RESPONSE' });
  assert.throws(() => parseSupportResponse(response({ decision: 'answer', answer: 'No source.', source_ids: [] }), ['doc1']), { code: 'OPENAI_UNGROUNDED' });
  assert.throws(() => parseSupportResponse({ status: 'incomplete', output: [] }, ['doc1']), { code: 'OPENAI_INCOMPLETE' });
});

test('assistant sends configured knowledge and recent conversation only with store disabled', async () => {
  let request;
  const suggestion = await createSupportSuggestion({ model: 'configured-model', key: 'test-key', instructions: 'Use a professional tone.', knowledge: [{ id: 'doc1', title: 'Returns', content: 'Returns take seven days.' }], messages: [{ role: 'customer', text: 'When is my return?' }], fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    request = JSON.parse(options.body);
    return { ok: true, json: async () => response({ decision: 'answer', answer: 'Returns take seven days.', source_ids: ['doc1'] }) };
  } });
  assert.equal(request.model, 'configured-model');
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input.includes('Returns take seven days.'), true);
  assert.equal(suggestion.suggestion, 'Returns take seven days.');
});
