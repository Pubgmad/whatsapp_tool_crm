import {AppError,id,query,transaction} from './db.js';
import {okToReply} from './reply-window.js';
import {assertWorkspaceFeature} from './feature-controls.js';
import {assertMessageCapacity} from './limits.js';
import {configured,createSupportSuggestion,reserveAiDailyRequest,verifiedSupportFacts} from './ai-support.js';
import {sendTextMessage} from './meta.js';
import {messagingSetupForContact} from './messaging-setup.js';
import {proposeForInbound} from './ai-actions.js';
import {retrieveKnowledgeSources} from './ai-knowledge-retrieve.js';
import {resolveActiveAgent} from './ai-agents.js';

const code=error=>String(error?.code||'AI_AUTO_REPLY_FAILED').slice(0,80);
const BATCH_LIMIT=Math.min(10,Math.max(1,Number(process.env.AI_AUTO_REPLY_BATCH||5)||5));

export async function enqueueAiAutoReply(client,{businessId,conversationId,messageId,type,text,unsubscribed}){
  if(type!=='text'||unsubscribed||!text?.trim())return false;
  if(/^(stop|unsubscribe|opt out|start|subscribe|yes)$/i.test(text.trim()))return false;
  const enabled=(await client.query('SELECT 1 FROM ai_agent_settings WHERE business_id=$1 AND enabled AND auto_reply_enabled AND auto_reply_daily_limit>0',[businessId])).rowCount>0;
  if(!enabled)return false;
  await client.query(`INSERT INTO ai_auto_reply_jobs(inbound_message_id,business_id,conversation_id,run_at)
    VALUES($1,$2,$3,NOW()+INTERVAL '10 seconds') ON CONFLICT(inbound_message_id) DO NOTHING`,[messageId,businessId,conversationId]);
  return true;
}

export async function cancelPendingAiReply(businessId,conversationId){
  await transaction(async client=>{
    const sending=await client.query("SELECT 1 FROM ai_auto_reply_jobs WHERE business_id=$1 AND conversation_id=$2 AND status='sending' FOR UPDATE",[businessId,conversationId]);
    if(sending.rowCount)throw new AppError('An automatic reply is being sent. Refresh the conversation before sending.',409,'AI_REPLY_IN_FLIGHT');
    const unknown=await client.query("SELECT 1 FROM ai_auto_reply_jobs WHERE business_id=$1 AND conversation_id=$2 AND status='unknown' AND resolved_at IS NULL FOR UPDATE",[businessId,conversationId]);
    if(unknown.rowCount)throw new AppError('Automatic delivery is unconfirmed. Ask the owner to verify it in Meta before sending again.',409,'AI_REPLY_UNCONFIRMED');
    await client.query("UPDATE ai_auto_reply_jobs SET status='skipped',last_error='HUMAN_REPLIED',updated_at=NOW() WHERE business_id=$1 AND conversation_id=$2 AND status IN ('queued','processing')",[businessId,conversationId]);
  });
}

export function canAutoReply({job,conversation,contact,latest,automationActive}){
  return job?.status==='processing'&&conversation?.status==='open'&&!conversation.assigned_user_id&&!conversation.automation_paused
    &&!automationActive&&!contact?.unsubscribed&&okToReply(contact)&&latest?.id===job.inbound_message_id
    &&latest.direction==='incoming'&&latest.message_type==='text'&&Boolean(latest.body?.trim());
}

async function skip(job,error){
  await query("UPDATE ai_auto_reply_jobs SET status='skipped',claimed_at=NULL,last_error=$1,updated_at=NOW() WHERE inbound_message_id=$2 AND business_id=$3 AND status='processing'",[error,job.inbound_message_id,job.business_id]);
  return {attempted:1,sent:0,skipped:1,unknown:0};
}

