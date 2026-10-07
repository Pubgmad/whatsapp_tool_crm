import crypto from 'node:crypto';
import {AppError,enterSystemContext,errorJson,id,json,query,transaction} from './db.js';
import {assertWorkspaceFeature,workspaceFeatureFlags} from './feature-controls.js';
import {assertMessageCapacity} from './limits.js';
import {createRuntimeSession,handleRuntimeExchange,isManagedRuntimeEndpoint} from './flow-runtime.js';
import {hostedWebviewUrl,sendCtaUrlMessage} from './meta.js';
import {okToReply} from './reply-window.js';
import {recordSupportResponse} from './support-policy.js';
import {assertRequestOrigin,enforceRequestRateLimit,readJsonBodyLimited} from './security.js';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const inviteId=value=>/^wvi_[a-f0-9]{16}$/.test(value||'');
const viewId=value=>/^wv_[a-f0-9]{16}$/.test(value||'');
const requestId=value=>/^[A-Za-z0-9_-]{16,80}$/.test(value||'');
const tokenShape=value=>/^[a-f0-9]{64}$/.test(value||'');
const safeUrl=(view,token)=>{
  let app;try{app=new URL(process.env.APP_URL);}catch{throw new AppError('Configure the public HTTPS app URL.',503,'WEBVIEW_URL_UNAVAILABLE');}
  if(app.protocol!=='https:'||app.username||app.password||app.search||app.hash)throw new AppError('Configure the public HTTPS app URL.',503,'WEBVIEW_URL_UNAVAILABLE');
  const url=new URL(`/w/${encodeURIComponent(view)}?session=${token}`,app.origin);
  return url.href;
};

export async function sendHostedWebviewInChat({businessId,userId,viewId:targetViewId,contactId,operationId}){
  if(!viewId(targetViewId)||!/^c_[a-f0-9]{16}$/.test(contactId||'')||!requestId(operationId))throw new AppError('Select a page, contact and unique operation reference.',400,'WEBVIEW_SEND_INVALID');
  await assertWorkspaceFeature('webviews',businessId);
  await assertMessageCapacity(businessId,1,null,contactId);
  const row=(await query(`SELECT v.*,b.name AS business_name,p.phone_number_id,p.registration_state,a.status AS account_status,a.waba_id,a.access_token_encrypted,
      c.phone AS customer_phone,c.unsubscribed,cv.id AS conversation_id,cv.whatsapp_phone_number_id AS conversation_phone_id
    FROM whatsapp_webviews v JOIN businesses b ON b.id=v.business_id
    JOIN whatsapp_phone_numbers p ON p.id=v.phone_id AND p.business_id=v.business_id
    JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
    JOIN contacts c ON c.id=$3 AND c.business_id=v.business_id
    JOIN conversations cv ON cv.contact_id=c.id AND cv.business_id=c.business_id
    WHERE v.business_id=$1 AND v.id=$2 AND v.enabled AND v.flow_id IS NULL AND b.account_status<>'suspended'
      AND p.registration_state='registered' AND a.status='connected'`,[businessId,targetViewId,contactId])).rows[0];
  if(!row||row.conversation_phone_id!==row.phone_number_id||row.unsubscribed||!okToReply(row))throw new AppError('This contact or hosted page is not ready for an in-chat web page.',409,'WEBVIEW_SEND_UNAVAILABLE');
  const url=hostedWebviewUrl(targetViewId);
  const sent=await sendCtaUrlMessage({setup:{phone_number_id:row.phone_number_id,waba_id:row.waba_id,access_token_encrypted:row.access_token_encrypted},to:row.customer_phone,body:row.prefilled_message,cta:row.button_label,url,headerText:row.business_name});
  await query("INSERT INTO messages(id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES($1,$2,'outgoing',$3,$4,$5,'interactive',$6)",[id('m'),row.conversation_id,row.prefilled_message,sent.status,sent.metaMessageId,JSON.stringify({webviewId:targetViewId,inChat:true})]);
  await query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),businessId,userId,'whatsapp_webview_inchat_sent',JSON.stringify({viewId:targetViewId,contactId,operationId})]);
  await recordSupportResponse(businessId,row.conversation_id,new Date());
  return {status:'sent',url};
}

