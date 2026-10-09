import test from 'node:test';
import assert from 'node:assert/strict';
import { audienceCampaignIds, normalizeAudienceRules, audienceContactQuery } from '../lib/audience-rules.js';

test('existing segment rules remain consent-aware and normalize legacy lists',()=>{
  const result=normalizeAudienceRules({tags:'VIP, vip',sources:'website',lastActiveDays:'30'});
  assert.equal(result.version,2);assert.equal(result.root.type,'group');
  assert.deepEqual(result.root.children.find(rule=>rule.type==='permission'),{type:'permission',value:'marketable'});
  assert.deepEqual(result.root.children.find(rule=>rule.type==='tags').values,['vip']);
  const query=audienceContactQuery('tenant',{tags:'vip',tagMode:'all'});
  assert.match(query.text,/ct.business_id = \$1/);assert.match(query.text,/unsubscribed = FALSE/);assert.match(query.text,/\?&/);
});
test('versioned nested groups preserve precedence and collect campaign ownership checks',()=>{
  const rules={version:2,root:{type:'group',operator:'and',children:[
    {type:'permission',value:'marketable'},
    {type:'group',operator:'or',children:[
      {type:'attribute',key:'stage',operator:'equals',value:"lead' OR TRUE --"},
      {type:'engagement',campaignId:'camp_1',event:'read',match:'matched',withinDays:14}
    ]}
  ]}};
  const statement=audienceContactQuery('tenant',rules);
  assert.match(statement.text,/\(ct\.marketing_permission = TRUE.* AND \(.* OR .*\)\)/s);
  assert.equal(statement.text.includes("lead' OR TRUE --"),false);
  assert.ok(statement.params.includes("lead' OR TRUE --"));
  assert.deepEqual(audienceCampaignIds(rules),['camp_1']);
});
test('tree depth, fanout, node count and unknown versions fail closed',()=>{
  const leaf={type:'permission',value:'marketable'};
  const tooDeep={version:2,root:{type:'group',operator:'and',children:[{type:'group',operator:'and',children:[{type:'group',operator:'and',children:[{type:'group',operator:'and',children:[{type:'group',operator:'and',children:[leaf]}]}]}]}]}};
  const tooWide={version:2,root:{type:'group',operator:'and',children:Array(51).fill(leaf)}};
  for(const value of [{version:99,root:{type:'group',operator:'and',children:[]}},tooDeep,tooWide]) {
    assert.throws(()=>normalizeAudienceRules(value),{code:'SEGMENT_RULES_INVALID'});
  }
});
test('engagement supports AND/OR, verified incoming replies and recipient-bound exclusions',()=>{
  const statement=audienceContactQuery('tenant',{engagementMode:'any',engagement:[{campaignId:'campaign_a',event:'delivered',match:'matched'},{campaignId:'campaign_b',event:'replied',match:'not_matched',withinDays:7}]});
  assert.ok(statement.params.some(value=>Array.isArray(value)&&value.join(',')==='delivered,read'));
  assert.match(statement.text,/ OR /);assert.match(statement.text,/cr.contact_id=ct.id/);assert.match(statement.text,/k.business_id=ct.business_id/);
  assert.match(statement.text,/m.direction='incoming'/);assert.match(statement.text,/cv.contact_id=ct.id/);assert.match(statement.text,/m.campaign_recipient_id=cr.id/);assert.match(statement.text,/NOT COALESCE/);
});
test('purchase filters and custom-field values are parameters, never executable SQL',()=>{
  const value="x' OR TRUE --";
  const statement=audienceContactQuery('tenant',{purchase:'not_purchased',purchaseWithinDays:30,attributes:[{key:'interest',operator:'contains',value}]},{count:true});
  assert.match(statement.text,/COUNT\(\*\)::int/);assert.match(statement.text,/NOT EXISTS/);assert.match(statement.text,/o.business_id=ct.business_id/);assert.match(statement.text,/payment_status IN \('captured','partially_refunded'\)/);
  assert.ok(statement.params.includes(value));assert.equal(statement.text.includes(value),false);assert.equal(statement.text.includes('ORDER BY'),false);
});
test('clicked engagement includes tracked links and template button replies', () => {
  const statement = audienceContactQuery('tenant', {
    engagement: [{ campaignId: 'camp_1', event: 'clicked', match: 'matched' }]
  });
  assert.match(statement.text, /tracked_link_tokens/);
  assert.match(statement.text, /message_type IN \('button','interactive'\)/);
});

test('malformed rules fail closed rather than becoming broader audiences',()=>{
  for(const value of [{permission:'anything'},{purchase:'estimated'},{lastActiveDays:-1},{engagementMode:'xor'},{engagement:[{campaignId:'x',event:'click',match:'matched'}]},{attributes:[{key:'x',operator:'sql',value:'anything'}]},{engagement:Array(11).fill({campaignId:'x',event:'read',match:'matched'})}])assert.throws(()=>normalizeAudienceRules(value),{code:'SEGMENT_RULES_INVALID'});
});
