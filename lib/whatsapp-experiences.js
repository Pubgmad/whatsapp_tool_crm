import crypto from 'node:crypto';
import {recordSupportResponse} from './support-policy.js';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {readJsonBodyLimited} from './security.js';
import {assertMessageCapacity,assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {sendNativeFlowMessage} from './meta.js';
import {isManagedRuntimeEndpoint,provisionRuntimeInvite} from './flow-runtime.js';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const reserved=new Set(['__proto__','constructor','prototype','flow_token']);
export function flowFieldNames(flowJson){
  const names=new Set();
  const walk=node=>{if(!node||typeof node!=='object')return;if(['TextInput','TextArea','DatePicker','Dropdown','RadioButtonsGroup','CheckboxGroup','OptIn'].includes(node.type)&&typeof node.name==='string'&&!reserved.has(node.name))names.add(node.name);for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(walk);else walk(value);}};
  walk(flowJson);return [...names];
}
export function validateFlowMapping(mapping,fields){
  if(!Array.isArray(mapping)||mapping.length>50)throw new AppError('Provide at most 50 response mappings.',400,'FLOW_MAPPING_INVALID');
  const targets=new Set();
  return mapping.map(item=>{
    if(!item||!fields.includes(item.field)||!['name','attribute'].includes(item.target)||!['fill','replace'].includes(item.mode)||Object.keys(item).some(key=>!['field','target','key','mode'].includes(key)))throw new AppError('Select a Flow field, contact destination and update policy.',400,'FLOW_MAPPING_INVALID');
    const key=item.target==='name'?'name':item.key;
    if(typeof key!=='string'||!/^[a-z][a-z0-9_]{0,49}$/.test(key)||reserved.has(key))throw new AppError('Use a valid contact attribute key.',400,'FLOW_MAPPING_INVALID');
    const target=item.target+':'+key;if(targets.has(target))throw new AppError('Each contact destination can only be mapped once.',400,'FLOW_MAPPING_INVALID');targets.add(target);
    return {field:item.field,target:item.target,key,mode:item.mode};
  });
}
export function parseFlowReply(raw){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>32768)return null;
  try{const value=JSON.parse(raw);if(!value||Array.isArray(value)||typeof value!=='object'||! /^[a-f0-9]{64}$/.test(value.flow_token||''))return null;return value;}catch{return null;}
}
function responseValue(value){
  return typeof value==='string'&&value.length<=4000||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||Array.isArray(value)&&value.length<=20&&value.every(item=>typeof item==='string'&&item.length<=256);
}
export async function applyFlowReply(client,{businessId,contactId,phoneNumberId,messageId,reply,at}){
  if(!reply)return {matched:false};
  const invite=(await client.query("SELECT i.*,p.phone_number_id FROM whatsapp_flow_invites i JOIN whatsapp_phone_numbers p ON p.id=i.phone_id AND p.business_id=i.business_id WHERE i.business_id=$1 AND i.contact_id=$2 AND i.token_hash=$3 AND p.phone_number_id=$4 FOR UPDATE OF i",[businessId,contactId,hash(reply.flow_token),phoneNumberId])).rows[0];
  if(!invite||!['sent','unconfirmed','processing','completed'].includes(invite.status)||new Date(invite.expires_at).getTime()<Date.now()||new Date(at).getTime()<new Date(invite.created_at).getTime()-300000)return {matched:false};
  if(invite.status==='completed')return {matched:true,duplicate:true};
  const response={};
  for(const field of invite.fields){if(Object.hasOwn(reply,field)){if(!responseValue(reply[field]))return {matched:false};response[field]=reply[field];}}
  const contact=(await client.query('SELECT name,custom_attributes FROM contacts WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,contactId])).rows[0];
  if(!contact)return {matched:false};
  let name=contact.name;const attributes={...contact.custom_attributes};
  for(const item of invite.mapping){
    if(!Object.hasOwn(response,item.field))continue;
    const value=response[item.field];
    if(item.target==='name'){if(typeof value==='string'&&value.trim()&&value.length<=160&&(item.mode==='replace'||!name.trim()))name=value.trim();}
    else if(item.mode==='replace'||attributes[item.key]===undefined||attributes[item.key]===null||attributes[item.key]==='')attributes[item.key]=value;
  }
  if(Buffer.byteLength(JSON.stringify(attributes))>65536)return {matched:false};
  await client.query('UPDATE contacts SET name=$1,custom_attributes=$2,updated_at=NOW() WHERE business_id=$3 AND id=$4',[name,JSON.stringify(attributes),businessId,contactId]);
  await client.query('INSERT INTO whatsapp_flow_submissions (id,business_id,invite_id,contact_id,message_id,response) VALUES ($1,$2,$3,$4,$5,$6)',[id('fr'),businessId,invite.id,contactId,messageId,JSON.stringify(response)]);
  await client.query("UPDATE whatsapp_flow_invites SET status='completed' WHERE business_id=$1 AND id=$2",[businessId,invite.id]);
  await client.query("INSERT INTO events (id,business_id,type,contact_id,metadata) VALUES ($1,$2,'whatsapp_flow_completed',$3,$4)",[id('e'),businessId,contactId,JSON.stringify({flowId:invite.flow_id,messageId})]);
  return {matched:true,flowId:invite.flow_id};
}
export async function applyEntryAttribution(client,{businessId,contactId,phoneNumberId,messageId,text,at}){
  const rule=(await client.query('SELECT r.* FROM whatsapp_entry_rules r JOIN whatsapp_phone_numbers p ON p.id=r.phone_id AND p.business_id=r.business_id WHERE r.business_id=$1 AND p.phone_number_id=$2 AND r.prefilled_message=$3 AND r.enabled FOR SHARE OF r',[businessId,phoneNumberId,String(text||'').trim()])).rows[0];
  if(!rule)return null;
  const contact=(await client.query('SELECT unsubscribed FROM contacts WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,contactId])).rows[0];
  if(!contact)return null;
  const recent=(await client.query("SELECT 1 FROM whatsapp_entry_attributions WHERE business_id=$1 AND rule_id=$2 AND contact_id=$3 AND matched_at >= $4::timestamptz-($5::int*INTERVAL '1 minute') LIMIT 1",[businessId,rule.id,contactId,at,rule.cooldown_minutes])).rowCount;
  let status=rule.workflow_id?'unavailable':'attributed',sessionId=null;
  if(rule.workflow_id){
    const flow=(await client.query("SELECT * FROM automation_flows WHERE business_id=$1 AND id=$2 AND status='active' AND trigger_mode='manual'",[businessId,rule.workflow_id])).rows[0];
    const conversation=(await client.query('SELECT id,automation_paused FROM conversations WHERE business_id=$1 AND contact_id=$2',[businessId,contactId])).rows[0];
    const active=(await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff')",[businessId,contactId])).rowCount;
    if(contact.unsubscribed)status='opted_out';
    else if(recent)status='cooldown';
    else if(active||conversation?.automation_paused)status='handoff_or_active';
    else if(flow?.definition?.startNodeId&&conversation){
      try{assertSubscriptionActive(await subscriptionUsage(businessId,client));}catch(error){if(error.code!=='SUBSCRIPTION_INACTIVE')throw error;status='subscription_inactive';}
      if(status==='unavailable'){
        sessionId=id('fs');status='queued';
        await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id,context) VALUES ($1,$2,$3,$4,$5,$6)',[sessionId,businessId,contactId,flow.id,flow.definition.startNodeId,JSON.stringify({entryPointId:rule.id,entrySource:rule.source_name,entryAttributionMethod:'prefilled_message_match'})]);
        await client.query('INSERT INTO automation_jobs (id,business_id,session_id,incoming_message_id,input) VALUES ($1,$2,$3,$4,$5)',[id('aj'),businessId,sessionId,messageId,JSON.stringify({phase:'start',conversationId:conversation.id})]);
      }
    }
  }
  await client.query('INSERT INTO whatsapp_entry_attributions (id,business_id,rule_id,contact_id,message_id,source_name,session_id,workflow_status,matched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id('ea'),businessId,rule.id,contactId,messageId,rule.source_name,sessionId,status,at]);
  await client.query("UPDATE messages SET metadata=metadata||$1::jsonb WHERE id=$2",[JSON.stringify({entryPoint:{id:rule.id,code:rule.code,source:rule.source_name,method:'prefilled_message_match'}}),messageId]);
  return {status,sessionId};
}
export async function sendNativeFlowInvite(session,body,flow){
  const fields=flowFieldNames(flow.flow_json);
  if(! /^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId||'')||typeof body.text!=='string'||!body.text.trim()||body.text.length>1024||typeof body.cta!=='string'||!body.cta.trim()||body.cta.length>20||!Number.isInteger(body.expiresHours)||body.expiresHours<1||body.expiresHours>168)throw new AppError('Provide message text, CTA, expiry and a unique operation reference.',400,'FLOW_SEND_INVALID');
  if(flow.status!=='published'||!flow.meta_flow_id||!flow.flow_json?.screens?.length)throw new AppError('Publish a validated Flow definition first.',409,'FLOW_NOT_PUBLISHED');
  validateFlowMapping(flow.response_mapping,fields);
  await assertMessageCapacity(session.businessId,1,null,body.contactId);
  const fingerprint=hash(JSON.stringify([flow.id,body.contactId,body.phoneId,body.text,body.cta,body.expiresHours]));
  const token=crypto.randomBytes(32).toString('hex'),inviteId=id('fi');
  const ready=await transaction(async client=>{
    const contact=(await client.query('SELECT ct.*,cv.id AS conversation_id,cv.automation_paused,cv.whatsapp_phone_number_id FROM contacts ct JOIN conversations cv ON cv.contact_id=ct.id AND cv.business_id=ct.business_id WHERE ct.business_id=$1 AND ct.id=$2 FOR UPDATE OF ct',[session.businessId,body.contactId])).rows[0];
    const previous=(await client.query('SELECT status,fingerprint FROM whatsapp_flow_invites WHERE business_id=$1 AND request_id=$2',[session.businessId,body.requestId])).rows[0];
    if(previous)throw new AppError(previous.fingerprint===fingerprint?'This send was already attempted; check its status.':'Operation reference has different inputs.',409,'FLOW_SEND_ALREADY_ATTEMPTED');
    if(!contact||contact.unsubscribed||contact.automation_paused||!contact.last_message_at||Date.now()-new Date(contact.last_message_at).getTime()>86400000)throw new AppError('An opted-in contact with an open reply window and unpaused conversation is required.',403,'FLOW_CONTACT_UNAVAILABLE');
    const phone=(await client.query("SELECT p.*,a.waba_id,a.access_token_encrypted FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.id=$2 AND p.whatsapp_account_id=$3 AND a.status='connected'",[session.businessId,body.phoneId,flow.whatsapp_account_id])).rows[0];
    if(!phone||phone.phone_number_id!==contact.whatsapp_phone_number_id)throw new AppError('Use the connected number for this conversation and Flow account.',400,'FLOW_PHONE_MISMATCH');
    await client.query('INSERT INTO whatsapp_flow_invites (id,business_id,flow_id,contact_id,phone_id,token_hash,request_id,fingerprint,mapping,fields,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()+($11::int*INTERVAL \'1 hour\'))',[inviteId,session.businessId,flow.id,contact.id,phone.id,hash(token),body.requestId,fingerprint,JSON.stringify(flow.response_mapping),JSON.stringify(fields),body.expiresHours]);
    const runtime=await provisionRuntimeInvite(client,{businessId:session.businessId,flow,contactId:contact.id,phoneId:phone.id,flowToken:token,expiresHours:body.expiresHours});
    return {contact,phone,screen:runtime?.initialScreen||flow.flow_json.screens[0].id};
  });
  let result;
  try{result=await sendNativeFlowMessage({setup:ready.phone,to:ready.contact.phone,body:body.text.trim(),cta:body.cta.trim(),flowId:flow.meta_flow_id,screen:ready.screen,token});}
  catch(error){const failed=error.code==='META_SEND_FAILED'&&error.status<500&&![408,409,429].includes(error.status);await query("UPDATE whatsapp_flow_invites SET status=$1 WHERE business_id=$2 AND id=$3 AND status='processing'",[failed?'failed':'unconfirmed',session.businessId,inviteId]);if(failed)await query('DELETE FROM flow_runtime_sessions WHERE business_id=$1 AND token_hash=$2',[session.businessId,hash(token)]);throw error;}
  await transaction(async client=>{
    await client.query("UPDATE whatsapp_flow_invites SET status=CASE WHEN status='completed' THEN status ELSE 'sent' END,meta_message_id=$1 WHERE business_id=$2 AND id=$3",[result.metaMessageId,session.businessId,inviteId]);
    await client.query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES ($1,$2,'outgoing',$3,'sent',$4,'interactive',$5)",[id('m'),ready.contact.conversation_id,body.text.trim(),result.metaMessageId,JSON.stringify({nativeFlowId:flow.id,inviteId})]);
    await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'native_flow_sent',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({flowId:flow.id,contactId:ready.contact.id,inviteId})]);
    await recordSupportResponse(session.businessId,ready.contact.conversation_id,new Date(),client);
  });
  return {ok:true,inviteId,status:'sent'};
}

export async function flowSessions(request){
  try{
    const session=await requireSession(request);requireWorkspaceManager(session);
    if(request.method==='GET'){
      await query("UPDATE whatsapp_flow_invites SET status='unconfirmed' WHERE business_id=$1 AND status='processing' AND created_at<NOW()-INTERVAL '2 minutes'",[session.businessId]);
      const params=new URL(request.url).searchParams,search=(params.get('search')||'').slice(0,100);
      const flows=(await query("SELECT id,name,status,flow_json,response_mapping,endpoint_uri FROM whatsapp_native_flows WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 100",[session.businessId])).rows.map(flow=>({id:flow.id,name:flow.name,status:flow.status,fields:flowFieldNames(flow.flow_json),screens:flow.flow_json?.screens?.map(screen=>screen.id)||[],mapping:flow.response_mapping,managedEndpoint:isManagedRuntimeEndpoint(flow)}));
      const phones=(await query('SELECT id,display_phone_number FROM whatsapp_phone_numbers WHERE business_id=$1',[session.businessId])).rows;
      const contacts=search?(await query("SELECT id,name,phone FROM contacts WHERE business_id=$1 AND (name ILIKE $2 OR phone ILIKE $2) AND unsubscribed=FALSE ORDER BY name,id LIMIT 25",[session.businessId,'%'+search+'%'])).rows:[];
      const invites=(await query("SELECT i.id,i.flow_id,i.contact_id,i.status,i.expires_at,i.created_at,c.name FROM whatsapp_flow_invites i JOIN contacts c ON c.id=i.contact_id AND c.business_id=i.business_id WHERE i.business_id=$1 ORDER BY i.created_at DESC LIMIT 50",[session.businessId])).rows;
      const submissions=(await query('SELECT id,invite_id,contact_id,response,created_at FROM whatsapp_flow_submissions WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50',[session.businessId])).rows;
      const funnel=(await query(`SELECT flow_id,
        COUNT(*) FILTER (WHERE status IN ('sent','completed'))::int AS accepted,
        COUNT(*) FILTER (WHERE status='completed')::int AS completed,
        COUNT(*) FILTER (WHERE status='sent' AND expires_at<=NOW())::int AS expired_without_response,
        COUNT(*) FILTER (WHERE status='sent' AND expires_at>NOW())::int AS awaiting_response,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed,
        COUNT(*) FILTER (WHERE status IN ('processing','unconfirmed'))::int AS outcome_unknown
        FROM whatsapp_flow_invites WHERE business_id=$1 GROUP BY flow_id`,[session.businessId])).rows;
      return json({flows,phones,contacts,invites,submissions,funnel});
    }
    const body=await readJsonBodyLimited(request,32768);
    const flow=(await query('SELECT * FROM whatsapp_native_flows WHERE business_id=$1 AND id=$2',[session.businessId,body.flowId])).rows[0];
    if(!flow)throw new AppError('Flow not found.',404,'NOT_FOUND');
    const fields=flowFieldNames(flow.flow_json);
    if(body.action==='mapping'){
      if(session.role!=='Owner')throw new AppError('Only the owner can configure contact updates.',403,'FORBIDDEN');
      const mapping=validateFlowMapping(body.mapping,fields);
      await transaction(async client=>{await client.query('UPDATE whatsapp_native_flows SET response_mapping=$1 WHERE business_id=$2 AND id=$3',[JSON.stringify(mapping),session.businessId,flow.id]);await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'flow_mapping_updated',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({flowId:flow.id,mapping})]);});
      return json({ok:true});
    }
    if(body.action!=='send')throw new AppError('Unsupported Flow action.',400,'FLOW_SEND_INVALID');
    return json(await sendNativeFlowInvite(session,body,flow));
  }catch(error){return errorJson(error);}
}
