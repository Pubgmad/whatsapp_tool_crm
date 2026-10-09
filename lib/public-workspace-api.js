import crypto from 'node:crypto';
import {AppError,errorJson,id,json,query,transaction} from './db.js';
import {authenticateWorkspaceApi} from './workspace-integrations.js';
import {readJsonBodyLimited} from './security.js';
import {clean,cleanPhone,mapContact,mapTemplate,normalizeAttributes,normalizeTags,renderTemplate} from './workspace-mappers.js';
import {assertContactCapacity,assertMessageCapacity} from './limits.js';
import {messagingSetupForContact} from './messaging-setup.js';
import {sendTemplateMessage,templateApiName} from './meta.js';
import {validateTemplateParameters} from './template-send-components.js';
import {okToReply} from './reply-window.js';
import {operationalPolicy} from './operational-policy.js';

const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const stableJson=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
function requestReference(request){
  const value=request.headers.get('idempotency-key');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(value||''))throw new AppError('Provide a unique Idempotency-Key (16-100 letters, numbers, underscores, or hyphens).',400,'INTEGRATION_IDEMPOTENCY_REQUIRED');
  return value;
}
function responseFromSaved(row){
  if(!row.response_status){
    const reconciliation=['provider_accepted','unconfirmed'].includes(row.dispatch_status)||(row.dispatch_status==='sending'&&Date.now()-new Date(row.updated_at).getTime()>operationalPolicy().integrationDispatchWindowSeconds*1000);
    const error=new AppError(reconciliation?'The provider outcome requires reconciliation; this request will not be sent again.':'A request with this idempotency key is already processing.',409,reconciliation?'INTEGRATION_RECONCILIATION_REQUIRED':'INTEGRATION_REQUEST_IN_PROGRESS');
    error.retryAfter=reconciliation?undefined:2;throw error;
  }
  return json(row.response_body||{},row.response_status,{'Idempotency-Replayed':'true'});
}
async function lockRequest(client,key,requestId){
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[key.business_id,requestId]);
}
async function existingRequest(client,key,requestId,fingerprint,operation){
  const row=(await client.query('SELECT * FROM workspace_api_requests WHERE business_id=$1 AND id=$2 FOR UPDATE',[key.business_id,requestId])).rows[0];
  if(!row)return null;
  if(row.fingerprint!==fingerprint||row.operation!==operation)throw new AppError('This idempotency key was used with different inputs.',409,'INTEGRATION_REFERENCE_MISMATCH');
  if(row.dispatch_status==='reserved'&&Date.now()-new Date(row.updated_at).getTime()>operationalPolicy().integrationReservationTtlSeconds*1000){await client.query('DELETE FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[key.business_id,requestId]);return null;}
  return row;
}
function publicVariables(input){
  if(input===undefined)return {};
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>100)throw new AppError('Template variables must be an object with up to 100 fields.',400,'INTEGRATION_VARIABLES_INVALID');
  return Object.fromEntries(Object.entries(input).map(([key,value])=>{
    if(!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)||['__proto__','prototype','constructor'].includes(key)||!['string','number','boolean'].includes(typeof value))throw new AppError('Template variables must use safe names and scalar values.',400,'INTEGRATION_VARIABLES_INVALID');
    return [key,String(value).slice(0,2000)];
  }));
}
async function senderPhone(client,businessId,phoneNumberId=''){
  const result=await client.query(`SELECT p.phone_number_id FROM whatsapp_phone_numbers p
    JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
    WHERE p.business_id=$1 AND ($2='' OR p.phone_number_id=$2) AND a.status='connected'
      AND p.registration_state='registered' AND COALESCE(a.access_token_encrypted,'')<>''
      AND (a.token_expires_at IS NULL OR a.token_expires_at>NOW())
    ORDER BY CASE WHEN p.phone_number_id=$2 AND $2<>'' THEN 0 WHEN p.is_default THEN 1 ELSE 2 END,p.created_at LIMIT 1`,[businessId,clean(phoneNumberId)]);
  if(!result.rows[0])throw new AppError('Connect an eligible WhatsApp number or provide a connected phoneNumberId.',409,'META_NOT_CONFIGURED');
  return result.rows[0].phone_number_id;
}
async function ensureConversation(client,businessId,contactId,phoneNumberId=''){
  const selected=await senderPhone(client,businessId,phoneNumberId);
  const row=(await client.query(`INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id)
    VALUES ($1,$2,$3,$4) ON CONFLICT (business_id,contact_id) DO UPDATE SET
      whatsapp_phone_number_id=CASE WHEN $5<>'' THEN EXCLUDED.whatsapp_phone_number_id ELSE conversations.whatsapp_phone_number_id END,
      updated_at=NOW() RETURNING *`,[id('v'),businessId,contactId,selected,clean(phoneNumberId)])).rows[0];
  if(row.whatsapp_phone_number_id!==selected&&phoneNumberId)throw new AppError('Conversation is bound to another WhatsApp number.',409,'META_SOURCE_MISMATCH');
  return row;
}
async function upsertInlineContact(key,input){
  if(!key.scopes?.includes('contacts:write'))throw new AppError('Creating a send recipient requires contacts:write permission.',403,'INTEGRATION_SCOPE_REQUIRED');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(name=>!['name','phone','source','tags','customAttributes','marketingPermission','optInSource','consentEvidence','reconfirmOptIn'].includes(name)))throw new AppError('Provide a valid contact object.',400,'INTEGRATION_INVALID');
  const name=clean(input.name),phone=cleanPhone(input.phone),source=clean(input.source||'API template send'),tags=normalizeTags(input.tags),attributes=normalizeAttributes(input.customAttributes);
  const permissionProvided=typeof input.marketingPermission==='boolean',permission=input.marketingPermission===true,optInSource=clean(input.optInSource),evidence=clean(input.consentEvidence);
  if(!name||name.length>200||!/^\+\d{7,15}$/.test(phone)||source.length>255)throw new AppError('Provide a valid recipient name, E.164 phone, and source.',400,'INTEGRATION_INVALID');
  if(permission&&(!optInSource||evidence.length<10||evidence.length>2000))throw new AppError('Marketing permission requires a consent source and specific evidence.',400,'CONSENT_EVIDENCE_REQUIRED');
  return transaction(async client=>{
    await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[key.business_id]);
    const existing=(await client.query('SELECT * FROM contacts WHERE business_id=$1 AND phone=$2 FOR UPDATE',[key.business_id,phone])).rows[0];
    if(!existing)await assertContactCapacity(key.business_id,1,client);
    if(existing?.unsubscribed&&(!permission||input.reconfirmOptIn!==true))throw new AppError('This recipient opted out. Record explicit new consent before restoring it.',409,'CONSENT_RECONFIRM_REQUIRED');
    const restore=Boolean(existing?.unsubscribed&&permission&&input.reconfirmOptIn===true);
    const contact=(await client.query(`INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed,source,tags,custom_attributes,opt_in_at,opt_in_source)
      VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8,CASE WHEN $5 THEN NOW() ELSE NULL END,$9)
      ON CONFLICT (business_id,phone) DO UPDATE SET name=EXCLUDED.name,source=EXCLUDED.source,
        tags=CASE WHEN $12 THEN EXCLUDED.tags ELSE contacts.tags END,
        custom_attributes=CASE WHEN $13 THEN contacts.custom_attributes||EXCLUDED.custom_attributes ELSE contacts.custom_attributes END,
        marketing_permission=CASE WHEN NOT $11 THEN contacts.marketing_permission WHEN contacts.unsubscribed AND NOT $10 THEN FALSE ELSE EXCLUDED.marketing_permission END,
        unsubscribed=CASE WHEN $10 THEN FALSE ELSE contacts.unsubscribed END,
        opt_in_at=CASE WHEN $11 AND EXCLUDED.marketing_permission AND (NOT contacts.unsubscribed OR $10) THEN NOW() ELSE contacts.opt_in_at END,
        opt_in_source=CASE WHEN $11 AND EXCLUDED.marketing_permission AND (NOT contacts.unsubscribed OR $10) THEN EXCLUDED.opt_in_source ELSE contacts.opt_in_source END,
        updated_at=NOW() RETURNING *`,[id('c'),key.business_id,name,phone,permission,source,JSON.stringify(tags),JSON.stringify(attributes),optInSource||source,restore,permissionProvided,input.tags!==undefined,input.customAttributes!==undefined])).rows[0];
    if(permission&&contact.marketing_permission)await client.query('INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',[id('cce'),key.business_id,contact.id,key.created_by,optInSource,evidence]);
    return contact;
  });
}

