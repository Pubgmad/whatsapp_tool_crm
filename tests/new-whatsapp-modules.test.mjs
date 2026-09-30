import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateCallingPolicy,callingAccess} from '../lib/whatsapp-calling.js';
import {flowCreationButton,flowSendParameter} from '../lib/flow-template-components.js';
import {validateTemplateParameters} from '../lib/template-send-components.js';
import {validateRuntimeConfig,validateRuntimePayload} from '../lib/flow-runtime.js';
import {connectorSource,verifyProviderSignature,normalizeProviderEvent} from '../lib/provider-connectors.js';
import {normalizeAdvancedNode,executeAdvancedNode} from '../lib/automation-node-runtime.js';

test('agent calls require explicit owner delegation and keep global history manager-only',()=>{
 const agent={role:'Agent',userId:'agent'};
 assert.equal(callingAccess(agent,{allowTenantConfiguration:true}).canCall,false);
 assert.equal(callingAccess(agent,{roles:['Owner','Manager','Agent']},{roles:['Agent'],agentIds:['agent']}).canCall,true);
 assert.equal(callingAccess(agent,{roles:['Owner','Manager']},{roles:['Agent'],agentIds:['agent']}).canCall,false);
 assert.equal(callingAccess(agent,{}, {roles:['Agent'],agentIds:['other']}).canCall,false);
 assert.equal(callingAccess(agent,{}, {roles:['Agent'],agentIds:['agent']}).canViewGlobalHistory,false);
 assert.throws(()=>validateCallingPolicy({roles:['Agent','Agent'],agentIds:null}));
});
test('approved Flow template buttons require a unique server-generated token',()=>{
 assert.deepEqual(flowCreationButton({flowMetaId:'123456789',flowButtonText:'Book',flowAction:'navigate',flowScreen:'FORM'}),{type:'FLOW',text:'Book',flow_id:'123456789',flow_action:'navigate',navigate_screen:'FORM'});
 assert.deepEqual(flowSendParameter({type:'flow',index:0,flowToken:'a'.repeat(64)}),{type:'action',action:{flow_token:'a'.repeat(64)}});
 assert.throws(()=>flowSendParameter({type:'flow',index:0,flowToken:'visitor-chosen'}));
 const template={component_schema:{buttons:[{type:'FLOW',flow_id:'123456789'}]}};
 const parameters={buttons:[{type:'flow',index:0,flowToken:'a'.repeat(64)}]};
 assert.throws(()=>validateTemplateParameters(template,parameters),{code:'TEMPLATE_FLOW_INVITE_REQUIRED'});
 assert.equal(validateTemplateParameters(template,parameters,{allowFlow:true}),parameters);
});
test('transactional Flow runtime validates explicit assets and bearer-bound actions',()=>{
 const config={enabled:true,mode:'booking',resourceIds:['slot_1'],initialScreen:'CHOOSE',reviewScreen:'REVIEW',allowedActions:['list','reserve','confirm','cancel'],holdMinutes:10};
 assert.equal(validateRuntimeConfig(config,{data_api_version:'3.0',screens:[{id:'CHOOSE'},{id:'REVIEW'}]}).mode,'booking');
 assert.throws(()=>validateRuntimeConfig({...config,resourceIds:[]}));
 assert.throws(()=>validateRuntimeConfig(config,{data_api_version:'3.0',screens:[{id:'CHOOSE'}]}));
 const payload={version:'3.0',action:'data_exchange',screen:'CHOOSE',flow_token:'a'.repeat(64),data:{operation:'reserve',resource_id:'slot_1',quantity:1,request_id:'reference_123456789'}};
 assert.equal(validateRuntimePayload(payload).data.quantity,1);
 assert.throws(()=>validateRuntimePayload({...payload,flow_token:'fake'}));
 assert.throws(()=>validateRuntimePayload({...payload,data:{...payload.data,quantity:1001}}));
});
test('provider connectors verify exact signed payloads and do not infer consent from orders',()=>{
 const raw=Buffer.from(JSON.stringify({id:123,updated_at:'2026-09-29T00:00:00Z',total_price:'5.00',currency:'USD',phone:'+15550001111'}));
 const secret='long-webhook-signing-secret';
 const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
 assert.equal(verifyProviderSignature(raw,signature,secret),true);
 assert.equal(verifyProviderSignature(Buffer.concat([raw,Buffer.from(' ')]),signature,secret),false);
 assert.equal(connectorSource('shopify','shop.myshopify.com'),'shop.myshopify.com');
 assert.throws(()=>connectorSource('woocommerce','http://localhost'));
 assert.equal(normalizeProviderEvent('shopify','orders/create',JSON.parse(raw.toString())).phone,'15550001111');
});
test('advanced chatbot branches use data only and route failed effects to explicit error nodes',async()=>{
 const condition=normalizeAdvancedNode({type:'attribute_condition',next:'yes',falseNext:'no',errorNext:'error',attribute:'tier',operator:'equals',compareValue:'gold'});
 assert.equal(condition.falseNext,'no');
 const result=await executeAdvancedNode({node:{type:'attribute_condition',...condition},context:{},effects:{guard:async()=>{},attributes:async()=>({tier:'basic'})}});
 assert.equal(result.next,'no');
 assert.throws(()=>normalizeAdvancedNode({type:'api_request',next:'done',errorNext:'failed',connectionId:'secure',url:'https://attacker.test'}));
});
