import test from 'node:test';
import assert from 'node:assert/strict';
import {adEvidence,parseAdAdvice,createAdAdvice} from '../lib/whatsapp-ad-advice.js';

const evidence=adEvidence([{campaign_id:'123',impressions:'500',reach:'350',clicks:'12',spend:'25.50',actions:[{action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3'}]}],'USD',{since:'2026-09-01',until:'2026-09-30'});
const payload=recommendations=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({recommendations})}]}]});

test('campaign evidence retains only measured Meta metrics',()=>{
  assert.equal(evidence.spend,25.5);
  assert.equal(evidence.actions[0].value,3);
  assert.throws(()=>adEvidence([], 'USD', evidence.range),{code:'ADS_REPORT_UNAVAILABLE'});
  assert.throws(()=>adEvidence([{campaign_id:'123',spend:'NaN',impressions:'2'}], 'USD', evidence.range),{code:'ADS_REPORT_UNAVAILABLE'});
});

test('advice rejects unsupported actions and metric references',()=>{
  assert.throws(()=>parseAdAdvice(payload([{action:'increase_budget',reason:'Raise spend',evidence:['spend']}]),evidence),{code:'ADS_ADVICE_INVALID'});
  assert.throws(()=>parseAdAdvice(payload([{action:'monitor',reason:'Wait',evidence:['purchases']}]),evidence),{code:'ADS_ADVICE_INVALID'});
  assert.deepEqual(parseAdAdvice(payload([{action:'monitor',reason:'Observe more delivery.',evidence:['impressions']}]),evidence).recommendations[0].evidence,['impressions']);
});

test('optimization sends only report evidence and cannot mutate ads',async()=>{
  const result=await createAdAdvice({evidence,model:'test-model',key:'test-key',fetcher:async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);
    assert.equal(body.store,false);
    assert.equal(JSON.parse(body.input).campaignId,'123');
    assert.equal(body.text.format.strict,true);
    return {ok:true,json:async()=>payload([{action:'creative_test',reason:'Test another creative after more delivery.',evidence:['impressions','clicks']}])};
  }});
  assert.equal(result.recommendations[0].action,'creative_test');
});