async function claimNextJob(){
  return transaction(async client=>{
    await client.query("UPDATE ai_auto_reply_jobs SET status='unknown',claimed_at=NULL,last_error='WORKER_INTERRUPTED',updated_at=NOW() WHERE status IN ('processing','sending') AND claimed_at<NOW()-INTERVAL '2 minutes'");
    const selected=(await client.query(`SELECT j.* FROM ai_auto_reply_jobs j
      JOIN ai_agent_settings s ON s.business_id=j.business_id AND s.enabled AND s.auto_reply_enabled
      JOIN businesses b ON b.id=j.business_id AND b.account_status<>'suspended'
      WHERE j.status='queued' AND j.run_at<=NOW() ORDER BY j.run_at,j.inbound_message_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`)).rows[0];
    if(!selected)return null;
    await client.query("UPDATE ai_auto_reply_jobs SET status='processing',claimed_at=NOW(),updated_at=NOW() WHERE inbound_message_id=$1 AND business_id=$2",[selected.inbound_message_id,selected.business_id]);
    return {...selected,status:'processing'};
  });
}

async function processAiAutoReplyJob(job){
  let sending=false;
  try{
    await assertWorkspaceFeature('ai_auto_reply',job.business_id);
    const [settingsResult,conversationResult,contactResult,historyResult,automationResult]=await Promise.all([
      query('SELECT enabled,auto_reply_enabled,auto_reply_daily_limit,allow_crm_context,instructions,action_proposals_enabled,action_autonomous_enabled,action_attribute_keys,booking_flow_id,dialogflow_enabled,dialogflow_agent_id,dialogflow_location,active_agent_id FROM ai_agent_settings WHERE business_id=$1',[job.business_id]),
      query('SELECT * FROM conversations WHERE business_id=$1 AND id=$2',[job.business_id,job.conversation_id]),
      query('SELECT c.* FROM contacts c JOIN conversations v ON v.contact_id=c.id AND v.business_id=c.business_id WHERE v.business_id=$1 AND v.id=$2',[job.business_id,job.conversation_id]),
      query("SELECT id,direction,message_type,body FROM messages WHERE conversation_id=$1 ORDER BY at DESC,id DESC LIMIT 12",[job.conversation_id]),
      query("SELECT 1 FROM automation_sessions s JOIN conversations v ON v.contact_id=s.contact_id AND v.business_id=s.business_id WHERE v.business_id=$1 AND v.id=$2 AND s.status='active' LIMIT 1",[job.business_id,job.conversation_id])
    ]);
    const settings=settingsResult.rows[0],conversation=conversationResult.rows[0],contact=contactResult.rows[0],history=historyResult.rows;
    if(!settings?.enabled||!settings.auto_reply_enabled||!canAutoReply({job,conversation,contact,latest:history[0],automationActive:automationResult.rowCount>0}))return skip(job,'AI_HANDOFF_REQUIRED');

    const dialogflowReady=Boolean(settings.dialogflow_enabled&&settings.dialogflow_agent_id?.trim());
    const openaiReady=configured();
    if(!openaiReady&&!dialogflowReady)return skip(job,'OPENAI_NOT_CONFIGURED');

    try{
      const {enforceInboundAiPolicy}=await import('./ai-policy.js');
      await enforceInboundAiPolicy({businessId:job.business_id,inboundText:history[0]?.body,settings,conversationId:job.conversation_id});
    }catch(error){
      const errCode=code(error);
      if(['AI_POLICY_BLOCKED','AI_POLICY_LIMIT','AI_AUTONOMOUS_DISABLED'].includes(errCode)){
        const {recordAiSafetyEvent}=await import('./ai-safety-events.js');
        const kind=errCode==='AI_POLICY_BLOCKED'?'policy_blocked':errCode==='AI_AUTONOMOUS_DISABLED'?'autonomous_denied':'rate_limited';
        await recordAiSafetyEvent({businessId:job.business_id,conversationId:job.conversation_id,eventKind:kind,detail:errCode});
      }
      return skip(job,errCode);
    }

    const messages=history.reverse().map(item=>({role:item.direction==='incoming'?'customer':'business',text:String(item.body).slice(0,1500)}));
    const agent=await resolveActiveAgent(job.business_id,settings);
    const instructions=(agent?.instructions||settings.instructions||'').trim();

    if(dialogflowReady){
      await assertWorkspaceFeature('dialogflow_bot',job.business_id);
      const {detectDialogflowReply}=await import('./dialogflow-bot.js');
      const reply=await detectDialogflowReply({
        agentId:settings.dialogflow_agent_id,
        location:settings.dialogflow_location||'global',
        sessionId:job.conversation_id,
        text:history[0]?.body||'',
        languageCode:agent?.language_code||'en'
      });
      if(reply){
        await assertMessageCapacity(job.business_id,1,null,contact.id);
        if(openaiReady)await reserveAiDailyRequest(job.business_id);
        sending=true;
        const setup=await messagingSetupForContact(job.business_id,contact.id);
        const meta=await sendTextMessage({setup,to:contact.phone,body:typeof reply==='string'?reply:reply.text});
        await transaction(async client=>{
          await client.query("UPDATE ai_auto_reply_jobs SET status='sent',meta_message_id=$1,claimed_at=NULL,last_error=NULL,updated_at=NOW() WHERE inbound_message_id=$2 AND business_id=$3 AND status='processing'",[meta.metaMessageId,job.inbound_message_id,job.business_id]);
          await client.query("INSERT INTO messages(id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES($1,$2,'outgoing',$3,$4,$5,'text',$6)",[id('m'),job.conversation_id,typeof reply==='string'?reply:reply.text,meta.status,meta.metaMessageId,JSON.stringify({dialogflow:true,inboundMessageId:job.inbound_message_id,suggestions:typeof reply==='object'?reply.suggestions||[]:[]})]);
          await client.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE id=$1 AND business_id=$2',[job.conversation_id,job.business_id]);
          await client.query('INSERT INTO audit_logs(id,business_id,action,metadata) VALUES($1,$2,$3,$4)',[id('a'),job.business_id,'dialogflow_auto_reply_sent',JSON.stringify({conversationId:job.conversation_id,inboundMessageId:job.inbound_message_id})]);
        });
        return {attempted:1,sent:1,skipped:0,unknown:0};
      }
      if(!openaiReady)return skip(job,'DIALOGFLOW_NO_REPLY');
    }

    if(!openaiReady)return skip(job,'OPENAI_NOT_CONFIGURED');

    if(settings.action_proposals_enabled){
      const proposed=await proposeForInbound({businessId:job.business_id,conversationId:job.conversation_id,contactId:contact.id,messageId:job.inbound_message_id,messages,settings});
      if(proposed){
        const autonomous=settings.action_autonomous_enabled&&(await query("SELECT 1 FROM ai_action_proposals WHERE business_id=$1 AND inbound_message_id=$2 AND status IN ('completed','executing')",[job.business_id,job.inbound_message_id])).rowCount;
        if(!autonomous)return skip(job,'AI_ACTION_PENDING');
      }
    }

    const knowledge=await retrieveKnowledgeSources(job.business_id,history.at(-1)?.body||'',{agentId:agent?.id||null,limit:5});
    const facts=settings.allow_crm_context?await verifiedSupportFacts(job.business_id,contact.id):[];
    const sources=[...knowledge,...facts];
    if(!sources.length)return skip(job,'AI_NO_SOURCE');
    await assertMessageCapacity(job.business_id,1,null,contact.id);
    await reserveAiDailyRequest(job.business_id);
    const result=await createSupportSuggestion({model:process.env.OPENAI_MODEL,key:process.env.OPENAI_API_KEY,instructions,knowledge:sources,messages,automatic:true});
    if(result.handoff){
      try{
        const {classifyIntentOnly,routeConversationByIntent}=await import('./ai-intent-routing.js');
        const intent=await classifyIntentOnly({model:process.env.OPENAI_MODEL,key:process.env.OPENAI_API_KEY,messages});
        await routeConversationByIntent({businessId:job.business_id,conversationId:job.conversation_id,intent,reason:'auto_reply_handoff'});
      }catch{}
      return skip(job,'AI_HANDOFF_REQUIRED');
    }
    const approved=await transaction(async client=>{
      const current=(await client.query('SELECT * FROM ai_auto_reply_jobs WHERE inbound_message_id=$1 AND business_id=$2 FOR UPDATE',[job.inbound_message_id,job.business_id])).rows[0];
      const owner=(await client.query('SELECT * FROM ai_agent_settings WHERE business_id=$1 FOR UPDATE',[job.business_id])).rows[0];
      const latest=(await client.query('SELECT id,direction,message_type,body FROM messages WHERE conversation_id=$1 ORDER BY at DESC,id DESC LIMIT 1',[job.conversation_id])).rows[0];
      const conversationRow=(await client.query('SELECT * FROM conversations WHERE id=$1 AND business_id=$2 FOR UPDATE',[job.conversation_id,job.business_id])).rows[0];
      const contactRow=(await client.query('SELECT * FROM contacts WHERE id=$1 AND business_id=$2',[conversationRow?.contact_id,job.business_id])).rows[0];
      const active=(await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status='active' LIMIT 1",[job.business_id,contactRow?.id])).rowCount>0;
      const used=(await client.query("SELECT COUNT(*)::int AS count FROM ai_auto_reply_jobs WHERE business_id=$1 AND created_at>=(NOW() AT TIME ZONE 'UTC')::date AND status IN ('sending','sent','unknown')",[job.business_id])).rows[0].count;
      if(!current||!owner?.enabled||!owner.auto_reply_enabled||used>=owner.auto_reply_daily_limit||!canAutoReply({job:current,conversation:conversationRow,contact:contactRow,latest,automationActive:active}))return false;
      await assertWorkspaceFeature('ai_auto_reply',job.business_id,client.query.bind(client));
      await client.query("UPDATE ai_auto_reply_jobs SET status='sending',source_ids=$1,updated_at=NOW() WHERE inbound_message_id=$2 AND business_id=$3",[result.sourceIds,job.inbound_message_id,job.business_id]);
      return {contactId:contactRow.id,phone:contactRow.phone};
    });
    if(!approved)return skip(job,'AI_HANDOFF_REQUIRED');
    sending=true;
    const setup=await messagingSetupForContact(job.business_id,approved.contactId);
    const meta=await sendTextMessage({setup,to:approved.phone,body:result.suggestion});
    await transaction(async client=>{
      await client.query("UPDATE ai_auto_reply_jobs SET status='sent',meta_message_id=$1,claimed_at=NULL,last_error=NULL,updated_at=NOW() WHERE inbound_message_id=$2 AND business_id=$3 AND status='sending'",[meta.metaMessageId,job.inbound_message_id,job.business_id]);
      await client.query("INSERT INTO messages(id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES($1,$2,'outgoing',$3,$4,$5,'text',$6)",[id('m'),job.conversation_id,result.suggestion,meta.status,meta.metaMessageId,JSON.stringify({aiAutoReply:true,inboundMessageId:job.inbound_message_id,sourceIds:result.sourceIds,agentId:agent?.id||null})]);
      await client.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE id=$1 AND business_id=$2',[job.conversation_id,job.business_id]);
      await client.query('INSERT INTO audit_logs(id,business_id,action,metadata) VALUES($1,$2,$3,$4)',[id('a'),job.business_id,'ai_auto_reply_sent',JSON.stringify({conversationId:job.conversation_id,inboundMessageId:job.inbound_message_id,sourceIds:result.sourceIds})]);
      const {recordAiSafetyEvent}=await import('./ai-safety-events.js');
      await recordAiSafetyEvent({businessId:job.business_id,conversationId:job.conversation_id,eventKind:'eval_sample',source:'auto_reply',detail:'sent',metadata:{sourceCount:(result.sourceIds||[]).length,replyLength:String(result.suggestion||'').length}},client.query.bind(client));
    });
    return {attempted:1,sent:1,skipped:0,unknown:0};
  }catch(error){
    const unknown=sending;
    await query("UPDATE ai_auto_reply_jobs SET status=$1,claimed_at=NULL,last_error=$2,updated_at=NOW() WHERE inbound_message_id=$3 AND business_id=$4 AND status IN ('processing','sending')",[unknown?'unknown':'failed',code(error),job.inbound_message_id,job.business_id]);
    return {attempted:1,sent:0,skipped:0,unknown:unknown?1:0,code:code(error)};
  }
}

export async function runDueAiAutoReply({limit=BATCH_LIMIT}={}){
  const max=Math.min(10,Math.max(1,Number(limit)||BATCH_LIMIT));
  const totals={attempted:0,sent:0,skipped:0,unknown:0,codes:[]};
  for(let i=0;i<max;i+=1){
    const job=await claimNextJob();
    if(!job)break;
    const outcome=await processAiAutoReplyJob(job);
    totals.attempted+=outcome.attempted||0;
    totals.sent+=outcome.sent||0;
    totals.skipped+=outcome.skipped||0;
    totals.unknown+=outcome.unknown||0;
    if(outcome.code)totals.codes.push(outcome.code);
  }
  return totals;
}
