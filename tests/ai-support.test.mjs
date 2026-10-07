import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportSuggestion, parseSupportResponse, parseAiDailyLimit, verifiedSupportFacts } from '../lib/ai-support.js';

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

test('verified CRM facts are scoped to the selected tenant and contact', async () => {
  const statements=[];
  const facts=await verifiedSupportFacts('tenant_1','contact_1',async(sql,params)=>{
    statements.push({sql,params});
    return {rows:sql.includes('FROM whatsapp_orders')
      ?[{id:'wo_1',fulfillment_status:'processing',payment_status:'unpaid',created_at:'2026-10-01T00:00:00.000Z'}]
      :[{id:'frv_1',status:'pending_external',external_status:'pending',title:'Consultation',starts_at:'2026-10-08T10:00:00Z'}]};
  });
  assert.equal(statements.length,2);
  for(const statement of statements){
    assert.deepEqual(statement.params,['tenant_1','contact_1']);
    assert.match(statement.sql,/business_id=\$1/);
    assert.match(statement.sql,/id=\$2|contact_id=\$2/);
  }
  assert.equal(facts[0].kind,'crm_order');
  assert.match(facts[0].content,/unpaid/);
  assert.equal(facts[1].kind,'crm_booking');
  assert.match(facts[1].content,/pending_external/);
});

test('AI daily limits reject disabled and malformed platform values',()=>{
  assert.equal(parseAiDailyLimit(25),25);
  assert.equal(parseAiDailyLimit(0),0);
  assert.throws(()=>parseAiDailyLimit(-1),{code:'AI_LIMIT_NOT_CONFIGURED'});
  assert.throws(()=>parseAiDailyLimit(1.5),{code:'AI_LIMIT_NOT_CONFIGURED'});
  assert.throws(()=>parseAiDailyLimit('not a number'),{code:'AI_LIMIT_NOT_CONFIGURED'});
  assert.throws(()=>parseAiDailyLimit(null),{code:'AI_LIMIT_NOT_CONFIGURED'});
});