export async function upsertPublicContact(request){
  try{
    const key=await authenticateWorkspaceApi(request,'contacts:write'),requestId=requestReference(request),body=await readJsonBodyLimited(request,32768);
    if(Object.keys(body).some(name=>!['name','phone','source','tags','customAttributes','marketingPermission','optInSource','consentEvidence','reconfirmOptIn','phoneNumberId'].includes(name)))throw new AppError('Contact request contains unsupported fields.',400,'INTEGRATION_INVALID');
    const name=clean(body.name),phone=cleanPhone(body.phone),source=clean(body.source||'Public API'),tags=normalizeTags(body.tags),attributes=normalizeAttributes(body.customAttributes);
    const permissionProvided=typeof body.marketingPermission==='boolean',permission=body.marketingPermission===true,optInSource=clean(body.optInSource),evidence=clean(body.consentEvidence);
    if(!name||name.length>200||!/^\+\d{7,15}$/.test(phone)||!source||source.length>255)throw new AppError('Provide a valid name, E.164 phone, and lead source.',400,'INTEGRATION_INVALID');
    if(permission&&(!optInSource||optInSource.length>255||evidence.length<10||evidence.length>2000))throw new AppError('Marketing permission requires a consent source and specific evidence.',400,'CONSENT_EVIDENCE_REQUIRED');
    const operation='contact.upsert',fingerprint=digest(JSON.stringify([key.id,operation,{name,phone,source,tags,attributes,permission,permissionProvided,tagsProvided:body.tags!==undefined,attributesProvided:body.customAttributes!==undefined,optInSource,evidence,reconfirmOptIn:body.reconfirmOptIn===true,phoneNumberId:clean(body.phoneNumberId)}]));
    const result=await transaction(async client=>{
      await lockRequest(client,key,requestId);
      const prior=await existingRequest(client,key,requestId,fingerprint,operation);if(prior)return {prior};
      await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[key.business_id]);
      const existing=(await client.query('SELECT * FROM contacts WHERE business_id=$1 AND phone=$2 FOR UPDATE',[key.business_id,phone])).rows[0];
      if(!existing)await assertContactCapacity(key.business_id,1,client);
      if(existing?.unsubscribed&&permission&&body.reconfirmOptIn!==true)throw new AppError('Set reconfirmOptIn with new consent evidence to restore an opted-out contact.',409,'CONSENT_RECONFIRM_REQUIRED');
      const restore=Boolean(existing?.unsubscribed&&permission&&body.reconfirmOptIn===true);
      const contact=(await client.query(`INSERT INTO contacts (id,business_id,name,phone,marketing_permission,unsubscribed,source,tags,custom_attributes,opt_in_at,opt_in_source)
        VALUES ($1,$2,$3,$4,$5,FALSE,$6,$7,$8,CASE WHEN $5 THEN NOW() ELSE NULL END,$9)
        ON CONFLICT (business_id,phone) DO UPDATE SET name=EXCLUDED.name,source=EXCLUDED.source,
          custom_attributes=CASE WHEN $13 THEN contacts.custom_attributes||EXCLUDED.custom_attributes ELSE contacts.custom_attributes END,
          tags=CASE WHEN $12 THEN EXCLUDED.tags ELSE contacts.tags END,
          marketing_permission=CASE WHEN NOT $11 THEN contacts.marketing_permission WHEN contacts.unsubscribed AND NOT $10 THEN FALSE ELSE EXCLUDED.marketing_permission END,
          unsubscribed=CASE WHEN $10 THEN FALSE ELSE contacts.unsubscribed END,
          opt_in_at=CASE WHEN $11 AND EXCLUDED.marketing_permission AND (NOT contacts.unsubscribed OR $10) THEN NOW() ELSE contacts.opt_in_at END,
          opt_in_source=CASE WHEN $11 AND EXCLUDED.marketing_permission AND (NOT contacts.unsubscribed OR $10) THEN EXCLUDED.opt_in_source ELSE contacts.opt_in_source END,
          updated_at=NOW() RETURNING *`,[id('c'),key.business_id,name,phone,permission,source,JSON.stringify(tags),JSON.stringify(attributes),optInSource||source,restore,permissionProvided,body.tags!==undefined,body.customAttributes!==undefined])).rows[0];
      if(permission&&contact.marketing_permission)await client.query('INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())',[id('cce'),key.business_id,contact.id,key.created_by,optInSource,evidence]);
      const conversation=await ensureConversation(client,key.business_id,contact.id,body.phoneNumberId);
      const response={ok:true,created:!existing,contact:mapContact(contact),conversationId:conversation.id};
      await client.query('INSERT INTO workspace_api_requests (id,business_id,key_id,fingerprint,operation,resource_id,response_status,response_body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[requestId,key.business_id,key.id,fingerprint,operation,contact.id,existing?200:201,JSON.stringify(response)]);
      await client.query('UPDATE workspace_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_contact_upserted',$4)",[id('a'),key.business_id,key.created_by,JSON.stringify({keyId:key.id,contactId:contact.id,source,restoredOptIn:restore})]);
      return {response,status:existing?200:201};
    });
    return result.prior?responseFromSaved(result.prior):json(result.response,result.status);
  }catch(error){return errorJson(error);}
}

