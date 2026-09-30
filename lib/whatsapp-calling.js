import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson} from './db.js';
import {decryptSecret} from './meta.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {requireWorkspaceManager} from './workspace-permissions.js';
import {assertSubscriptionActive,subscriptionUsage,assertMessageCapacity} from './limits.js';

const terminal = new Set(['terminated','rejected','failed']);
const callingRoles=['Owner','Manager','Agent'];
export function validateCallingPolicy(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || !Array.isArray(value.roles) || value.roles.some(role=>!callingRoles.includes(role)) || new Set(value.roles).size!==value.roles.length || !(value.agentIds===null || Array.isArray(value.agentIds)&&value.agentIds.length<=500&&value.agentIds.every(user=>typeof user==='string'&&user.length>0&&user.length<=100)&&new Set(value.agentIds).size===value.agentIds.length)) throw new AppError('Choose calling roles and eligible team members.',400,'CALL_POLICY_INVALID');
  return {roles:[...value.roles],agentIds:value.agentIds===null?null:[...value.agentIds]};
}
export function callingAccess(session,platform={},tenant=null) {
  const policy=validateCallingPolicy(tenant??{roles:['Owner','Manager'],agentIds:null});
  const roles=platform.roles===undefined?callingRoles:validateCallingPolicy({roles:platform.roles,agentIds:null}).roles;
  const manager=['Owner','Manager'].includes(session.role);
  return {canCall:roles.includes(session.role)&&policy.roles.includes(session.role)&&(policy.agentIds===null||policy.agentIds.includes(session.userId)),canViewGlobalHistory:manager,canReadSettings:manager,canWriteSettings:session.role==='Owner',canConfigurePolicy:session.role==='Owner'&&platform.allowTenantConfiguration===true,policy,allowedRoles:roles};
}
async function accessFor(session) {
  const platform=(await query("SELECT value FROM platform_settings WHERE key='whatsapp_calling_access'")).rows[0]?.value||{};
  const tenant=(await query("SELECT meta_connection_metadata->'callingAccess' AS policy FROM businesses WHERE id=$1",[session.businessId])).rows[0]?.policy;
  return callingAccess(session,platform,tenant);
}
function requireCaller(access) {
  if(!access.canCall)throw new AppError('Your role or team is not enabled for calling.',403,'CALL_ACCESS_DENIED');
}
// Assignment is scoped to both the customer and business number.
function assignmentSql(alias,userParam) {
  return `EXISTS (SELECT 1 FROM conversations cv JOIN contacts ct ON ct.id=cv.contact_id AND ct.business_id=cv.business_id WHERE cv.business_id=${alias}.business_id AND cv.whatsapp_phone_number_id=${alias}.phone_number_id AND regexp_replace(ct.phone,'[^0-9]','','g')=${alias}.remote_number AND cv.assigned_user_id=${userParam})`;
}
async function assignedTarget(session,contactId,phoneId,client={query}) {
  if(['Owner','Manager'].includes(session.role))return;
  const target=await client.query('SELECT id FROM conversations WHERE business_id=$1 AND contact_id=$2 AND whatsapp_phone_number_id=$3 AND assigned_user_id=$4 FOR SHARE',[session.businessId,contactId,phoneId,session.userId]);
  if(!target.rows.length)throw new AppError('Only assigned conversations can be called.',403,'CALL_ASSIGNMENT_REQUIRED');
}
async function assignedCall(session,call,client) {
  if(['Owner','Manager'].includes(session.role))return;
  const target=await client.query("SELECT cv.id FROM conversations cv JOIN contacts ct ON ct.id=cv.contact_id AND ct.business_id=cv.business_id WHERE cv.business_id=$1 AND cv.whatsapp_phone_number_id=$2 AND regexp_replace(ct.phone,'[^0-9]','','g')=$3 AND cv.assigned_user_id=$4 FOR SHARE OF cv",[session.businessId,call.phone_number_id,call.remote_number,session.userId]);
  if(!target.rows.length)throw new AppError('Only assigned conversations can be called.',403,'CALL_ASSIGNMENT_REQUIRED');
}
export function callSession(value,type) {
  if(value?.sdp_type!==type || typeof value.sdp!=='string' || value.sdp.length>64000 || !value.sdp.startsWith('v=0') || !/^m=audio /m.test(value.sdp) || /^m=video /m.test(value.sdp) || !/a=fingerprint:sha-256 /i.test(value.sdp)) throw new AppError('A valid audio-only WebRTC session is required.',400,'CALL_SESSION_INVALID');
  return {sdp_type:type,sdp:value.sdp};
}
export function callingIceServers(userId,now=Date.now()) {
  const urls=String(process.env.WHATSAPP_CALL_TURN_URLS||'').split(',').map(x=>x.trim()).filter(Boolean);
  const secret=process.env.WHATSAPP_CALL_TURN_SECRET;
  if(!secret || !urls.length || urls.some(url=>!/^turns?:[a-z0-9.-]+(?::\d+)?(?:\?transport=(?:udp|tcp))?$/i.test(url))) throw new AppError('The platform owner must configure secure TURN service before browser calling.',503,'CALL_RELAY_NOT_CONFIGURED');
  const username=Math.floor(now/1000+3600)+':'+crypto.createHash('sha256').update(userId).digest('hex').slice(0,24);
  return [{urls,username,credential:crypto.createHmac('sha1',secret).update(username).digest('base64')}];
}
async function graph(phone,path,body) {
  let response;
  try {response=await fetch('https://graph.facebook.com/'+(process.env.META_GRAPH_API_VERSION||'v26.0')+'/'+phone.phone_number_id+'/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+decryptSecret(phone.access_token_encrypted),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});} catch {throw new AppError('Meta did not confirm this operation. Do not repeat it until its status is known.',409,'CALL_UNCONFIRMED');}
  const payload=JSON.parse(await readTextBodyLimited(response,2_000_000));
  if(!response.ok) throw new AppError(payload.error?.message||'Meta calling request failed.',response.status>=500?502:400,response.status>=500||[408,409].includes(response.status)?'CALL_UNCONFIRMED':'CALL_REJECTED');
  return payload;
}
async function ownedPhone(businessId,phoneId) {
  const phone=(await query("SELECT p.phone_number_id,p.display_phone_number,a.access_token_encrypted FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND p.phone_number_id=$2 AND a.status='connected'",[businessId,phoneId])).rows[0];
  if(!phone) throw new AppError('Connected WhatsApp number not found.',404,'NOT_FOUND');
  return phone;
}
export async function getCalling(request) {
  try {
    const session=await requireSession(request),access=await accessFor(session);
    if(!access.canViewGlobalHistory)requireCaller(access);
    await query("UPDATE whatsapp_calls SET status='unconfirmed',error_code='CALL_UNCONFIRMED',updated_at=NOW() WHERE business_id=$1 AND status='processing' AND updated_at<NOW()-INTERVAL '2 minutes'",[session.businessId]);
    await query("DELETE FROM whatsapp_call_webhook_buffer WHERE business_id=$1 AND created_at<NOW()-INTERVAL '1 hour'",[session.businessId]);
    await query("UPDATE whatsapp_calls SET remote_session='{}'::jsonb WHERE business_id=$1 AND remote_session<>'{}'::jsonb AND (ended_at IS NOT NULL OR updated_at<NOW()-INTERVAL '1 hour')",[session.businessId]);
    const url=new URL(request.url);
    if(url.searchParams.get('action')==='ice') {requireCaller(access);return json({iceServers:callingIceServers(session.businessId+':'+session.userId)});}
    if(url.searchParams.get('action')==='settings'){
      requireWorkspaceManager(session);
      const result=await graph(await ownedPhone(session.businessId,url.searchParams.get('phoneId')),'settings?fields=calling');
      if(result.calling)await query("UPDATE whatsapp_phone_numbers SET metadata=jsonb_set(metadata,'{calling}',$1::jsonb),updated_at=NOW() WHERE business_id=$2 AND phone_number_id=$3",[JSON.stringify(result.calling),session.businessId,url.searchParams.get('phoneId')]);
      return json(result);
    }
    const requested=Number(url.searchParams.get('page')||1);const page=Number.isSafeInteger(requested)?Math.min(100000,Math.max(1,requested)):1;
    const scope=access.canViewGlobalHistory?'TRUE':assignmentSql('c','$2');
    const calls=(await query(`SELECT c.id,c.phone_number_id,c.provider_call_id,c.remote_number,c.direction,c.status,c.agent_id,c.error_code,c.created_at,c.ended_at,CASE WHEN $4 AND (c.agent_id=$2 OR (c.agent_id IS NULL AND c.direction='USER_INITIATED')) THEN c.remote_session ELSE '{}'::jsonb END AS remote_session FROM whatsapp_calls c WHERE c.business_id=$1 AND (${scope}) ORDER BY c.created_at DESC,c.id LIMIT 26 OFFSET $3`,[session.businessId,session.userId,(page-1)*25,access.canCall])).rows;
    const phones=(await query("SELECT p.phone_number_id,p.display_phone_number,p.verified_name FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id WHERE p.business_id=$1 AND a.status='connected' ORDER BY p.is_default DESC,p.created_at",[session.businessId])).rows;
    const search=String(url.searchParams.get('search')||'').slice(0,100);
    const contacts=(await query(`SELECT ct.id,ct.name,ct.phone FROM contacts ct WHERE ct.business_id=$1 AND ct.unsubscribed=FALSE AND (ct.name ILIKE $2 OR ct.phone ILIKE $2) AND ($3 OR EXISTS (SELECT 1 FROM conversations cv WHERE cv.business_id=ct.business_id AND cv.contact_id=ct.id AND cv.assigned_user_id=$4 AND cv.whatsapp_phone_number_id=$5)) ORDER BY ct.name,ct.id LIMIT 30`,[session.businessId,'%'+search+'%',access.canViewGlobalHistory,session.userId,url.searchParams.get('phoneId')||''])).rows;
    const selectedCall=url.searchParams.get('callId')?(await query(`SELECT c.id,c.provider_call_id,c.remote_number,c.direction,c.status,c.agent_id,CASE WHEN $4 THEN c.remote_session ELSE '{}'::jsonb END AS remote_session FROM whatsapp_calls c WHERE c.business_id=$1 AND c.id=$3 AND c.agent_id=$2 AND (${scope})`,[session.businessId,session.userId,url.searchParams.get('callId'),access.canCall])).rows[0]||null:null;
    const availability=(await query('SELECT availability FROM memberships WHERE business_id=$1 AND user_id=$2',[session.businessId,session.userId])).rows[0]?.availability||'offline';
    const followups=(await query(`SELECT c.id,c.remote_number,c.created_at,c.followup_status,c.followup_note,c.followup_updated_at FROM whatsapp_calls c WHERE c.business_id=$1 AND c.followup_status='open' AND (${scope}) ORDER BY c.created_at DESC,c.id LIMIT 50`,access.canViewGlobalHistory?[session.businessId]:[session.businessId,session.userId])).rows;
    const members=access.canConfigurePolicy?(await query('SELECT m.user_id,m.role,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 ORDER BY u.name,m.user_id',[session.businessId])).rows:[];
    return json({calls:calls.slice(0,25),selectedCall,phones,contacts,page,hasMore:calls.length>25,userId:session.userId,availability,followups,access,members});
  }catch(error){return errorJson(error);}
}
export async function updateCalling(request) {
  try {
    const session=await requireSession(request),access=await accessFor(session);
    const body=await readJsonBodyLimited(request,70000);
    if(body.action==='policy') {
      if(!access.canConfigurePolicy)throw new AppError('The platform administrator must delegate calling policy management to the owner.',403,'CALL_POLICY_FORBIDDEN');
      const policy=validateCallingPolicy(body.policy);
      if(policy.roles.some(role=>!access.allowedRoles.includes(role)))throw new AppError('Calling roles exceed the platform policy.',403,'CALL_POLICY_FORBIDDEN');
      await transaction(async client=>{
        await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
        const members=(await client.query('SELECT user_id FROM memberships WHERE business_id=$1',[session.businessId])).rows;
        if(policy.agentIds?.some(user=>!members.some(member=>member.user_id===user)))throw new AppError('Choose current tenant team members.',400,'CALL_POLICY_INVALID');
        await client.query("UPDATE businesses SET meta_connection_metadata=jsonb_set(meta_connection_metadata,'{callingAccess}',$2::jsonb),updated_at=NOW() WHERE id=$1",[session.businessId,JSON.stringify(policy)]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_call_policy',JSON.stringify(policy)]);
      });
      return json({ok:true});
    }
    if(!['settings','terminate'].includes(body.action))requireCaller(access);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(body.action==='followup'){
      if(!['open','resolved'].includes(body.status)||typeof body.note!=='string'||!body.note.trim()||body.note.length>2000)throw new AppError('Provide a follow-up status and note.',400,'CALL_FOLLOWUP_INVALID');
      await transaction(async client=>{
        const call=(await client.query('SELECT * FROM whatsapp_calls WHERE business_id=$1 AND id=$2 FOR UPDATE',[session.businessId,body.callId])).rows[0];
        if(!call||call.direction!=='USER_INITIATED'||!terminal.has(call.status)||call.followup_status==='none')throw new AppError('Missed call follow-up not found.',404,'NOT_FOUND');
        await assignedCall(session,call,client);
        await client.query('UPDATE whatsapp_calls SET followup_status=$1,followup_note=$2,followup_user_id=$3,followup_updated_at=NOW() WHERE business_id=$4 AND id=$5',[body.status,body.note.trim(),session.userId,session.businessId,call.id]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_call_followup',JSON.stringify({callId:call.id,status:body.status})]);
      });
      return json({ok:true});
    }
    if(body.action==='settings') {
      if(session.role!=='Owner') throw new AppError('Only the owner can change calling settings.',403,'FORBIDDEN');
      if(typeof body.enabled!=='boolean'||typeof body.callbackPermissions!=='boolean')throw new AppError('Provide explicit calling settings.',400,'CALL_SETTINGS_INVALID');
      const result=await graph(await ownedPhone(session.businessId,body.phoneId),'settings',{calling:{status:body.enabled?'ENABLED':'DISABLED',callback_permission_status:body.callbackPermissions?'ENABLED':'DISABLED',sip:{status:'DISABLED'}}});
      if(result.success!==true)throw new AppError('Meta did not confirm the settings change.',409,'CALL_UNCONFIRMED');
      await query("UPDATE whatsapp_phone_numbers SET metadata=jsonb_set(metadata,'{calling}',$1::jsonb),updated_at=NOW() WHERE business_id=$2 AND phone_number_id=$3",[JSON.stringify({status:body.enabled?'ENABLED':'DISABLED',callback_permission_status:body.callbackPermissions?'ENABLED':'DISABLED'}),session.businessId,body.phoneId]);
      await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_call_settings',JSON.stringify({phoneId:body.phoneId,enabled:body.enabled})]);
      return json({ok:true});
    }
    if(body.action==='permissions') {
      await assignedTarget(session,body.contactId,body.phoneId);
      const contact=(await query('SELECT phone FROM contacts WHERE id=$1 AND business_id=$2 AND unsubscribed=FALSE',[body.contactId,session.businessId])).rows[0];
      if(!contact)throw new AppError('Contact not found or opted out.',404,'NOT_FOUND');
      const phone=await ownedPhone(session.businessId,body.phoneId);
      return json(await transaction(async client=>{await assignedTarget(session,body.contactId,body.phoneId,client);return graph(phone,'call_permissions?user_wa_id='+encodeURIComponent(contact.phone.replace(/\D/g,'')));}));
    }
    if(body.action==='requestPermission'){
      await assignedTarget(session,body.contactId,body.phoneId);
      const phone=await ownedPhone(session.businessId,body.phoneId);
      const target=(await query("SELECT ct.id,ct.phone,c.id AS conversation_id,(SELECT MAX(at) FROM messages WHERE conversation_id=c.id AND direction='incoming') AS last_incoming_at FROM contacts ct JOIN conversations c ON c.contact_id=ct.id AND c.business_id=ct.business_id AND c.whatsapp_phone_number_id=$3 WHERE ct.id=$1 AND ct.business_id=$2 AND ct.unsubscribed=FALSE",[body.contactId,session.businessId,phone.phone_number_id])).rows[0];
      if(!target||!target.last_incoming_at||Date.now()-new Date(target.last_incoming_at).getTime()>86400000)throw new AppError('The customer must message this number before an interactive permission request.',409,'REPLY_WINDOW_CLOSED');
      if(typeof body.message!=='string'||!body.message.trim()||body.message.length>1024||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId||''))throw new AppError('Provide a permission request message and unique reference.',400,'CALL_REQUEST_INVALID');
      const permission=await graph(phone,'call_permissions?user_wa_id='+encodeURIComponent(target.phone.replace(/\D/g,'')));
      if(!permission.actions?.some(item=>item.action_name==='send_call_permission_request'&&item.can_perform_action===true))throw new AppError('Meta does not allow another permission request now.',409,'CALL_PERMISSION_LIMIT');
      await assertMessageCapacity(session.businessId,1,null,target.id);
      await query("INSERT INTO whatsapp_call_permission_requests (id,business_id,phone_number_id,contact_id,status) VALUES ($1,$2,$3,$4,'processing')",[body.requestId,session.businessId,phone.phone_number_id,target.id]);
      let messageId;
      try{const result=await transaction(async client=>{await assignedTarget(session,body.contactId,body.phoneId,client);return graph(phone,'messages',{messaging_product:'whatsapp',recipient_type:'individual',to:target.phone.replace(/\D/g,''),type:'interactive',interactive:{type:'call_permission_request',action:{name:'call_permission_request'},body:{text:body.message.trim()}}});});messageId=result.messages?.[0]?.id;if(typeof messageId!=='string'||!messageId)throw new AppError('Meta did not confirm the message.',409,'CALL_UNCONFIRMED');}
      catch(error){await query('UPDATE whatsapp_call_permission_requests SET status=$1 WHERE id=$2',[error.code==='CALL_REJECTED'?'failed':'unconfirmed',body.requestId]);throw error;}
      await transaction(async client=>{
        await client.query("UPDATE whatsapp_call_permission_requests SET status='confirmed',message_id=$1 WHERE id=$2",[messageId,body.requestId]);
        await client.query("INSERT INTO messages (id,conversation_id,direction,body,message_type,status,meta_message_id,metadata) VALUES ($1,$2,'outgoing',$3,'interactive','sent',$4,$5)",[id('m'),target.conversation_id,body.message.trim(),messageId,JSON.stringify({callPermissionRequestId:body.requestId})]);
        await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_call_permission_requested',JSON.stringify({requestId:body.requestId,contactId:target.id,phoneId:phone.phone_number_id,messageId})]);
      });
      return json({ok:true,messageId},201);
    }
    if(!['connect','accept','reject','terminate'].includes(body.action))throw new AppError('Unsupported calling action.',400,'CALL_ACTION_INVALID');
    const action=body.action;
    let call;
    let phone;
    let wire={messaging_product:'whatsapp',action};
    if(action==='connect') {
      await assignedTarget(session,body.contactId,body.phoneId);
      callingIceServers(session.businessId+':'+session.userId);
      wire.session=callSession(body.session,'offer');
      if(!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId||''))throw new AppError('Provide a unique call reference.',400,'CALL_REFERENCE_REQUIRED');
      const prior=(await query('SELECT id,status FROM whatsapp_calls WHERE id=$1 AND business_id=$2',[body.requestId,session.businessId])).rows[0];
      if(prior)throw new AppError('This call reference already has a recorded attempt. Inspect the existing call.',409,'CALL_REFERENCE_EXISTS');
      phone=await ownedPhone(session.businessId,body.phoneId);
      const contact=(await query('SELECT phone FROM contacts WHERE id=$1 AND business_id=$2 AND unsubscribed=FALSE',[body.contactId,session.businessId])).rows[0];
      if(!contact)throw new AppError('Contact not found or opted out.',404,'NOT_FOUND');
      wire.to=contact.phone.replace(/\D/g,'');
      const permission=await graph(phone,'call_permissions?user_wa_id='+encodeURIComponent(wire.to));
      if(!permission.actions?.some(item=>item.action_name==='start_call'&&item.can_perform_action===true))throw new AppError('The customer has not granted an available calling permission.',403,'CALL_PERMISSION_REQUIRED');
      call={id:body.requestId,phone_number_id:phone.phone_number_id,remote_number:wire.to,status:'processing'};
      wire.biz_opaque_callback_data=call.id;
      await transaction(async client=>{
        await assignedTarget(session,body.contactId,body.phoneId,client);
        await client.query("INSERT INTO whatsapp_calls (id,business_id,phone_number_id,remote_number,direction,status,agent_id) VALUES ($1,$2,$3,$4,'BUSINESS_INITIATED','processing',$5)",[call.id,session.businessId,phone.phone_number_id,wire.to,session.userId]);
      });
    }else{
      call=await transaction(async client=>{
        const row=(await client.query('SELECT * FROM whatsapp_calls WHERE id=$1 AND business_id=$2 FOR UPDATE',[body.callId,session.businessId])).rows[0];
        if(!row)throw new AppError('Call not found.',404,'NOT_FOUND');
        // Keep hang-up available to the bound user after access is revoked.
        if(action!=='terminate'||row.agent_id!==session.userId){requireCaller(access);await assignedCall(session,row,client);}
        if(terminal.has(row.status))throw new AppError('The call has already ended.',409,'CALL_ENDED');
        if(row.agent_id&&row.agent_id!==session.userId)throw new AppError('Another agent owns this call.',403,'CALL_CLAIMED');
        if(action==='accept'&&(row.direction!=='USER_INITIATED'||row.status!=='ringing'))throw new AppError('This call cannot be answered.',409,'CALL_STATE_INVALID');
        if(action==='accept'&&(await client.query('SELECT availability FROM memberships WHERE business_id=$1 AND user_id=$2',[session.businessId,session.userId])).rows[0]?.availability!=='available')throw new AppError('Set your availability to available before answering.',409,'CALL_AGENT_UNAVAILABLE');
        if(action==='reject'&&row.direction!=='USER_INITIATED')throw new AppError('Only an incoming call can be rejected.',400,'CALL_STATE_INVALID');
        if(!row.provider_call_id)throw new AppError('Meta has not confirmed the call ID.',409,'CALL_UNCONFIRMED');
        if(action==='accept'){callingIceServers(session.businessId+':'+session.userId);wire.session=callSession(body.session,'answer');}
        await client.query('UPDATE whatsapp_calls SET agent_id=$1,updated_at=NOW() WHERE id=$2',[session.userId,row.id]);
        return row;
      });
      phone=await ownedPhone(session.businessId,call.phone_number_id);wire.call_id=call.provider_call_id;
      if(action==='accept') {callingIceServers(session.businessId+':'+session.userId);wire.session=callSession(body.session,'answer');}
    }
    const actionId=id('ca');
    const claimed=await query("INSERT INTO whatsapp_call_actions (id,business_id,call_id,action,status) VALUES ($1,$2,$3,$4,'processing') ON CONFLICT (call_id,action) DO NOTHING RETURNING id",[actionId,session.businessId,call.id,action]);
    if(!claimed.rowCount)throw new AppError('This call action already has a recorded attempt. Do not repeat uncertain signaling.',409,'CALL_ACTION_EXISTS');
    let state='unconfirmed';let providerId=call.provider_call_id||'';let errorCode='';
    try {
      if(action==='accept') {const prepared=await graph(phone,'calls',{...wire,action:'pre_accept'});if(prepared.success!==true)throw new AppError('Meta did not confirm call preparation.',409,'CALL_UNCONFIRMED');}
      const result=await graph(phone,'calls',wire);
      providerId=action==='connect'?result.calls?.[0]?.id:providerId;
      if((action==='connect'&&!/^wacid\.[\w.-]+$/.test(providerId||''))||(action!=='connect'&&result.success!==true))throw new AppError('Meta did not confirm the call.',409,'CALL_UNCONFIRMED');
      state=action==='connect'?'connecting':action==='accept'?'active':action==='reject'?'rejected':'terminated';
    }catch(error){errorCode=error.code||'CALL_UNCONFIRMED';if(errorCode==='CALL_REJECTED')state=action==='connect'?'failed':call.status;}
    await transaction(async client=>{
      await client.query('UPDATE whatsapp_call_actions SET status=$1 WHERE id=$2',[errorCode==='CALL_REJECTED'?'failed':errorCode?'unconfirmed':'confirmed',actionId]);
      if(!errorCode&&state==='active')await client.query('UPDATE whatsapp_calls SET answered_at=COALESCE(answered_at,NOW()) WHERE id=$1 AND business_id=$2',[call.id,session.businessId]);
      if(!errorCode&&terminal.has(state))await client.query("UPDATE whatsapp_calls SET followup_status=CASE WHEN followup_status='none' THEN 'open' ELSE followup_status END WHERE id=$1 AND business_id=$2 AND direction='USER_INITIATED' AND answered_at IS NULL AND status<>'active'",[call.id,session.businessId]);
      await client.query("UPDATE whatsapp_calls SET provider_call_id=CASE WHEN provider_call_id='' THEN $1 ELSE provider_call_id END,status=CASE WHEN status IN ('terminated','rejected') THEN status WHEN status='active' AND $2='connecting' THEN status ELSE $2 END,error_code=$3,ended_at=CASE WHEN $2 IN ('terminated','rejected','failed') THEN NOW() ELSE ended_at END,remote_session=CASE WHEN $2 IN ('terminated','rejected','failed') THEN '{}'::jsonb ELSE remote_session END,updated_at=NOW() WHERE id=$4",[providerId,state,errorCode,call.id]);
      await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'whatsapp_call_'+action,JSON.stringify({callId:call.id,state,errorCode})]);
    });
    if(providerId){
      const buffered=(await query('SELECT payload FROM whatsapp_call_webhook_buffer WHERE business_id=$1 AND provider_call_id=$2 ORDER BY occurred_at,created_at',[session.businessId,providerId])).rows;
      for(const item of buffered)await ingestCallingWebhook(session.businessId,{metadata:{phone_number_id:phone.phone_number_id},calls:[item.payload]});
    }
    if(errorCode)throw new AppError(state==='failed'?'Meta rejected the calling operation.':'Calling outcome is unconfirmed. Do not repeat the operation.',409,errorCode);
    return json({call:{id:call.id,status:state,provider_call_id:providerId}});
  }catch(error){if(error.code==='23505')return errorJson(new AppError('An agent already has an active or uncertain call.',409,'CALL_ALREADY_ACTIVE'));return errorJson(error);}
}
export async function ingestCallingWebhook(businessId,value) {
  const phone=await ownedPhone(businessId,String(value.metadata?.phone_number_id||''));
  const entries=[...(value.calls||[]),...(value.statuses||[]).filter(item=>item.type==='call')];
  for(const event of entries){
    if(!/^wacid\.[\w.-]+$/.test(event.id||''))continue;
    const at=new Date(Number(event.timestamp)*1000);if(!Number.isFinite(at.getTime()))continue;
    const status=event.event==='terminate'?'terminated':event.status==='REJECTED'?'rejected':event.status==='ACCEPTED'?'active':event.status==='RINGING'?'ringing':event.event==='connect'?(event.direction==='USER_INITIATED'?'ringing':'connecting'):null;
    if(!status)continue;
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify([businessId,phone.phone_number_id,event])).digest('hex');
    await query('INSERT INTO whatsapp_call_webhook_buffer (id,business_id,phone_number_id,provider_call_id,payload,occurred_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[fingerprint,businessId,phone.phone_number_id,event.id,JSON.stringify(event),at]);
    await transaction(async client=>{
      let row=(await client.query('SELECT * FROM whatsapp_calls WHERE business_id=$1 AND phone_number_id=$2 AND (provider_call_id=$3 OR (id=$4 AND direction=$5)) FOR UPDATE',[businessId,phone.phone_number_id,event.id,String(event.biz_opaque_callback_data||''),'BUSINESS_INITIATED'])).rows[0];
      if(!row){
        if(event.direction!=='USER_INITIATED'||event.event!=='connect')return;
        const remote=String(event.from||event.from_user_id||'');if(!remote||remote.length>100)return;
        const offer=callSession(event.session,'offer');
        await client.query("INSERT INTO whatsapp_calls (id,business_id,phone_number_id,provider_call_id,remote_number,direction,status,remote_session,last_event_at) VALUES ($1,$2,$3,$4,$5,'USER_INITIATED','ringing',$6,$7) ON CONFLICT (provider_call_id) WHERE provider_call_id<>'' DO NOTHING",[id('call'),businessId,phone.phone_number_id,event.id,remote,JSON.stringify(offer),at]);
        await client.query('DELETE FROM whatsapp_call_webhook_buffer WHERE id=$1',[fingerprint]);
        return;
      }
      await client.query('DELETE FROM whatsapp_call_webhook_buffer WHERE id=$1',[fingerprint]);
      if(terminal.has(row.status)||(row.last_event_at&&new Date(row.last_event_at)>at))return;
      if(status==='active')await client.query('UPDATE whatsapp_calls SET answered_at=COALESCE(answered_at,$1) WHERE id=$2 AND business_id=$3',[at,row.id,businessId]);
      if(row.direction==='USER_INITIATED'&&!row.answered_at&&row.status!=='active'&&terminal.has(status))await client.query("UPDATE whatsapp_calls SET followup_status=CASE WHEN followup_status='none' THEN 'open' ELSE followup_status END WHERE id=$1 AND business_id=$2",[row.id,businessId]);
      const remoteSession=event.session?callSession(event.session,row.direction==='BUSINESS_INITIATED'?'answer':'offer'):row.remote_session;
      await client.query("UPDATE whatsapp_calls SET provider_call_id=$1,status=CASE WHEN status='active' AND $2 IN ('connecting','ringing') THEN status ELSE $2 END,remote_session=CASE WHEN $2 IN ('terminated','rejected') THEN '{}'::jsonb ELSE $3::jsonb END,last_event_at=$4,ended_at=CASE WHEN $2 IN ('terminated','rejected') THEN $4 ELSE ended_at END,error_code='',updated_at=NOW() WHERE id=$5",[event.id,status,JSON.stringify(remoteSession),at,row.id]);
    });
  }
}