export async function sendTransactionalWebview({businessId,userId,viewId:targetViewId,contactId,operationId}){
  if(!viewId(targetViewId)||!/^c_[a-f0-9]{16}$/.test(contactId||'')||!requestId(operationId))throw new AppError('Select a page, contact and unique operation reference.',400,'WEBVIEW_SEND_INVALID');
  await assertWorkspaceFeature('webviews',businessId);
  await assertMessageCapacity(businessId,1,null,contactId);
  const fingerprint=hash(JSON.stringify([targetViewId,contactId]));
  const token=crypto.randomBytes(32).toString('hex');
  const prepared=await transaction(async client=>{
    await client.query('SELECT id FROM whatsapp_webviews WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,targetViewId]);
    const prior=(await client.query('SELECT status,fingerprint,id FROM whatsapp_webview_invites WHERE business_id=$1 AND request_id=$2 FOR UPDATE',[businessId,operationId])).rows[0];
    if(prior)throw new AppError(prior.fingerprint===fingerprint?'This invitation was already attempted. Check its status before sending again.':'Operation reference has different inputs.',409,'WEBVIEW_ALREADY_ATTEMPTED');
    if((await client.query("SELECT 1 FROM whatsapp_webview_invites WHERE business_id=$1 AND webview_id=$2 AND contact_id=$3 AND status IN ('processing','sent','unconfirmed') AND expires_at>NOW() LIMIT 1",[businessId,targetViewId,contactId])).rowCount)throw new AppError('An active or unconfirmed invitation already exists for this contact.',409,'WEBVIEW_INVITE_EXISTS');
    const row=(await client.query(`SELECT v.*,b.name AS business_name,f.status AS flow_status,f.endpoint_phone_id,f.endpoint_uri,p.phone_number_id,p.registration_state,
        a.status AS account_status,a.waba_id,a.access_token_encrypted,c.phone AS customer_phone,c.last_message_at,c.unsubscribed,
        cv.id AS conversation_id,cv.whatsapp_phone_number_id AS conversation_phone_id
      FROM whatsapp_webviews v JOIN businesses b ON b.id=v.business_id JOIN whatsapp_native_flows f ON f.id=v.flow_id AND f.business_id=v.business_id
      JOIN flow_runtime_configs r ON r.flow_id=f.id AND r.business_id=f.business_id
      JOIN whatsapp_phone_numbers p ON p.id=v.phone_id AND p.business_id=v.business_id
      JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=v.business_id
      JOIN contacts c ON c.id=$3 AND c.business_id=v.business_id
      JOIN conversations cv ON cv.contact_id=c.id AND cv.business_id=c.business_id
      JOIN businesses b ON b.id=v.business_id
      WHERE v.business_id=$1 AND v.id=$2 AND v.enabled AND r.config->>'enabled'='true' AND b.account_status<>'suspended'
      FOR SHARE OF v,f,r,p,a,c,cv,b`,[businessId,targetViewId,contactId])).rows[0];
    if(!row||row.flow_status!=='published'||row.endpoint_phone_id!==row.phone_id||row.registration_state!=='registered'||row.account_status!=='connected'||row.conversation_phone_id!==row.phone_number_id||row.unsubscribed||!okToReply(row)||!isManagedRuntimeEndpoint({id:row.flow_id,endpoint_uri:row.endpoint_uri})||row.button_label.length>20)throw new AppError('This contact or transactional page is not ready for a WhatsApp invitation.',409,'WEBVIEW_SEND_UNAVAILABLE');
    const runtime=await createRuntimeSession({businessId,flowId:row.flow_id,contactId,phoneId:row.phone_id,flowToken:token,expiresMinutes:row.expires_hours*60},async work=>work(client));
    const newInviteId=id('wvi');
    await client.query("INSERT INTO whatsapp_webview_invites(id,business_id,webview_id,runtime_session_id,contact_id,request_id,fingerprint,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()+$9::int*INTERVAL '1 hour')",[newInviteId,businessId,targetViewId,runtime.sessionId,contactId,operationId,fingerprint,hash(token),row.expires_hours]);
    return {inviteId:newInviteId,row,url:safeUrl(targetViewId,token)};
  });
  const {row,url,inviteId:newInviteId}=prepared;
  let sent;
  try{sent=await sendCtaUrlMessage({setup:{phone_number_id:row.phone_number_id,waba_id:row.waba_id,access_token_encrypted:row.access_token_encrypted},to:row.customer_phone,body:row.prefilled_message,cta:row.button_label,url,headerText:row.business_name||''});}
  catch(error){
    const definitive=error.code==='META_SEND_FAILED'&&error.status>=400&&error.status<500&&![408,409,429].includes(error.status);
    await query("UPDATE whatsapp_webview_invites SET status=$1 WHERE business_id=$2 AND id=$3 AND status='processing'",[definitive?'failed':'unconfirmed',businessId,newInviteId]);
    throw error;
  }
  await transaction(async client=>{
    await client.query("UPDATE whatsapp_webview_invites SET status='sent',meta_message_id=$1 WHERE business_id=$2 AND id=$3",[sent.metaMessageId,businessId,newInviteId]);
    await client.query("INSERT INTO messages(id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES($1,$2,'outgoing',$3,$4,$5,'interactive',$6)",[id('m'),row.conversation_id,row.prefilled_message,sent.status,sent.metaMessageId,JSON.stringify({webviewInviteId:newInviteId,webviewId:targetViewId})]);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),businessId,userId,'whatsapp_webview_sent',JSON.stringify({inviteId:newInviteId,viewId:targetViewId,contactId})]);
    await recordSupportResponse(businessId,row.conversation_id,new Date(),client);
  });
  return {inviteId:newInviteId,status:'sent'};
}

