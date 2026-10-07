import test from 'node:test';
import assert from 'node:assert/strict';
import {parseActionProposal,classifyAiAction} from '../lib/ai-actions.js';

const response=value=>({status:'completed',output:[{type:'function_call',name:'propose_crm_action',arguments:JSON.stringify(value)}]});
const context={attributeKeys:['preferred_location'],orderIds:['wo_123'],bookingFlowId:'nf_123'};
const candidate=(overrides={})=>({decision:'propose',intent:'crm',action_type:'set_contact_attribute',target_id:'',attribute_key:'preferred_location',value:'Chennai',reason:'Customer requested this location.',...overrides});

test('AI action proposals are limited to configured tenant resources',()=>{
  assert.deepEqual(parseActionProposal(response(candidate()),context),{type:'set_contact_attribute',args:{key:'preferred_location',value:'Chennai'},reason:'Customer requested this location.'});
  assert.throws(()=>parseActionProposal(response(candidate({attribute_key:'payment_status'})),context),{code:'AI_ACTION_INVALID'});
  assert.throws(()=>parseActionProposal(response(candidate({action_type:'set_order_status',intent:'order',target_id:'wo_other',attribute_key:'',value:'shipped'})),context),{code:'AI_ACTION_INVALID'});
  assert.deepEqual(parseActionProposal(response(candidate({action_type:'send_booking_flow',intent:'booking',target_id:'nf_123',attribute_key:'',value:''})),context),{type:'send_booking_flow',args:{flowId:'nf_123'},reason:'Customer requested this location.'});
  assert.throws(()=>parseActionProposal(response(candidate({action_type:'send_booking_flow',intent:'booking',target_id:'nf_other',attribute_key:'',value:''})),context),{code:'AI_ACTION_INVALID'});
  assert.equal(parseActionProposal(response(candidate({decision:'none'})),context),null);
  assert.throws(()=>parseActionProposal({status:'incomplete',output:[]},context),{code:'AI_ACTION_INCOMPLETE'});
});

test('model can propose but cannot execute an action',async()=>{
  let outbound;
  const result=await classifyAiAction({model:'configured-model',key:'test-key',messages:[{role:'customer',text:'Please set my preferred location to Chennai'}],...context,fetcher:async(_url,options)=>{outbound=JSON.parse(options.body);return {ok:true,json:async()=>response(candidate())};}});
  assert.equal(outbound.store,false);
  assert.equal(outbound.parallel_tool_calls,false);
  assert.equal(outbound.tools[0].strict,true);
  assert.deepEqual(result.args,{key:'preferred_location',value:'Chennai'});
});
