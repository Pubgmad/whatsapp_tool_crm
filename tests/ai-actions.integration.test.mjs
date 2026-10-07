import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,query} from '../lib/db.js';
import {reviewAiAction,resolveUnknownAiAction} from '../lib/ai-actions.js';
import {runDueAiAutoReply} from '../lib/ai-auto-replies.js';

test('owner-reviewed AI CRM changes remain tenant scoped and reject stale conversations',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const business='aib_'+suffix,other='aib2_'+suffix,user='aiu_'+suffix,contact='aic_'+suffix,conversation='aiv_'+suffix,message='m_'+suffix,proposal='aia_'+suffix;
  try{
    await query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[user,'Owner',`${suffix}@example.test`,'unused']);
    for(const tenant of [business,other])await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1)',[tenant]);
    await query('INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$3,$4)',[contact,business,'Customer','15551234567']);
    await query('INSERT INTO conversations(id,business_id,contact_id) VALUES($1,$2,$3)',[conversation,business,contact]);
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type) VALUES($1,$2,'incoming','My city is Chennai','received','text')",[message,conversation]);
    await query("INSERT INTO ai_agent_settings(business_id,enabled,action_proposals_enabled,action_attribute_keys) VALUES($1,TRUE,TRUE,ARRAY['preferred_location'])",[business]);
    await query("INSERT INTO ai_action_proposals(id,business_id,conversation_id,inbound_message_id,contact_id,action_type,arguments,reason) VALUES($1,$2,$3,$4,$5,'set_contact_attribute',$6,'Customer requested this')",[proposal,business,conversation,message,contact,JSON.stringify({key:'preferred_location',value:'Chennai'})]);
    await assert.rejects(()=>reviewAiAction({businessId:other,userId:user,proposalId:proposal,decision:'approve'}),{code:'AI_ACTION_NOT_PENDING'});
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1',[contact])).rows[0].custom_attributes?.preferred_location,undefined);
    assert.deepEqual(await reviewAiAction({businessId:business,userId:user,proposalId:proposal,decision:'approve'}),{status:'completed'});
    assert.equal((await query('SELECT custom_attributes FROM contacts WHERE id=$1',[contact])).rows[0].custom_attributes.preferred_location,'Chennai');
    await assert.rejects(()=>reviewAiAction({businessId:business,userId:user,proposalId:proposal,decision:'approve'}),{code:'AI_ACTION_NOT_PENDING'});
    const nextMessage='m2_'+suffix,nextProposal='aia_'+crypto.randomBytes(8).toString('hex');
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type,at) VALUES($1,$2,'incoming','Actually, I changed my mind','received','text',NOW()+INTERVAL '1 second')",[nextMessage,conversation]);
    await query("INSERT INTO ai_action_proposals(id,business_id,conversation_id,inbound_message_id,contact_id,action_type,arguments,reason) VALUES($1,$2,$3,$4,$5,'set_contact_attribute',$6,'Customer requested this')",[nextProposal,business,conversation,nextMessage,contact,JSON.stringify({key:'preferred_location',value:'Mumbai'})]);
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type,at) VALUES($1,$2,'incoming','No change','received','text',NOW()+INTERVAL '2 seconds')",['m3_'+suffix,conversation]);
    await assert.rejects(()=>reviewAiAction({businessId:business,userId:user,proposalId:nextProposal,decision:'approve'}),{code:'AI_ACTION_STALE'});
    const uncertain='aia_'+crypto.randomBytes(8).toString('hex');
    await query("INSERT INTO ai_action_proposals(id,business_id,conversation_id,inbound_message_id,contact_id,action_type,arguments,reason,status) VALUES($1,$2,$3,$4,$5,'send_booking_flow',$6,'Customer requested booking','unknown')",[uncertain,business,conversation,'m3_'+suffix,contact,JSON.stringify({flowId:'nf_unknown'})]);
    await assert.rejects(()=>resolveUnknownAiAction({businessId:other,userId:user,proposalId:uncertain,resolution:'not_sent'}),{code:'NOT_FOUND'});
    await resolveUnknownAiAction({businessId:business,userId:user,proposalId:uncertain,resolution:'not_sent'});
    assert.equal((await query('SELECT status FROM ai_action_proposals WHERE id=$1',[uncertain])).rows[0].status,'failed');
  }finally{
    enterSystemContext();
    for(const tenant of [business,other])await query('DELETE FROM businesses WHERE id=$1',[tenant]);
    await query('DELETE FROM users WHERE id=$1',[user]);
  }
});

test('a proposed action suppresses the automatic WhatsApp reply',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='aib_'+suffix,contact='aic_'+suffix,conversation='aiv_'+suffix,message='m_'+suffix;
  const priorKey=process.env.OPENAI_API_KEY,priorModel=process.env.OPENAI_MODEL,priorFetch=global.fetch;
  const priorLimit=(await query("SELECT value FROM platform_settings WHERE key='ai_daily_request_limit'")).rows[0]?.value;
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1)',[business]);
    await query('INSERT INTO contacts(id,business_id,name,phone,last_message_at) VALUES($1,$2,$3,$4,NOW())',[contact,business,'Customer','15551234567']);
    await query('INSERT INTO conversations(id,business_id,contact_id) VALUES($1,$2,$3)',[conversation,business,contact]);
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type) VALUES($1,$2,'incoming','Please set my preferred location to Chennai','received','text')",[message,conversation]);
    await query("INSERT INTO ai_agent_settings(business_id,enabled,auto_reply_enabled,auto_reply_daily_limit,action_proposals_enabled,action_attribute_keys) VALUES($1,TRUE,TRUE,10,TRUE,ARRAY['preferred_location'])",[business]);
    await query("INSERT INTO ai_auto_reply_jobs(inbound_message_id,business_id,conversation_id,run_at) VALUES($1,$2,$3,NOW()-INTERVAL '1 minute')",[message,business,conversation]);
    await query("UPDATE platform_settings SET value='10'::jsonb WHERE key='ai_daily_request_limit'");
    process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_MODEL='test-model';
    let calls=0;
    global.fetch=async(url,options)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(JSON.parse(options.body).store,false);return Response.json({status:'completed',output:[{type:'function_call',name:'propose_crm_action',arguments:JSON.stringify({decision:'propose',intent:'crm',action_type:'set_contact_attribute',target_id:'',attribute_key:'preferred_location',value:'Chennai',reason:'Customer requested it'})}]});};
    const result=await runDueAiAutoReply();
    assert.equal(result.skipped,1,JSON.stringify(result));
    assert.equal(calls,1);
    assert.equal((await query('SELECT status,last_error FROM ai_auto_reply_jobs WHERE inbound_message_id=$1',[message])).rows[0].last_error,'AI_ACTION_PENDING');
    assert.equal((await query('SELECT status FROM ai_action_proposals WHERE business_id=$1 AND inbound_message_id=$2',[business,message])).rows[0].status,'pending');
    assert.equal((await query("SELECT COUNT(*)::int AS total FROM messages WHERE conversation_id=$1 AND direction='outgoing'",[conversation])).rows[0].total,0);
  }finally{
    enterSystemContext();
    await query('UPDATE platform_settings SET value=$1 WHERE key=$2',[JSON.stringify(priorLimit),'ai_daily_request_limit']);
    await query('DELETE FROM businesses WHERE id=$1',[business]);
    if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;
    if(priorModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=priorModel;
    global.fetch=priorFetch;
  }
});
