import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateCallingPolicy,callingAccess} from '../lib/whatsapp-calling.js';
import {flowCreationButton,flowSendParameter} from '../lib/flow-template-components.js';
import {validateTemplateParameters} from '../lib/template-send-components.js';
import {validateRuntimeConfig,validateRuntimePayload,provisionRuntimeInvite,isManagedRuntimeEndpoint,selectReviewScreen} from '../lib/flow-runtime.js';
import {editedWhatsAppCreative} from '../lib/whatsapp-ads.js';
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
test('conditional native Flow routes use published edges and ordered quantity thresholds',()=>{
 const config={enabled:true,mode:'order',resourceIds:['product_a','product_b'],initialScreen:'CHOOSE',reviewScreen:'REVIEW',allowedActions:['list','reserve','confirm'],holdMinutes:10,
  reviewRoutes:[{resourceId:'product_a',minQuantity:2,targetScreen:'BULK'},{resourceId:'product_a',minQuantity:5,targetScreen:'WHOLESALE'}]};
 const flow={data_api_version:'3.0',routing_model:{CHOOSE:['REVIEW','BULK','WHOLESALE'],BULK:['CHOOSE'],WHOLESALE:['CHOOSE']},screens:[{id:'CHOOSE'},{id:'REVIEW'},{id:'BULK'},{id:'WHOLESALE'}]};
 assert.equal(validateRuntimeConfig(config,flow).reviewRoutes.length,2);
 assert.equal(selectReviewScreen(config,'product_a',1),'REVIEW');
 assert.equal(selectReviewScreen(config,'product_a',3),'BULK');
 assert.equal(selectReviewScreen(config,'product_a',5),'WHOLESALE');
 assert.equal(selectReviewScreen(config,'product_b',7),'REVIEW');
 assert.throws(()=>validateRuntimeConfig({...config,reviewRoutes:[config.reviewRoutes[0],config.reviewRoutes[0]]},flow),{code:'FLOW_RUNTIME_INVALID'});
 assert.throws(()=>validateRuntimeConfig(config,{...flow,routing_model:{CHOOSE:['REVIEW']}}),{code:'FLOW_RUNTIME_INVALID'});
});
test('a managed Flow invitation provisions its matching runtime token in the same transaction',async()=>{
 const previous=process.env.APP_URL;
 process.env.APP_URL='https://crm.example.test';
 const token='a'.repeat(64),writes=[];
 const config={enabled:true,mode:'booking',resourceIds:['slot_1'],initialScreen:'CHOOSE',reviewScreen:'REVIEW',allowedActions:['list'],holdMinutes:10};
 const client={query:async(sql,args)=>{
   if(sql.includes('FROM flow_runtime_configs c'))return {rows:[{config,revision:3,endpoint_phone_id:'phone_1'}]};
   if(sql.includes('FROM flow_runtime_configs WHERE'))return {rows:[{config}]};
   if(sql.includes('INSERT INTO flow_runtime_sessions')){writes.push(args);return {rowCount:1};}
   throw new Error('Unexpected SQL: '+sql);
 }};
 const flow={id:'flow_1',endpoint_uri:'https://crm.example.test/api/whatsapp/flows/runtime/data/flow_1'};
 assert.equal(isManagedRuntimeEndpoint(flow),true);
 assert.equal(isManagedRuntimeEndpoint({...flow,endpoint_uri:flow.endpoint_uri+'-other'}),false);
 assert.equal(isManagedRuntimeEndpoint({...flow,endpoint_uri:'https://elsewhere.test/api/whatsapp/flows/runtime/data/flow_1'}),false);
 try{
   const result=await provisionRuntimeInvite(client,{businessId:'business_1',flow,contactId:'contact_1',phoneId:'phone_1',flowToken:token,expiresHours:2});
   assert.equal(result.flowToken,token);
   assert.equal(writes[0][5],crypto.createHash('sha256').update(token).digest('hex'));
   assert.equal(writes[0][8],120);
   await assert.rejects(provisionRuntimeInvite(client,{businessId:'business_1',flow,contactId:'contact_1',phoneId:'phone_1',flowToken:token,expiresHours:25}),{code:'FLOW_RUNTIME_INVALID'});
   assert.equal(writes.length,1);
 }finally{if(previous===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous;}
});
test('creative replacements keep only the verified WhatsApp destination and selected account assets',()=>{
 const body={mediaType:'image',text:'Book a call',headline:'Talk with us',imageHash:'a'.repeat(32),name:'New creative'};
 const result=editedWhatsAppCreative(body,{page_id:'123'},'15551234567');
 assert.equal(result.object_story_spec.page_id,'123');
 assert.equal(result.object_story_spec.link_data.call_to_action.value.whatsapp_number,'15551234567');
 assert.equal(result.object_story_spec.link_data.image_hash,'a'.repeat(32));
 assert.throws(()=>editedWhatsAppCreative({...body,imageHash:'https://evil.test'}, {page_id:'123'},'15551234567'),{code:'ADS_PAYLOAD_INVALID'});
 assert.equal(editedWhatsAppCreative({...body,mediaType:'video',videoId:'321'},{page_id:'123'},'15551234567').object_story_spec.video_data.video_id,'321');
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
 const checkout=normalizeProviderEvent('shopify','checkouts/update',{token:'checkout_123',updated_at:'2026-09-29T00:00:00Z',total_price:'5.00',currency:'USD'});
 const order=normalizeProviderEvent('shopify','orders/create',{id:124,checkout_id:987,checkout_token:'checkout_123',updated_at:'2026-09-29T00:01:00Z',total_price:'5.00',currency:'USD'});
 assert.equal(checkout.externalId,order.checkoutId);
 assert.equal(order.externalId,'124');
 assert.equal(checkout.terminal,false);
 const linked=normalizeProviderEvent('shopify','checkouts/update',{token:'checkout_124',updated_at:'2026-09-29T00:00:00Z',total_price:'5.00',currency:'USD',abandoned_checkout_url:'https://shop.example/checkouts/abc/recover?key=signed'});
 assert.equal(linked.checkoutUrl,'https://shop.example/checkouts/abc/recover?key=signed');
 assert.equal(normalizeProviderEvent('shopify','checkouts/update',{token:'checkout_125',updated_at:'2026-09-29T00:00:00Z',total_price:'5.00',currency:'USD',abandoned_checkout_url:'http://localhost/recover'}).checkoutUrl,'');
});
test('advanced chatbot branches use data only and route failed effects to explicit error nodes',async()=>{
 const condition=normalizeAdvancedNode({type:'attribute_condition',next:'yes',falseNext:'no',errorNext:'error',attribute:'tier',operator:'equals',compareValue:'gold'});
 assert.equal(condition.falseNext,'no');
 const result=await executeAdvancedNode({node:{type:'attribute_condition',...condition},context:{},effects:{guard:async()=>{},attributes:async()=>({tier:'basic'})}});
 assert.equal(result.next,'no');
 assert.throws(()=>normalizeAdvancedNode({type:'api_request',next:'done',errorNext:'failed',connectionId:'secure',url:'https://attacker.test'}));
});
