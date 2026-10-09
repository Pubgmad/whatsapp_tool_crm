import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext,enterTenantContext} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,enforceRequestRateLimit} from './security.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';
import {operationalPolicy} from './operational-policy.js';

export const INTEGRATION_SCOPES=Object.freeze(['contacts:read','contacts:write','templates:read','messages:template:send','workflows:execute']);
export const INTEGRATION_EVENT_TYPES=Object.freeze(['campaign_sent','campaign_queued','campaign_pending_review','incoming_message','unsubscribe','automation_step_sent','automation_step_scheduled','whatsapp_order_received','whatsapp_order_fulfillment','whatsapp_payment_captured','whatsapp_flow_completed','whatsapp_flow_booking_pending','whatsapp_flow_booking_confirmed','whatsapp_flow_booking_cancelled','interactive_button_reply','meta_leadgen_ingested','commerce_message_sent','meta_configuration_update']);
const eventTypes=new Set(INTEGRATION_EVENT_TYPES);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const blocked=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(network,prefix,'ipv4');
export function publicWebhookAddress(address){return isIP(address)===4&&!blocked.check(address,'ipv4');}
function normalizeScopes(value){
  const scopes=[...new Set(Array.isArray(value)?value:[])];
  if(!scopes.length||scopes.some(scope=>!INTEGRATION_SCOPES.includes(scope)))throw new AppError('Select valid API permissions.',400,'INTEGRATION_SCOPES_INVALID');
  return scopes;
}
function normalizeIpAllowlist(value){
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>50)throw new AppError('Provide up to 50 IP addresses or CIDR ranges.',400,'INTEGRATION_IP_ALLOWLIST_INVALID');
  return [...new Set(value.map(item=>String(item||'').trim()).filter(Boolean).map(item=>{
    const [address,prefixText,...extra]=item.split('/'),family=isIP(address),prefix=prefixText===undefined?null:Number(prefixText),maximum=family===4?32:128;
    if(extra.length||!family||(prefix!==null&&(!Number.isInteger(prefix)||prefix<0||prefix>maximum)))throw new AppError('IP allowlist entries must be valid IPv4, IPv6, or CIDR values.',400,'INTEGRATION_IP_ALLOWLIST_INVALID');
    return prefix===null?address:`${address}/${prefix}`;
  }))];
}
function ipAllowed(ip,allowlist){
  if(!allowlist?.length)return true;
  const family=isIP(ip);if(!family)return false;
  const list=new BlockList();
  for(const item of allowlist){const [address,prefix]=item.split('/'),entryFamily=isIP(address);if(prefix===undefined)list.addAddress(address,entryFamily===4?'ipv4':'ipv6');else list.addSubnet(address,Number(prefix),entryFamily===4?'ipv4':'ipv6');}
  return list.check(ip,family===4?'ipv4':'ipv6');
}
function apiRequestIp(request){
  const header=String(process.env.WORKSPACE_API_CLIENT_IP_HEADER||'').trim().toLowerCase();
  if(!['x-real-ip','cf-connecting-ip','fly-client-ip','true-client-ip'].includes(header))return 'unknown';
  const value=String(request.headers.get(header)||'').trim();
  return isIP(value)?value:'unknown';
}
async function enforceKeyRateLimit(key){
  const policy=operationalPolicy();
  const bucket=digest(`workspace-key:${key.id}:${Math.floor(Date.now()/60000)}`);
  const result=await query(`INSERT INTO rate_limits (id,bucket_key,hits,reset_at) VALUES ($1,$2,1,date_trunc('minute',NOW())+INTERVAL '1 minute')
    ON CONFLICT (bucket_key) DO UPDATE SET hits=rate_limits.hits+1,updated_at=NOW() RETURNING hits,reset_at`,[id('rl'),bucket]);
  if(Number(result.rows[0].hits)>Number(key.rate_limit_per_minute||policy.workspaceApiKeyRpm)){const error=new AppError('API key rate limit exceeded.',429,'INTEGRATION_RATE_LIMITED');error.retryAfter=Math.max(1,Math.ceil((new Date(result.rows[0].reset_at)-Date.now())/1000));throw error;}
}
function normalizeWorkflowVariables(value){
  if(value===undefined)return {};
  if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(JSON.stringify(value),'utf8')>8192)throw new AppError('Workflow variables must be an object up to 8 KB.',400,'INTEGRATION_VARIABLES_INVALID');
  const sanitize=(input,depth=0)=>{
    if(depth>3)throw new AppError('Workflow variables may be nested up to three levels.',400,'INTEGRATION_VARIABLES_INVALID');
    if(input===null||typeof input==='boolean'||typeof input==='number')return input;
    if(typeof input==='string')return input.slice(0,2000);
    if(Array.isArray(input)){if(input.length>50)return input.slice(0,50).map(item=>sanitize(item,depth+1));return input.map(item=>sanitize(item,depth+1));}
    if(typeof input!=='object')throw new AppError('Workflow variables contain an unsupported value.',400,'INTEGRATION_VARIABLES_INVALID');
    const entries=Object.entries(input);
    if(entries.length>100)throw new AppError('Workflow variables contain too many fields.',400,'INTEGRATION_VARIABLES_INVALID');
    return Object.fromEntries(entries.map(([key,item])=>{
      if(!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)||['__proto__','prototype','constructor'].includes(key))throw new AppError('Workflow variable names are invalid.',400,'INTEGRATION_VARIABLES_INVALID');
      return [key,sanitize(item,depth+1)];
    }));
  };
  return sanitize(value);
}
async function resolveWebhookHost(hostname){
  let timeout;
  try{return await Promise.race([dns.lookup(hostname,{all:true}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new AppError('Webhook DNS timed out.',504,'WEBHOOK_DNS_TIMEOUT')),5000);})]);}
  finally{clearTimeout(timeout);}
}
export function integrationWebhookUrl(value){
  let url;try{url=new URL(value);}catch{throw new AppError('Enter a valid webhook URL.',400,'WEBHOOK_URL_INVALID');}
  const hosts=String(process.env.WORKSPACE_WEBHOOK_ALLOWED_HOSTS||'').split(',').map(host=>host.trim().toLowerCase()).filter(Boolean);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||url.href.length>2000||isIP(url.hostname)||!hosts.includes(url.hostname.toLowerCase()))throw new AppError('Use HTTPS on a hostname approved by the platform owner.',400,'WEBHOOK_HOST_NOT_ALLOWED');
  return url;
}
export async function authenticateWorkspaceApi(request,requiredScope){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!/^[a-f0-9]{64}$/.test(token))throw new AppError('Invalid API credential.',401,'INTEGRATION_UNAUTHORIZED');
  enterSystemContext();
  const tokenHash=digest(token);
  const trustedIp=apiRequestIp(request);
  await enforceRequestRateLimit(request,'integration-auth:'+(trustedIp==='unknown'?tokenHash:trustedIp),'integration-auth',{identityOnly:true});
  const key=(await query(`SELECT k.*,b.account_status FROM workspace_api_keys k
    JOIN businesses b ON b.id=k.business_id
    WHERE (k.token_hash=$1 OR (k.previous_token_hash=$1 AND k.previous_token_valid_until>NOW()))
      AND k.revoked_at IS NULL AND k.active_from<=NOW() AND (k.expires_at IS NULL OR k.expires_at>NOW())
      AND b.account_status<>'suspended'
      AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr WHERE dr.business_id=b.id AND dr.status IN ('scheduled','pending_approval'))`,[tokenHash])).rows[0];
  if(!key)throw new AppError('Invalid, expired, or revoked API credential.',401,'INTEGRATION_UNAUTHORIZED');
  if(requiredScope&&!key.scopes?.includes(requiredScope))throw new AppError(`API credential lacks ${requiredScope} permission.`,403,'INTEGRATION_SCOPE_REQUIRED');
  if(!ipAllowed(apiRequestIp(request),key.ip_allowlist))throw new AppError('This API credential is not permitted from the trusted request IP.',403,'INTEGRATION_IP_DENIED');
  enterTenantContext(key.business_id);
  await enforceKeyRateLimit(key);
  await assertSubscriptionActive(await subscriptionUsage(key.business_id));
  return key;
}
export async function integrationSettings(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can manage integration credentials.',403,'FORBIDDEN');
    if(request.method==='GET'){
      const policy=operationalPolicy();
      const keys=(await query('SELECT id,name,allowed_flow_ids,scopes,active_from,expires_at,ip_allowlist,rate_limit_per_minute,previous_token_valid_until,revoked_at,last_used_at,created_at FROM workspace_api_keys WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows;
      const webhooks=(await query('SELECT id,url,event_types,enabled,schema_version,max_attempts,initial_backoff_seconds,previous_secret_valid_until,secret_rotated_at FROM workspace_webhooks WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows;
      const deliveries=(await query('SELECT id,event_id,webhook_id,status,attempts,response_status,error_code,run_at,delivered_at FROM workspace_webhook_deliveries WHERE business_id=$1 ORDER BY run_at DESC LIMIT 50',[session.businessId])).rows;
      const apiRequests=(await query("SELECT id,operation,dispatch_status,provider_message_id,error_code,created_at,updated_at FROM workspace_api_requests WHERE business_id=$1 AND (dispatch_status IN ('provider_accepted','unconfirmed') OR (dispatch_status='sending' AND updated_at<NOW()-($2::integer*INTERVAL '1 second'))) ORDER BY updated_at DESC LIMIT 50",[session.businessId,policy.integrationDispatchWindowSeconds])).rows;
      const flows=(await query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name",[session.businessId])).rows;
      return json({keys,webhooks,deliveries,apiRequests,flows,eventTypes:[...eventTypes],scopes:INTEGRATION_SCOPES,defaults:{keyExpiryDays:policy.workspaceApiKeyExpiryDays,keyRateLimitPerMinute:policy.workspaceApiKeyRpm,reconciliationWindowSeconds:policy.integrationDispatchWindowSeconds}});
    }
    const body=await readJsonBodyLimited(request,16384);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(body.action==='createKey'){
      const scopes=normalizeScopes(body.scopes||['workflows:execute']),flowIds=Array.isArray(body.flowIds)?body.flowIds:[],ipAllowlist=normalizeIpAllowlist(body.ipAllowlist);
      const policy=operationalPolicy();
      const expiresInDays=body.expiresInDays===null?null:Number(body.expiresInDays??policy.workspaceApiKeyExpiryDays),rateLimit=Number(body.rateLimitPerMinute??policy.workspaceApiKeyRpm);
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||flowIds.length>50||new Set(flowIds).size!==flowIds.length||flowIds.some(value=>typeof value!=='string')||(!Number.isInteger(rateLimit)||rateLimit<1||rateLimit>1000)||!(expiresInDays===null||(Number.isInteger(expiresInDays)&&expiresInDays>=1&&expiresInDays<=365)))throw new AppError('Provide valid key name, permissions, expiry, workflows, IP rules, and rate limit.',400,'INTEGRATION_INVALID');
      if(scopes.includes('workflows:execute')&&!flowIds.length)throw new AppError('Workflow keys require at least one allowed manual workflow.',400,'INTEGRATION_INVALID');
      const flows=flowIds.length?await query("SELECT id FROM automation_flows WHERE business_id=$1 AND id=ANY($2::text[]) AND status='active' AND trigger_mode='manual'",[session.businessId,flowIds]):{rowCount:0};
      if(flows.rowCount!==flowIds.length)throw new AppError('Select active manual workflows from this workspace.',400,'INTEGRATION_INVALID');
      const token=crypto.randomBytes(32).toString('hex'),keyId=id('key');
      await transaction(async client=>{
        await client.query(`INSERT INTO workspace_api_keys (id,business_id,created_by,name,token_hash,allowed_flow_ids,scopes,expires_at,ip_allowlist,rate_limit_per_minute)
          VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8::int IS NULL THEN NULL ELSE NOW()+($8::int*INTERVAL '1 day') END,$9,$10)`,[keyId,session.businessId,session.userId,body.name.trim(),digest(token),JSON.stringify(flowIds),JSON.stringify(scopes),expiresInDays,JSON.stringify(ipAllowlist),rateLimit]);
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_createKey',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:keyId,flowIds,scopes,expiresInDays,ipAllowlist,rateLimit})]);
      });
      return json({ok:true,id:keyId,token},201);
    }
    if(body.action==='revokeKey'){
      const result=await query('UPDATE workspace_api_keys SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 AND business_id=$2 RETURNING id',[body.id,session.businessId]);
      if(!result.rowCount)throw new AppError('API key not found.',404,'NOT_FOUND');
    }else if(body.action==='rotateKey'){
      const graceMinutes=Number(body.graceMinutes??60);
      if(!Number.isInteger(graceMinutes)||graceMinutes<0||graceMinutes>10080)throw new AppError('Rotation overlap must be between 0 and 10,080 minutes.',400,'INTEGRATION_INVALID');
      const token=crypto.randomBytes(32).toString('hex');
      const result=await query(`UPDATE workspace_api_keys SET previous_token_hash=token_hash,
        previous_token_valid_until=CASE WHEN $3::int=0 THEN NOW() ELSE NOW()+($3::int*INTERVAL '1 minute') END,
        token_hash=$4,last_used_at=NULL
        WHERE id=$1 AND business_id=$2 AND revoked_at IS NULL RETURNING id`,[body.id,session.businessId,graceMinutes,digest(token)]);
      if(!result.rowCount)throw new AppError('Active API key not found.',404,'NOT_FOUND');
      await query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_rotateKey',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:body.id,graceMinutes})]);
      return json({ok:true,id:body.id,token,previousValidForMinutes:graceMinutes});
    }else if(body.action==='updateKey'){
      const scopes=normalizeScopes(body.scopes),flowIds=Array.isArray(body.flowIds)?body.flowIds:[],ipAllowlist=normalizeIpAllowlist(body.ipAllowlist),rateLimit=Number(body.rateLimitPerMinute);
      if(flowIds.length>50||new Set(flowIds).size!==flowIds.length||flowIds.some(value=>typeof value!=='string')||!Number.isInteger(rateLimit)||rateLimit<1||rateLimit>1000||scopes.includes('workflows:execute')&&!flowIds.length)throw new AppError('Provide valid key permissions and limits.',400,'INTEGRATION_INVALID');
      const flows=flowIds.length?await query("SELECT id FROM automation_flows WHERE business_id=$1 AND id=ANY($2::text[]) AND status='active' AND trigger_mode='manual'",[session.businessId,flowIds]):{rowCount:0};
      if(flows.rowCount!==flowIds.length)throw new AppError('Select active manual workflows from this workspace.',400,'INTEGRATION_INVALID');
      const result=await query('UPDATE workspace_api_keys SET scopes=$3,allowed_flow_ids=$4,ip_allowlist=$5,rate_limit_per_minute=$6 WHERE id=$1 AND business_id=$2 AND revoked_at IS NULL RETURNING id',[body.id,session.businessId,JSON.stringify(scopes),JSON.stringify(flowIds),JSON.stringify(ipAllowlist),rateLimit]);
      if(!result.rowCount)throw new AppError('Active API key not found.',404,'NOT_FOUND');
    }else if(body.action==='createWebhook'){
      const url=integrationWebhookUrl(body.url);
      if(!Array.isArray(body.eventTypes)||!body.eventTypes.length||body.eventTypes.length>eventTypes.size||body.eventTypes.some(type=>!eventTypes.has(type)))throw new AppError('Select supported events.',400,'INTEGRATION_INVALID');
      const maxAttempts=Number(body.maxAttempts??8),initialBackoff=Number(body.initialBackoffSeconds??30);
      if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>20||!Number.isInteger(initialBackoff)||initialBackoff<5||initialBackoff>3600)throw new AppError('Webhook retry policy is outside safe limits.',400,'INTEGRATION_INVALID');
      const addresses=await resolveWebhookHost(url.hostname);
      if(!addresses.length||addresses.some(record=>!publicWebhookAddress(record.address)))throw new AppError('Webhook destinations must resolve only to public IPv4 addresses.',400,'WEBHOOK_ADDRESS_DENIED');
      const secret=crypto.randomBytes(32).toString('hex'),webhookId=id('hook');
      await transaction(async client=>{
        await client.query('INSERT INTO workspace_webhooks (id,business_id,url,event_types,signing_secret_encrypted,max_attempts,initial_backoff_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7)',[webhookId,session.businessId,url.href,JSON.stringify([...new Set(body.eventTypes)]),encryptSecret(secret),maxAttempts,initialBackoff]);
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_createWebhook',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:webhookId,eventTypes:body.eventTypes})]);
      });
      return json({ok:true,id:webhookId,signingSecret:secret},201);
    }else if(body.action==='toggleWebhook'){
      if(typeof body.enabled!=='boolean')throw new AppError('Specify enabled or disabled.',400,'INTEGRATION_INVALID');
      const result=await query('UPDATE workspace_webhooks SET enabled=$1 WHERE business_id=$2 AND id=$3 RETURNING id',[body.enabled,session.businessId,body.id]);
      if(!result.rowCount)throw new AppError('Webhook not found.',404,'NOT_FOUND');
    }else if(body.action==='rotateWebhookSecret'){
      const graceHours=Number(body.graceHours??24);
      if(!Number.isInteger(graceHours)||graceHours<0||graceHours>168)throw new AppError('Secret overlap must be between 0 and 168 hours.',400,'INTEGRATION_INVALID');
      const secret=crypto.randomBytes(32).toString('hex');
      const result=await query(`UPDATE workspace_webhooks SET previous_signing_secret_encrypted=signing_secret_encrypted,
        previous_secret_valid_until=CASE WHEN $3::int=0 THEN NOW() ELSE NOW()+($3::int*INTERVAL '1 hour') END,
        signing_secret_encrypted=$4,secret_rotated_at=NOW() WHERE business_id=$1 AND id=$2 RETURNING id`,[session.businessId,body.id,graceHours,encryptSecret(secret)]);
      if(!result.rowCount)throw new AppError('Webhook not found.',404,'NOT_FOUND');
      await query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_rotateWebhookSecret',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:body.id,graceHours})]);
      return json({ok:true,id:body.id,signingSecret:secret,previousValidForHours:graceHours});
    }else if(body.action==='testWebhook'){
      const hook=(await query('SELECT id,schema_version FROM workspace_webhooks WHERE business_id=$1 AND id=$2 AND enabled',[session.businessId,body.id])).rows[0];
      if(!hook)throw new AppError('Enabled webhook not found.',404,'NOT_FOUND');
      const eventId=id('webhook_test'),deliveryId=id('whd');
      await query(`INSERT INTO workspace_webhook_deliveries (id,business_id,webhook_id,event_id,payload)
        VALUES ($1,$2,$3,$4,$5)`,[deliveryId,session.businessId,hook.id,eventId,JSON.stringify({schemaVersion:hook.schema_version,id:eventId,type:'webhook_test',eventType:'webhook_test',workspaceId:session.businessId,occurredAt:new Date().toISOString(),data:{test:true}})]);
      return json({ok:true,deliveryId,eventId},202);
    }else if(body.action==='retryDelivery'){
      const result=await query("UPDATE workspace_webhook_deliveries SET status='queued',attempts=0,replay_count=replay_count+1,run_at=NOW(),error_code='' WHERE business_id=$1 AND id=$2 AND status IN ('failed','dead_letter') RETURNING id",[session.businessId,body.id]);
      if(!result.rowCount)throw new AppError('Failed delivery not found.',404,'NOT_FOUND');
    }else if(body.action==='reconcileApiRequest'){
      const {reconcileIntegrationApiRequest}=await import('./integration-api-reconciliation.js');
      return reconcileIntegrationApiRequest({businessId:session.businessId,userId:session.userId,requestId:String(body.id||''),outcome:String(body.outcome||''),providerMessageId:String(body.providerMessageId||'')});
    }else throw new AppError('Unsupported integration action.',400,'INVALID_ACTION');
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'integration_'+body.action,JSON.stringify({id:body.id})]);
    return json({ok:true});
  }catch(error){return errorJson(error);}
}
export async function triggerIntegrationWorkflow(request){
  try{
    const key=await authenticateWorkspaceApi(request,'workflows:execute');
    const body=await readJsonBodyLimited(request,8192),requestId=request.headers.get('idempotency-key');
    const variables=normalizeWorkflowVariables(body.variables);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId||'')||Object.keys(body).some(name=>!['flowId','contactId','variables'].includes(name))||!key.allowed_flow_ids.includes(body.flowId)||typeof body.contactId!=='string')throw new AppError('Provide an allowed workflow, contact ID and unique Idempotency-Key.',400,'INTEGRATION_INVALID');
    const fingerprint=digest(JSON.stringify([key.id,body.flowId,body.contactId,variables]));
    const result=await transaction(async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[key.business_id,requestId]);
      const lockedKey=(await client.query('SELECT revoked_at FROM workspace_api_keys WHERE id=$1 AND business_id=$2 FOR UPDATE',[key.id,key.business_id])).rows[0];
      if(!lockedKey||lockedKey.revoked_at)throw new AppError('API credential revoked.',401,'INTEGRATION_UNAUTHORIZED');
      const previous=(await client.query('SELECT * FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[key.business_id,requestId])).rows[0];
      if(previous){if(previous.fingerprint!==fingerprint)throw new AppError('This idempotency key has different inputs.',409,'INTEGRATION_REFERENCE_MISMATCH');return {sessionId:previous.session_id,jobId:previous.job_id,duplicate:true};}
      const contact=(await client.query('SELECT * FROM contacts WHERE business_id=$1 AND id=$2 FOR UPDATE',[key.business_id,body.contactId])).rows[0];
      if(!contact||contact.unsubscribed)throw new AppError('Contact not found or opted out.',404,'NOT_FOUND');
      const flow=(await client.query("SELECT * FROM automation_flows WHERE business_id=$1 AND id=$2 AND status='active' AND trigger_mode='manual'",[key.business_id,body.flowId])).rows[0];
      if(!flow||!flow.definition?.startNodeId)throw new AppError('Workflow is unavailable for automation.',409,'INTEGRATION_WORKFLOW_UNAVAILABLE');
      let conversation=(await client.query('SELECT * FROM conversations WHERE business_id=$1 AND contact_id=$2 FOR UPDATE',[key.business_id,contact.id])).rows[0];
      const phone=(await client.query(`SELECT p.phone_number_id FROM whatsapp_phone_numbers p JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id
        WHERE p.business_id=$1 AND ($2='' OR p.phone_number_id=$2) AND a.status='connected' AND p.registration_state='registered'
          AND COALESCE(a.access_token_encrypted,'')<>'' AND (a.token_expires_at IS NULL OR a.token_expires_at>NOW())
        ORDER BY CASE WHEN p.phone_number_id=$2 AND $2<>'' THEN 0 WHEN p.is_default THEN 1 ELSE 2 END,p.created_at LIMIT 1`,[key.business_id,conversation?.whatsapp_phone_number_id||''])).rows[0];
      if(!phone)throw new AppError('Connect a registered WhatsApp number before starting this workflow.',409,'META_NOT_CONFIGURED');
      if(!conversation){
        const conversationId=id('v');
        conversation=(await client.query('INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4) RETURNING *',[conversationId,key.business_id,contact.id,phone.phone_number_id])).rows[0];
      }else if(!conversation.whatsapp_phone_number_id)conversation=(await client.query('UPDATE conversations SET whatsapp_phone_number_id=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3 RETURNING *',[phone.phone_number_id,conversation.id,key.business_id])).rows[0];
      if(conversation.automation_paused)throw new AppError('Conversation is unavailable for automation.',409,'INTEGRATION_WORKFLOW_UNAVAILABLE');
      if((await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff') LIMIT 1",[key.business_id,contact.id])).rowCount)throw new AppError('An existing workflow or human handoff is active.',409,'INTEGRATION_WORKFLOW_ACTIVE');
      const sessionId=id('fs'),jobId=id('aj');
      await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id,context) VALUES ($1,$2,$3,$4,$5,$6)',[sessionId,key.business_id,contact.id,flow.id,flow.definition.startNodeId,JSON.stringify(variables)]);
      await client.query('INSERT INTO automation_jobs (id,business_id,session_id,input) VALUES ($1,$2,$3,$4)',[jobId,key.business_id,sessionId,JSON.stringify({phase:'start',conversationId:conversation.id})]);
      await client.query('INSERT INTO workspace_api_requests (id,business_id,key_id,fingerprint,session_id,job_id) VALUES ($1,$2,$3,$4,$5,$6)',[requestId,key.business_id,key.id,fingerprint,sessionId,jobId]);
      await client.query('UPDATE workspace_api_keys SET last_used_at=NOW() WHERE id=$1',[key.id]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_workflow_queued',$4)",[id('a'),key.business_id,key.created_by,JSON.stringify({keyId:key.id,requestId,flowId:flow.id,contactId:contact.id,sessionId})]);
      return {sessionId,jobId,duplicate:false};
    });
    return json(result,result.duplicate?200:202);
  }catch(error){return errorJson(error);}
}
async function deliverWebhook(row){
  const url=integrationWebhookUrl(row.url),addresses=await resolveWebhookHost(url.hostname);
  if(!addresses.length||addresses.some(record=>!publicWebhookAddress(record.address)))throw new AppError('Webhook address denied.',400,'WEBHOOK_ADDRESS_DENIED');
  const pinned=addresses[0],timestamp=String(Math.floor(Date.now()/1000)),body=JSON.stringify(row.payload);
  const signature=crypto.createHmac('sha256',decryptSecret(row.signing_secret_encrypted)).update(timestamp+'.'+body).digest('hex');
  const previousSignature=row.previous_signing_secret_encrypted&&row.previous_secret_valid_until&&new Date(row.previous_secret_valid_until)>new Date()
    ?crypto.createHmac('sha256',decryptSecret(row.previous_signing_secret_encrypted)).update(timestamp+'.'+body).digest('hex'):null;
  return new Promise((resolve,reject)=>{
    const headers={'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-CRM-Event-ID':row.event_id,'X-CRM-Timestamp':timestamp,'X-CRM-Signature':'sha256='+signature,'X-CRM-Signature-Version':'v1','X-CRM-Schema-Version':row.schema_version};
    if(previousSignature)headers['X-CRM-Signature-Previous']='sha256='+previousSignature;
    const req=https.request(url,{method:'POST',agent:false,lookup:(_hostname,options,callback)=>callback(null,options.all?[{address:pinned.address,family:pinned.family}]:pinned.address,pinned.family),headers},response=>{let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>65536)req.destroy(new Error('Response too large'));});response.on('end',()=>resolve(response.statusCode));response.on('error',reject);});
    const deadline=setTimeout(()=>req.destroy(new Error('Webhook deadline exceeded')),10000);
    req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('Webhook timeout')));req.end(body);
  });
}
export async function runWorkspaceWebhooks({limit=20}={}){
  const rows=await transaction(async client=>{
    await client.query(`UPDATE workspace_webhook_deliveries d SET status=CASE WHEN d.attempts>=h.max_attempts THEN 'dead_letter' ELSE 'queued' END,
      error_code='WORKER_INTERRUPTED',run_at=NOW(),locked_at=NULL FROM workspace_webhooks h
      WHERE d.webhook_id=h.id AND d.business_id=h.business_id AND d.status='processing' AND d.locked_at<NOW()-INTERVAL '2 minutes'`);
    const selected=(await client.query(`SELECT d.*,h.url,h.signing_secret_encrypted,h.previous_signing_secret_encrypted,h.previous_secret_valid_until,
      h.schema_version,h.max_attempts,h.initial_backoff_seconds FROM workspace_webhook_deliveries d
      JOIN workspace_webhooks h ON h.id=d.webhook_id AND h.business_id=d.business_id JOIN businesses b ON b.id=d.business_id
      WHERE d.status='queued' AND d.run_at<=NOW() AND h.enabled AND b.account_status<>'suspended'
      AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr WHERE dr.business_id=b.id AND dr.status IN ('scheduled','pending_approval'))
      ORDER BY d.run_at,d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED`,[Math.min(50,Math.max(1,Number(limit)||20))])).rows;
    if(selected.length)await client.query("UPDATE workspace_webhook_deliveries SET status='processing',attempts=attempts+1,locked_at=NOW(),last_attempt_at=NOW() WHERE id=ANY($1)",[selected.map(row=>row.id)]);
    return selected;
  });
  const summary={claimed:rows.length,delivered:0,failed:0};
  await Promise.all(rows.map(async row=>{
    let status=null,code='';try{status=await deliverWebhook(row);if(status<200||status>=300)code='HTTP_REJECTED';}catch(error){code=error.code==='WEBHOOK_ADDRESS_DENIED'||error.code==='WEBHOOK_HOST_NOT_ALLOWED'?error.code:'DELIVERY_FAILED';}
    const success=status>=200&&status<300,final=!success&&(row.attempts+1>=row.max_attempts||['WEBHOOK_ADDRESS_DENIED','WEBHOOK_HOST_NOT_ALLOWED'].includes(code));
    await query("UPDATE workspace_webhook_deliveries SET status=$1,response_status=$2,error_code=$3,run_at=NOW()+($4::int*INTERVAL '1 second'),locked_at=NULL,delivered_at=CASE WHEN $1='delivered' THEN NOW() ELSE NULL END WHERE id=$5 AND business_id=$6 AND status='processing'",[success?'delivered':final?'dead_letter':'queued',status,code,Math.min(86400,Number(row.initial_backoff_seconds||30)*2**row.attempts),row.id,row.business_id]);
    summary[success?'delivered':'failed']++;
  }));
  return summary;
}