export async function resolveWebviewInvite({businessId,userId,inviteId:targetId,resolution}){
  if(!inviteId(targetId)||!['sent','not_sent'].includes(resolution))throw new AppError('Choose an unconfirmed invitation and verified outcome.',400,'WEBVIEW_REVIEW_INVALID');
  await transaction(async client=>{
    const row=(await client.query("UPDATE whatsapp_webview_invites SET status=$1 WHERE id=$2 AND business_id=$3 AND status='unconfirmed' RETURNING id,runtime_session_id,webview_id,contact_id",[resolution==='sent'?'sent':'failed',targetId,businessId])).rows[0];
    if(!row)throw new AppError('Unconfirmed invitation not found.',404,'NOT_FOUND');
    if(resolution==='not_sent')await client.query('UPDATE flow_runtime_sessions SET expires_at=NOW() WHERE id=$1 AND business_id=$2',[row.runtime_session_id,businessId]);
    await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)',[id('a'),businessId,userId,'whatsapp_webview_delivery_reviewed',JSON.stringify({inviteId:row.id,viewId:row.webview_id,contactId:row.contact_id,resolution})]);
  });
}

export async function publicWebviewExchange(request,{viewId:targetViewId}){
  try{
    assertRequestOrigin(request);
    const body=await readJsonBodyLimited(request,4096);
    if(!viewId(targetViewId)||!tokenShape(body.session)||!['load','reserve','confirm','cancel'].includes(body.action))throw new AppError('This page session is invalid.',404,'WEBVIEW_SESSION_INVALID');
    if(body.action==='reserve'&&(!/^frr_[a-f0-9]{16}$/.test(body.resourceId||'')||!Number.isInteger(body.quantity)||body.quantity<1||body.quantity>1000)||body.action!=='load'&&!requestId(body.requestId))throw new AppError('Select an available item and a unique operation reference.',400,'WEBVIEW_ACTION_INVALID');
    await enforceRequestRateLimit(request,hash(body.session),'api');
    enterSystemContext();
    return json(await transaction(async client=>{
      const row=(await client.query(`SELECT i.id,i.business_id,i.expires_at,v.title,v.description,v.flow_id,v.enabled,
        s.screen,s.completed,r.config,r.revision,b.account_status,p.registration_state,a.status AS phone_account_status,
        ct.unsubscribed
        FROM whatsapp_webview_invites i JOIN whatsapp_webviews v ON v.id=i.webview_id AND v.business_id=i.business_id
        JOIN flow_runtime_sessions s ON s.id=i.runtime_session_id AND s.business_id=i.business_id
        JOIN flow_runtime_configs r ON r.flow_id=v.flow_id AND r.business_id=v.business_id
        JOIN businesses b ON b.id=i.business_id
        JOIN whatsapp_phone_numbers p ON p.id=v.phone_id AND p.business_id=v.business_id
        JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=v.business_id
        JOIN contacts ct ON ct.id=i.contact_id AND ct.business_id=i.business_id
        WHERE i.webview_id=$1 AND i.token_hash=$2 AND i.status IN ('sent','unconfirmed') AND i.expires_at>NOW() AND s.expires_at>NOW()
        FOR SHARE OF i,v,r,b,p,a,ct`,[targetViewId,hash(body.session)])).rows[0];
      if(!row||!row.enabled||!row.config?.enabled||row.account_status==='suspended'||row.registration_state!=='registered'||row.phone_account_status!=='connected'||row.unsubscribed||!(await workspaceFeatureFlags(row.business_id,client.query.bind(client))).webviews)throw new AppError('This page session expired or is unavailable.',404,'WEBVIEW_SESSION_UNAVAILABLE');
      const base={title:row.title,description:row.description,mode:row.config.mode};
      if(row.completed){
        const completed=(await client.query("SELECT id,order_id,status FROM flow_runtime_reservations WHERE business_id=$1 AND session_id=(SELECT runtime_session_id FROM whatsapp_webview_invites WHERE id=$2) AND status IN ('confirmed','pending_external') ORDER BY created_at DESC LIMIT 1",[row.business_id,row.id])).rows[0];
        return {...base,state:'complete',outcome:completed?{reservationId:completed.id,orderId:completed.order_id,status:completed.status}:null};
      }
      if(body.action==='load'&&row.screen!==row.config.initialScreen){
        const held=(await client.query("SELECT id,quantity,snapshot,expires_at FROM flow_runtime_reservations WHERE business_id=$1 AND session_id=(SELECT runtime_session_id FROM whatsapp_webview_invites WHERE id=$2) AND status='held' AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1",[row.business_id,row.id])).rows[0];
        if(held)return {...base,state:'review',reservation:{id:held.id,quantity:held.quantity,...held.snapshot,expiresAt:held.expires_at}};
        await client.query("UPDATE flow_runtime_reservations SET status='expired' WHERE business_id=$1 AND session_id=(SELECT runtime_session_id FROM whatsapp_webview_invites WHERE id=$2) AND status='held' AND expires_at<=NOW()",[row.business_id,row.id]);
        await client.query('UPDATE flow_runtime_sessions SET screen=$1 WHERE business_id=$2 AND id=(SELECT runtime_session_id FROM whatsapp_webview_invites WHERE id=$3) AND completed=FALSE',[row.config.initialScreen,row.business_id,row.id]);
        row.screen=row.config.initialScreen;
      }
      const operation=body.action==='load'?'list':body.action;
      const payload={version:'3.0',action:body.action==='load'?'INIT':'data_exchange',screen:row.screen,flow_token:body.session,...(body.action==='load'?{}:{data:{operation,request_id:body.requestId,...(operation==='reserve'?{resource_id:body.resourceId,quantity:body.quantity}:{})}})};
      const result=await handleRuntimeExchange({businessId:row.business_id,flowId:row.flow_id,payload},async work=>work(client));
      if(operation==='reserve')return {...base,state:'review',reservation:{id:result.data.reservation_id,quantity:result.data.quantity,title:result.data.title,unit_price:result.data.unit_price,currency:result.data.currency,starts_at:result.data.starts_at,ends_at:result.data.ends_at,expiresAt:result.data.expires_at}};
      if(operation==='confirm')return {...base,state:'complete',outcome:{reservationId:result.data.extension_message_response?.params?.reservation_id||null,orderId:result.data.extension_message_response?.params?.order_id||null,status:result.data.fulfillment_status}};
      return {...base,state:'choose',resources:result.data.resources};
    }));
  }catch(error){return errorJson(error);}
}
