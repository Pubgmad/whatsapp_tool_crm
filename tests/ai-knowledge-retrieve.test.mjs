import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkKnowledgeContent, knowledgeSearchTerms } from '../lib/ai-knowledge-retrieve.js';
import { mapDialogflowResponse } from '../lib/dialogflow-bot.js';

test('knowledge search terms extract tokens', () => {
  assert.deepEqual(knowledgeSearchTerms('What is your return policy?'), ['what', 'your', 'return', 'policy']);
  assert.deepEqual(knowledgeSearchTerms('ok'), []);
});

test('knowledge chunking splits long content with overlap', () => {
  const text = 'a'.repeat(2500);
  const chunks = chunkKnowledgeContent(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 1200));
  assert.equal(chunkKnowledgeContent('short faq').length, 1);
});

test('Dialogflow CX text and suggestion chips map to WhatsApp-safe reply', () => {
  assert.equal(mapDialogflowResponse({ queryResult: { responseMessages: [] } }), null);
  assert.equal(
    mapDialogflowResponse({ queryResult: { responseMessages: [{ text: { text: ['Hello'] } }] } }),
    'Hello'
  );
  const rich = mapDialogflowResponse({
    queryResult: {
      responseMessages: [
        { text: { text: ['Choose an option'] } },
        { payload: { suggestions: [{ text: 'Pricing' }, { title: 'Support' }, { label: 'TooLongLabelForWhatsAppChipXX' }] } }
      ]
    }
  });
  assert.equal(rich.text, 'Choose an option');
  assert.deepEqual(rich.suggestions, ['Pricing', 'Support']);
});
