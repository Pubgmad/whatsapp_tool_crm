import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFlowDesign} from '../lib/flow-design.js';
import {entryPointInput} from '../lib/whatsapp-entry-points.js';
import {journeyRange} from '../lib/whatsapp-journey-analytics.js';
import {publicWebhookAddress,integrationWebhookUrl} from '../lib/workspace-integrations.js';
import {commerceRuleInput} from '../lib/commerce-automation.js';
import {whatsappAdTargeting,whatsappAdPayload} from '../lib/whatsapp-ads.js';
import {advancedTemplateComponents} from '../lib/advanced-template-components.js';
import {validateTemplateParameters,templateSendComponents} from '../lib/template-send-components.js';

test('Flow designs preserve owner values and reject ambiguous fields and choice IDs',()=>{
  const design={version:'7.3',title:'Customer supplied title',submitLabel:'Send request',fields:[{name:'email',label:'Work email',required:true,type:'email'},{name:'service',label:'Service',required:false,type:'dropdown',options:[{id:'consult',title:'Consultation'}]}]};
  const result=compileFlowDesign(design),fields=result.screens[0].layout.children[0].children;
  assert.equal(fields[0]['input-type'],'email');assert.equal(fields.at(-1)['on-click-action'].payload.email,'${form.email}');
  assert.throws(()=>compileFlowDesign({...design,fields:[design.fields[0],design.fields[0]]}));
  assert.throws(()=>compileFlowDesign({...design,fields:[{...design.fields[1],options:[{id:'same',title:'One'},{id:'same',title:'Two'}]}]}));
  assert.throws(()=>compileFlowDesign({...design,version:''}));
});
test('entry points require bounded explicit messages and operation references',()=>{
  const input={action:'create',message:'Owner supplied message',requestId:'reference_owner_123'};
  assert.equal(entryPointInput(input).prefilled_message,input.message);
  assert.throws(()=>entryPointInput({...input,message:''}));assert.throws(()=>entryPointInput({...input,message:'x'.repeat(513)}));
  assert.throws(()=>entryPointInput({...input,action:'update',code:'../wrong'}));
});
test('report date validation rejects rollover dates and excessive ranges',()=>{
  assert.equal(journeyRange(new URLSearchParams({since:'2026-01-01',until:'2026-02-01'})).since,'2026-01-01');
  for(const range of [{since:'2026-02-30',until:'2026-03-10'},{since:'2026-03-10',until:'2026-02-01'},{since:'2024-01-01',until:'2026-01-01'}])assert.throws(()=>journeyRange(new URLSearchParams(range)));
});
test('webhook destinations reject local, reserved, metadata, IPv6 and unapproved hosts',()=>{
  for(const value of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicWebhookAddress(value),false);
  assert.equal(publicWebhookAddress('8.8.8.8'),true);
  const before=process.env.WORKSPACE_WEBHOOK_ALLOWED_HOSTS;process.env.WORKSPACE_WEBHOOK_ALLOWED_HOSTS='hooks.example.com';
  try{
    assert.equal(integrationWebhookUrl('https://hooks.example.com/events').hostname,'hooks.example.com');
    for(const value of ['http://hooks.example.com/events','https://hooks.example.com.evil.test/events','https://user:password@hooks.example.com/events','https://hooks.example.com:8443/events','https://127.0.0.1/events'])assert.throws(()=>integrationWebhookUrl(value));
  }finally{if(before===undefined)delete process.env.WORKSPACE_WEBHOOK_ALLOWED_HOSTS;else process.env.WORKSPACE_WEBHOOK_ALLOWED_HOSTS=before;}
});
test('commerce reminders require a delayed order event and explicit owner settings',()=>{
  const rule={name:'Owner reminder',eventType:'whatsapp_order_received',flowId:'owned_flow',delayMinutes:60,unpaidOnly:true};
  assert.equal(commerceRuleInput(rule).delay,60);
  assert.throws(()=>commerceRuleInput({...rule,delayMinutes:0}));assert.throws(()=>commerceRuleInput({...rule,eventType:'whatsapp_payment_captured'}));
  assert.throws(()=>commerceRuleInput({...rule,unpaidOnly:'true'}));
});
test('audience editing does not require creative or budget replacement',()=>{
  const result=whatsappAdTargeting({countries:['IN','IN'],ageMin:21,ageMax:60,customAudiences:['123','123']});
  assert.deepEqual(result.geo_locations.countries,['IN']);assert.equal(result.custom_audiences.length,1);
  assert.throws(()=>whatsappAdTargeting({countries:['IN'],ageMin:17,ageMax:60}));
  const ad=whatsappAdPayload({name:'Video',text:'Message',headline:'Headline',dailyBudget:'10',countries:['IN'],ageMin:18,ageMax:65,mediaType:'video',videoId:'123',imageHash:'a'.repeat(32)},{currency:'INR',page_id:'456'},'919999999999');
  assert.equal(ad.creative.object_story_spec.video_data.video_id,'123');assert.equal(ad.campaign.status,'PAUSED');
});
test('coupon and limited-time offer creation and sends preserve required components',()=>{
  const schema={kind:'LIMITED_TIME_OFFER',couponExample:'OWNER15',offerText:'Ends soon',hasExpiration:true,bodyExamples:['Buyer']};
  const components=advancedTemplateComponents(schema,'Hello {{1}}','MARKETING'),template={component_schema:{components}};
  const input={buttons:[{index:0,type:'copy_code',value:'CUSTOMER15'}],limitedTimeOffer:{expirationTimeMs:Date.now()+86400000}};
  assert.doesNotThrow(()=>validateTemplateParameters(template,input));
  assert.equal(templateSendComponents(['Buyer'],input).find(component=>component.type==='limited_time_offer').parameters[0].limited_time_offer.expiration_time_ms,input.limitedTimeOffer.expirationTimeMs);
  assert.throws(()=>validateTemplateParameters(template,{buttons:input.buttons}));assert.throws(()=>validateTemplateParameters(template,{limitedTimeOffer:input.limitedTimeOffer}));
  assert.throws(()=>validateTemplateParameters({component_schema:{}},input));assert.throws(()=>templateSendComponents([],{limitedTimeOffer:{expirationTimeMs:Date.now()-1}}));
  assert.throws(()=>advancedTemplateComponents({...schema,couponExample:'x'.repeat(16)},'Message','MARKETING'));
});
