import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,query,transaction} from '../lib/db.js';
import {cancelPendingAiReply,enqueueAiAutoReply,runDueAiAutoReply} from '../lib/ai-auto-replies.js';
import {encryptSecret} from '../lib/meta.js';

test('AI replies queue only after opt-in, deduplicate inbound events and yield to humans',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='aib_'+suffix,contact='aic_'+suffix,conversation='aiv_'+suffix,message='aim_'+suffix;
  const previousKey=process.env.OPENAI_API_KEY,previousModel=process.env.OPENAI_MODEL,previousFetch=global.fetch;
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1)',[business]);
    await query('INSERT INTO contacts(id,business_id,name,phone,last_message_at) VALUES($1,$2,$3,$4,NOW())',[contact,business,'Customer','15551234567']);
    await query('INSERT INTO conversations(id,business_id,contact_id) VALUES($1,$2,$3)',[conversation,business,contact]);
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type) VALUES($1,$2,'incoming','Return policy','received','text')",[message,conversation]);
    await query('INSERT INTO ai_agent_settings(business_id,enabled,auto_reply_enabled,auto_reply_daily_limit) VALUES($1,TRUE,FALSE,5)',[business]);
    assert.equal(await transaction(client=>enqueueAiAutoReply(client,{businessId:business,conversationId:conversation,messageId:message,type:'text',text:'Return policy'})),false);
    await query('UPDATE ai_agent_settings SET auto_reply_enabled=TRUE WHERE business_id=$1',[business]);
    assert.equal(await transaction(client=>enqueueAiAutoReply(client,{businessId:business,conversationId:conversation,messageId:message,type:'text',text:'Return policy'})),true);
    assert.equal(await transaction(client=>enqueueAiAutoReply(client,{businessId:business,conversationId:conversation,messageId:message,type:'text',text:'Return policy'})),true);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM ai_auto_reply_jobs WHERE business_id=$1',[business])).rows[0].count,1);
    await cancelPendingAiReply(business,conversation);
    assert.equal((await query('SELECT status,last_error FROM ai_auto_reply_jobs WHERE inbound_message_id=$1',[message])).rows[0].last_error,'HUMAN_REPLIED');
    assert.equal((await query('SELECT status FROM ai_auto_reply_jobs WHERE inbound_message_id=$1',[message])).rows[0].status,'skipped');
    await query("UPDATE ai_auto_reply_jobs SET status='sending' WHERE inbound_message_id=$1",[message]);
    await assert.rejects(()=>cancelPendingAiReply(business,conversation),{code:'AI_REPLY_IN_FLIGHT'});
    await query("UPDATE ai_auto_reply_jobs SET status='queued',run_at=NOW()-INTERVAL '1 minute' WHERE inbound_message_id=$1",[message]);
    process.env.OPENAI_API_KEY='test-key';process.env.OPENAI_MODEL='test-model';
    const outcome=await runDueAiAutoReply();
    assert.equal(outcome.attempted,1);
    assert.equal(outcome.skipped,1);
    assert.equal((await query('SELECT status,last_error FROM ai_auto_reply_jobs WHERE inbound_message_id=$1',[message])).rows[0].last_error,'AI_NO_SOURCE');
    await query('UPDATE businesses SET review_access=TRUE,waba_id=$1,phone_number_id=$2,access_token_encrypted=$3 WHERE id=$4',['123456','654321',encryptSecret('meta-test-token'),business]);
    const knowledge='aik_'+suffix;
    await query('INSERT INTO ai_agent_knowledge(id,business_id,title,content) VALUES($1,$2,$3,$4)',[knowledge,business,'Return policy','Return policy allows seven days.']);
    await query("UPDATE ai_auto_reply_jobs SET status='queued',run_at=NOW()-INTERVAL '1 minute',last_error=NULL WHERE inbound_message_id=$1",[message]);
    let aiCalls=0,metaCalls=0;
    global.fetch=async(url,options)=>{
      if(String(url)==='https://api.openai.com/v1/responses'){
        aiCalls++;
        const body=JSON.parse(options.body);
        assert.equal(body.store,false);
        assert.match(body.instructions,/sent automatically/);
        return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:'answer',answer:'Our return policy allows seven days.',source_ids:[knowledge]})}]}]});
      }
      if(String(url).includes('graph.facebook.com')&&String(url).endsWith('/654321/messages')){
        metaCalls++;
        assert.equal(JSON.parse(options.body).text.body,'Our return policy allows seven days.');
        return Response.json({messages:[{id:'wamid.test_'+suffix}]});
      }
      throw new Error('Unexpected network request');
    };
    const sent=await runDueAiAutoReply();
    assert.equal(sent.sent,1,JSON.stringify(sent));
    assert.equal(aiCalls,1);
    assert.equal(metaCalls,1);
    assert.equal((await query("SELECT status,meta_message_id FROM ai_auto_reply_jobs WHERE inbound_message_id=$1",[message])).rows[0].status,'sent');
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id=$1 AND direction='outgoing'",[conversation])).rows[0].count,1);
    assert.equal((await runDueAiAutoReply()).attempted,0);
    const followup='aim2_'+suffix;
    await query("INSERT INTO messages(id,conversation_id,direction,body,status,message_type,at) VALUES($1,$2,'incoming','Return policy','received','text',NOW()+INTERVAL '1 second')",[followup,conversation]);
    await transaction(client=>enqueueAiAutoReply(client,{businessId:business,conversationId:conversation,messageId:followup,type:'text',text:'Return policy'}));
    await query("UPDATE ai_auto_reply_jobs SET run_at=NOW()-INTERVAL '1 minute' WHERE inbound_message_id=$1",[followup]);
    global.fetch=async(url,options)=>{
      if(String(url)==='https://api.openai.com/v1/responses')return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({decision:'answer',answer:'Our return policy allows seven days.',source_ids:[knowledge]})}]}]});
      if(String(url).includes('graph.facebook.com'))throw new Error('Lost Meta response');
      throw new Error('Unexpected network request');
    };
    const uncertain=await runDueAiAutoReply();
    assert.equal(uncertain.unknown,1,JSON.stringify(uncertain));
    assert.equal((await query('SELECT status FROM ai_auto_reply_jobs WHERE inbound_message_id=$1',[followup])).rows[0].status,'unknown');
    await assert.rejects(()=>cancelPendingAiReply(business,conversation),{code:'AI_REPLY_UNCONFIRMED'});
    await query("UPDATE ai_auto_reply_jobs SET resolved_at=NOW(),resolution='not_sent' WHERE inbound_message_id=$1 AND business_id=$2",[followup,business]);
    await cancelPendingAiReply(business,conversation);
    assert.equal((await runDueAiAutoReply()).attempted,0);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id=$1 AND direction='outgoing'",[conversation])).rows[0].count,1);
  }finally{
    enterSystemContext();await query('DELETE FROM businesses WHERE id=$1',[business]);
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
    if(previousModel===undefined)delete process.env.OPENAI_MODEL;else process.env.OPENAI_MODEL=previousModel;
    global.fetch=previousFetch;
  }
});
