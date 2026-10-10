import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkKnowledgeContent, knowledgeSearchTerms } from '../lib/ai-knowledge-retrieve.js';
import { mapDialogflowResponse } from '../lib/dialogflow-bot.js';
import { cosineSimilarity } from '../lib/ai-embeddings.js';
import { normalizeActionModes } from '../lib/ai-policy.js';

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

test('cosine similarity ranks aligned vectors higher', () => {
  assert.ok(cosineSimilarity([1, 0], [1, 0]) > cosineSimilarity([1, 0], [0, 1]));
});

test('action modes normalize to off/propose/auto', () => {
  assert.deepEqual(normalizeActionModes({ set_order_status: 'AUTO', bogus: 'x' }).set_order_status, 'auto');
  assert.equal(normalizeActionModes({}).add_contact_tag, 'propose');
});

test('Dialogflow CX maps text, buttons, list, media, and CTA plans', () => {
  assert.equal(mapDialogflowResponse({ queryResult: { responseMessages: [] } }), null);
  assert.deepEqual(
    mapDialogflowResponse({ queryResult: { responseMessages: [{ text: { text: ['Hello'] } }] } }),
    { kind: 'text', text: 'Hello', suggestions: [] }
  );
  const buttons = mapDialogflowResponse({
    queryResult: {
      responseMessages: [
        { text: { text: ['Choose an option'] } },
        { payload: { suggestions: [{ text: 'Pricing' }, { title: 'Support' }] } }
      ]
    }
  });
  assert.equal(buttons.kind, 'buttons');
  assert.deepEqual(buttons.suggestions, ['Pricing', 'Support']);

  const list = mapDialogflowResponse({
    queryResult: {
      responseMessages: [
        { text: { text: ['Browse help'] } },
        {
          payload: {
            buttonText: 'Open',
            sections: [{ title: 'Help', rows: [{ id: 'billing', title: 'Billing' }, { id: 'shipping', title: 'Shipping' }] }]
          }
        }
      ]
    }
  });
  assert.equal(list.kind, 'list');
  assert.equal(list.list.options.length, 2);

  const media = mapDialogflowResponse({
    queryResult: {
      responseMessages: [{
        payload: { fileUrl: 'https://cdn.example.com/catalog.pdf', fileType: 'FILE', altText: 'Catalog', filename: 'catalog.pdf' }
      }]
    }
  });
  assert.equal(media.kind, 'media');
  assert.equal(media.media.type, 'document');

  const cta = mapDialogflowResponse({
    queryResult: {
      responseMessages: [
        { text: { text: ['Continue on our site'] } },
        { payload: { url: 'https://example.com/book', displayText: 'Book now', header: 'Booking' } }
      ]
    }
  });
  assert.equal(cta.kind, 'cta');
  assert.equal(cta.cta.displayText, 'Book now');
});