export async function listPublicContacts(request){
  try{
    const key=await authenticateWorkspaceApi(request,'contacts:read'),url=new URL(request.url),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),cursor=clean(url.searchParams.get('cursor'));
    const rows=(await query(`SELECT * FROM contacts WHERE business_id=$1 AND ($2='' OR id>$2) ORDER BY id LIMIT $3`,[key.business_id,cursor,limit+1])).rows;
    const hasMore=rows.length>limit,data=rows.slice(0,limit);
    await query('UPDATE workspace_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);
    return json({data:data.map(mapContact),nextCursor:hasMore?data.at(-1).id:null});
  }catch(error){return errorJson(error);}
}

export async function listPublicTemplates(request){
  try{
    const key=await authenticateWorkspaceApi(request,'templates:read'),url=new URL(request.url),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50));
    const rows=(await query("SELECT * FROM templates WHERE business_id=$1 AND status='Approved' ORDER BY name,id LIMIT $2",[key.business_id,limit])).rows;
    await query('UPDATE workspace_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);
    return json({data:rows.map(mapTemplate)});
  }catch(error){return errorJson(error);}
}

export async function sendPublicTemplate(request){
  let key,requestId,fingerprint,reserved=false,dispatchStarted=false,providerAccepted=false,leaseToken='';
  try{
    key=await authenticateWorkspaceApi(request,'messages:template:send');requestId=requestReference(request);
    const body=await readJsonBodyLimited(request,65536);
    if(Object.keys(body).some(name=>!['contactId','phone','contact','templateId','variables','parameters','phoneNumberId'].includes(name)))throw new AppError('Template request contains unsupported fields.',400,'INTEGRATION_INVALID');
    const variables=publicVariables(body.variables);
    fingerprint=digest(stableJson([key.id,'template.send',body]));
    leaseToken=crypto.randomBytes(16).toString('hex');
    const prior=await transaction(async client=>{
      await lockRequest(client,key,requestId);
      const existing=await existingRequest(client,key,requestId,fingerprint,'template.send');if(existing)return existing;
      await client.query("INSERT INTO workspace_api_requests (id,business_id,key_id,fingerprint,operation,dispatch_status,request_payload,lease_token) VALUES ($1,$2,$3,$4,'template.send','reserved',$5,$6)",[requestId,key.business_id,key.id,fingerprint,JSON.stringify(body),leaseToken]);
      return null;
    });
    if(prior)return responseFromSaved(prior);reserved=true;
    let contact=body.contact?await upsertInlineContact(key,body.contact):(await query('SELECT * FROM contacts WHERE business_id=$1 AND (id=$2 OR ($2=\'\' AND phone=$3))',[key.business_id,clean(body.contactId),cleanPhone(body.phone)])).rows[0];
    if(!contact)throw new AppError('Contact not found. Provide contact details or upsert it before sending.',404,'NOT_FOUND');
    if(contact.unsubscribed)throw new AppError('Contact opted out of WhatsApp messages.',409,'AUTOMATION_OPTED_OUT');
    const template=(await query("SELECT * FROM templates WHERE business_id=$1 AND id=$2 AND status='Approved'",[key.business_id,clean(body.templateId)])).rows[0];
    if(!template)throw new AppError('Approved template not found.',404,'TEMPLATE_NOT_FOUND');
    validateTemplateParameters(template,body.parameters||{});
    const consent=(await query(`SELECT EXISTS(SELECT 1 FROM contact_consent_events ce WHERE ce.business_id=$1 AND ce.contact_id=$2
      AND ce.source=$3 AND ce.occurred_at>=c.opt_in_at AND LENGTH(ce.evidence)>=10) AS recorded FROM contacts c WHERE c.id=$2 AND c.business_id=$1`,[key.business_id,contact.id,contact.opt_in_source])).rows[0]?.recorded;
    const marketing=String(template.category).toUpperCase()==='MARKETING';
    if((marketing&&!contact.marketing_permission)||((marketing||!okToReply(contact))&&!consent))throw new AppError('Recorded WhatsApp opt-in is required for this template send.',403,'AUTOMATION_CONSENT_REQUIRED');
    await assertMessageCapacity(key.business_id,1,null,contact.id);
    await transaction(async client=>{await ensureConversation(client,key.business_id,contact.id,body.phoneNumberId);});
    const setup=await messagingSetupForContact(key.business_id,contact.id);
    if((template.waba_id&&template.waba_id!==setup.waba_id)||(!template.waba_id&&setup.waba_id!==setup.default_waba_id))throw new AppError('Template belongs to another WhatsApp account.',409,'TEMPLATE_WABA_MISMATCH');
    const claimed=await query("UPDATE workspace_api_requests SET dispatch_status='sending',resource_id=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 AND dispatch_status='reserved' AND lease_token=$4 RETURNING id",[contact.id,key.business_id,requestId,leaseToken]);
    if(!claimed.rowCount)throw new AppError('This idempotent request lease was superseded.',409,'INTEGRATION_LEASE_LOST');
    dispatchStarted=true;
    const meta=await sendTemplateMessage({setup,to:contact.phone,templateName:template.meta_template_name||templateApiName(template.name),language:template.language,parameters:body.parameters||{},variables:(template.variables||[]).map(name=>name==='name'?contact.name:variables[name]||'')});
    providerAccepted=true;
    await query("UPDATE workspace_api_requests SET dispatch_status='provider_accepted',provider_message_id=$1,updated_at=NOW() WHERE business_id=$2 AND id=$3 AND lease_token=$4",[meta.metaMessageId,key.business_id,requestId,leaseToken]);
    const messageBody=renderTemplate(template.body,mapContact(contact),variables),messageId=id('m');
    const response=await transaction(async client=>{
      const conversation=await ensureConversation(client,key.business_id,contact.id,body.phoneNumberId);
      await client.query('UPDATE conversations SET updated_at=NOW(),version=version+1 WHERE id=$1',[conversation.id]);
      await client.query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type,metadata) VALUES ($1,$2,'outgoing',$3,$4,$5,'template',$6)",[messageId,conversation.id,messageBody,meta.status,meta.metaMessageId,JSON.stringify({templateId:template.id,requestId})]);
      const payload={ok:true,messageId,metaMessageId:meta.metaMessageId,status:meta.status,contactId:contact.id,conversationId:conversation.id};
      await client.query("UPDATE workspace_api_requests SET resource_id=$1,response_status=202,response_body=$2,dispatch_status='completed',updated_at=NOW() WHERE business_id=$3 AND id=$4 AND lease_token=$5",[messageId,JSON.stringify(payload),key.business_id,requestId,leaseToken]);
      await client.query('UPDATE workspace_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_template_sent',$4)",[id('a'),key.business_id,key.created_by,JSON.stringify({keyId:key.id,contactId:contact.id,templateId:template.id,messageId})]);
      return payload;
    });
    return json(response,202);
  }catch(error){
    if(reserved&&key&&requestId){
      if(!dispatchStarted)await query('DELETE FROM workspace_api_requests WHERE business_id=$1 AND id=$2 AND dispatch_status=\'reserved\' AND lease_token=$3',[key.business_id,requestId,leaseToken]).catch(()=>{});
      else if(!providerAccepted){
        const status=error?.code==='META_SEND_UNCONFIRMED'?'unconfirmed':'failed',responseStatus=Number(error?.status)||500;
        await query('UPDATE workspace_api_requests SET dispatch_status=$1,error_code=$2,response_status=$3,response_body=$4,updated_at=NOW() WHERE business_id=$5 AND id=$6 AND lease_token=$7',[status,error?.code||'SERVER_ERROR',responseStatus,JSON.stringify({error:responseStatus>=500?'Something went wrong.':error.message,code:error?.code||'SERVER_ERROR'}),key.business_id,requestId,leaseToken]).catch(()=>{});
      }
    }
    return errorJson(error);
  }
}
