import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionPayload, assertConversionReplay } from '../lib/whatsapp-conversions.js';
import { normalizeWhatsAppReferral } from '../lib/whatsapp-referral.js';

const settings={page_id:'123',waba_id:'456'};
const attribution={sourceType:'AD',ctwaClid:'click-id'};
const input={eventId:'order:123',eventName:'Purchase',value:'49.95',currency:'INR',consentConfirmed:true};

test('WhatsApp conversion payload preserves attribution and uses business messaging',()=>{
  const event=conversionPayload(input,attribution,settings,1700000000000).data[0];
  assert.equal(event.action_source,'business_messaging');assert.equal(event.messaging_channel,'whatsapp');
  assert.deepEqual(event.user_data,{ctwa_clid:'click-id',page_id:'123',whatsapp_business_account_id:'456'});
  assert.deepEqual(event.custom_data,{value:49.95,currency:'INR'});
  assert.equal(event.event_id,'order:123');
});

test('measurement requires explicit consent, attribution and valid monetary data',()=>{
  assert.throws(()=>conversionPayload({...input,consentConfirmed:false},attribution,settings),{code:'MEASUREMENT_CONSENT_REQUIRED'});
  assert.throws(()=>conversionPayload(input,{},settings),{code:'CTWA_ATTRIBUTION_REQUIRED'});
  for(const patch of [{value:''},{value:-1},{value:'NaN'},{currency:'inr'},{eventTime:1}]) assert.throws(()=>conversionPayload({...input,...patch},attribution,settings));
});

test('referrals retain bounded Meta click IDs only for ad referrals',()=>{
  assert.equal(normalizeWhatsAppReferral({source_type:'ad',source_id:'123',ctwa_clid:'click-id'}).ctwaClid,'click-id');
  assert.equal(normalizeWhatsAppReferral({source_type:'post',source_id:'123',ctwa_clid:'click-id'}).ctwaClid,undefined);
  assert.equal(normalizeWhatsAppReferral({source_type:'ad',source_id:'123',ctwa_clid:'x'.repeat(2049)}).ctwaClid,undefined);
});

test('conversion replay accepts the same outcome but rejects changed data or tenant assets',()=>{
  const payload=conversionPayload(input,attribution,settings,1700000000000);
  const existing={payload,conversation_id:'conversation',dataset_id:'dataset'};
  assert.doesNotThrow(()=>assertConversionReplay(existing,payload,'conversation','dataset'));
  const reordered={...existing,payload:JSON.parse(JSON.stringify(payload))};
  reordered.payload.data[0].user_data={whatsapp_business_account_id:'456',page_id:'123',ctwa_clid:'click-id'};
  reordered.payload.data[0].custom_data={currency:'INR',value:49.95};
  assert.doesNotThrow(()=>assertConversionReplay(reordered,payload,'conversation','dataset'));
  const later=conversionPayload(input,attribution,settings,1700000001000);
  assert.doesNotThrow(()=>assertConversionReplay(existing,later,'conversation','dataset'));
  assert.throws(()=>assertConversionReplay(existing,later,'conversation','dataset',1700000001),{code:'CONVERSION_REFERENCE_CONFLICT'});
  for (const [conversation,dataset] of [['other','dataset'],['conversation','other']])
    assert.throws(()=>assertConversionReplay(existing,payload,conversation,dataset),{code:'CONVERSION_REFERENCE_CONFLICT'});
  assert.throws(()=>assertConversionReplay(existing,conversionPayload({...input,value:'50'},attribution,settings,1700000000000),'conversation','dataset'),{code:'CONVERSION_REFERENCE_CONFLICT'});
});
