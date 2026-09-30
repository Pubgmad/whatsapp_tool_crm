import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext,enterTenantContext} from './db.js';
import {encryptSecret,decryptSecret} from './meta.js';
import {readJsonBodyLimited,enforceRequestRateLimit} from './security.js';
import {assertSubscriptionActive,subscriptionUsage} from './limits.js';

const eventTypes=new Set(['campaign_sent','campaign_queued','campaign_pending_review','incoming_message','unsubscribe','automation_step_sent','automation_step_scheduled','whatsapp_order_received','whatsapp_order_fulfillment','whatsapp_payment_captured']);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const blocked=new BlockList();
for(const [network,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(network,prefix,'ipv4');
export function publicWebhookAddress(address){return isIP(address)===4&&!blocked.check(address,'ipv4');}
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
export async function integrationSettings(request){
  try{
    const session=await requireSession(request);
    if(session.role!=='Owner')throw new AppError('Only the owner can manage integration credentials.',403,'FORBIDDEN');
    if(request.method==='GET'){
      const keys=(await query('SELECT id,name,allowed_flow_ids,revoked_at,last_used_at,created_at FROM workspace_api_keys WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows;
      const webhooks=(await query('SELECT id,url,event_types,enabled FROM workspace_webhooks WHERE business_id=$1 ORDER BY created_at DESC LIMIT 100',[session.businessId])).rows;
      const deliveries=(await query('SELECT id,event_id,webhook_id,status,attempts,response_status,error_code,run_at,delivered_at FROM workspace_webhook_deliveries WHERE business_id=$1 ORDER BY run_at DESC LIMIT 50',[session.businessId])).rows;
      const flows=(await query("SELECT id,name FROM automation_flows WHERE business_id=$1 AND status='active' AND trigger_mode='manual' ORDER BY name",[session.businessId])).rows;
      return json({keys,webhooks,deliveries,flows,eventTypes:[...eventTypes]});
    }
    const body=await readJsonBodyLimited(request,16384);
    await assertSubscriptionActive(await subscriptionUsage(session.businessId));
    if(body.action==='createKey'){
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120||!Array.isArray(body.flowIds)||!body.flowIds.length||body.flowIds.length>50||new Set(body.flowIds).size!==body.flowIds.length||body.flowIds.some(value=>typeof value!=='string'))throw new AppError('Provide a name and allowed manual workflows.',400,'INTEGRATION_INVALID');
      const flows=await query("SELECT id FROM automation_flows WHERE business_id=$1 AND id=ANY($2::text[]) AND status='active' AND trigger_mode='manual'",[session.businessId,body.flowIds]);
      if(flows.rowCount!==body.flowIds.length)throw new AppError('Select active manual workflows from this workspace.',400,'INTEGRATION_INVALID');
      const token=crypto.randomBytes(32).toString('hex'),keyId=id('key');
      await transaction(async client=>{
        await client.query('INSERT INTO workspace_api_keys (id,business_id,created_by,name,token_hash,allowed_flow_ids) VALUES ($1,$2,$3,$4,$5,$6)',[keyId,session.businessId,session.userId,body.name.trim(),digest(token),JSON.stringify(body.flowIds)]);
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_createKey',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:keyId,flowIds:body.flowIds})]);
      });
      return json({ok:true,id:keyId,token},201);
    }
    if(body.action==='revokeKey'){
      const result=await query('UPDATE workspace_api_keys SET revoked_at=COALESCE(revoked_at,NOW()) WHERE id=$1 AND business_id=$2 RETURNING id',[body.id,session.businessId]);
      if(!result.rowCount)throw new AppError('API key not found.',404,'NOT_FOUND');
    }else if(body.action==='createWebhook'){
      const url=integrationWebhookUrl(body.url);
      if(!Array.isArray(body.eventTypes)||!body.eventTypes.length||body.eventTypes.length>eventTypes.size||body.eventTypes.some(type=>!eventTypes.has(type)))throw new AppError('Select supported events.',400,'INTEGRATION_INVALID');
      const addresses=await resolveWebhookHost(url.hostname);
      if(!addresses.length||addresses.some(record=>!publicWebhookAddress(record.address)))throw new AppError('Webhook destinations must resolve only to public IPv4 addresses.',400,'WEBHOOK_ADDRESS_DENIED');
      const secret=crypto.randomBytes(32).toString('hex'),webhookId=id('hook');
      await transaction(async client=>{
        await client.query('INSERT INTO workspace_webhooks (id,business_id,url,event_types,signing_secret_encrypted) VALUES ($1,$2,$3,$4,$5)',[webhookId,session.businessId,url.href,JSON.stringify([...new Set(body.eventTypes)]),encryptSecret(secret)]);
        await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'integration_createWebhook',$4)",[id('a'),session.businessId,session.userId,JSON.stringify({id:webhookId,eventTypes:body.eventTypes})]);
      });
      return json({ok:true,id:webhookId,signingSecret:secret},201);
    }else if(body.action==='toggleWebhook'){
      if(typeof body.enabled!=='boolean')throw new AppError('Specify enabled or disabled.',400,'INTEGRATION_INVALID');
      const result=await query('UPDATE workspace_webhooks SET enabled=$1 WHERE business_id=$2 AND id=$3 RETURNING id',[body.enabled,session.businessId,body.id]);
      if(!result.rowCount)throw new AppError('Webhook not found.',404,'NOT_FOUND');
    }else if(body.action==='retryDelivery'){
      const result=await query("UPDATE workspace_webhook_deliveries SET status='queued',attempts=0,run_at=NOW(),error_code='' WHERE business_id=$1 AND id=$2 AND status='failed' RETURNING id",[session.businessId,body.id]);
      if(!result.rowCount)throw new AppError('Failed delivery not found.',404,'NOT_FOUND');
    }else throw new AppError('Unsupported integration action.',400,'INVALID_ACTION');
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',[id('a'),session.businessId,session.userId,'integration_'+body.action,JSON.stringify({id:body.id})]);
    return json({ok:true});
  }catch(error){return errorJson(error);}
}
export async function triggerIntegrationWorkflow(request){
  try{
    const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(token))throw new AppError('Invalid API credential.',401,'INTEGRATION_UNAUTHORIZED');
    enterSystemContext();
    await enforceRequestRateLimit(request,'integration-auth');
    const key=(await query("SELECT k.*,b.account_status FROM workspace_api_keys k JOIN businesses b ON b.id=k.business_id JOIN memberships m ON m.business_id=k.business_id AND m.user_id=k.created_by AND m.role='Owner' WHERE k.token_hash=$1 AND k.revoked_at IS NULL AND b.account_status<>'suspended' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr WHERE dr.business_id=b.id AND dr.status IN ('scheduled','pending_approval'))",[digest(token)])).rows[0];
    if(!key)throw new AppError('Invalid API credential.',401,'INTEGRATION_UNAUTHORIZED');
    enterTenantContext(key.business_id);
    await enforceRequestRateLimit(request,'integration:'+key.id);
    await assertSubscriptionActive(await subscriptionUsage(key.business_id));
    const body=await readJsonBodyLimited(request,8192),requestId=request.headers.get('idempotency-key');
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId||'')||Object.keys(body).some(name=>!['flowId','contactId'].includes(name))||!key.allowed_flow_ids.includes(body.flowId)||typeof body.contactId!=='string')throw new AppError('Provide an allowed workflow, contact ID and unique Idempotency-Key.',400,'INTEGRATION_INVALID');
    const fingerprint=digest(JSON.stringify([key.id,body.flowId,body.contactId]));
    const result=await transaction(async client=>{
      const lockedKey=(await client.query('SELECT revoked_at FROM workspace_api_keys WHERE id=$1 AND business_id=$2 FOR UPDATE',[key.id,key.business_id])).rows[0];
      if(!lockedKey||lockedKey.revoked_at)throw new AppError('API credential revoked.',401,'INTEGRATION_UNAUTHORIZED');
      const previous=(await client.query('SELECT * FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[key.business_id,requestId])).rows[0];
      if(previous){if(previous.fingerprint!==fingerprint)throw new AppError('This idempotency key has different inputs.',409,'INTEGRATION_REFERENCE_MISMATCH');return {sessionId:previous.session_id,jobId:previous.job_id,duplicate:true};}
      const contact=(await client.query('SELECT * FROM contacts WHERE business_id=$1 AND id=$2 FOR UPDATE',[key.business_id,body.contactId])).rows[0];
      if(!contact||contact.unsubscribed)throw new AppError('Contact not found or opted out.',404,'NOT_FOUND');
      const flow=(await client.query("SELECT * FROM automation_flows WHERE business_id=$1 AND id=$2 AND status='active' AND trigger_mode='manual'",[key.business_id,body.flowId])).rows[0];
      const conversation=(await client.query('SELECT * FROM conversations WHERE business_id=$1 AND contact_id=$2 FOR UPDATE',[key.business_id,contact.id])).rows[0];
      if(!flow||!flow.definition?.startNodeId||!conversation||conversation.automation_paused)throw new AppError('Workflow or conversation is unavailable for automation.',409,'INTEGRATION_WORKFLOW_UNAVAILABLE');
      if((await client.query("SELECT 1 FROM automation_sessions WHERE business_id=$1 AND contact_id=$2 AND status IN ('active','handoff') LIMIT 1",[key.business_id,contact.id])).rowCount)throw new AppError('An existing workflow or human handoff is active.',409,'INTEGRATION_WORKFLOW_ACTIVE');
      const sessionId=id('fs'),jobId=id('aj');
      await client.query('INSERT INTO automation_sessions (id,business_id,contact_id,flow_id,current_node_id) VALUES ($1,$2,$3,$4,$5)',[sessionId,key.business_id,contact.id,flow.id,flow.definition.startNodeId]);
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
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method:'POST',agent:false,lookup:(_hostname,options,callback)=>callback(null,options.all?[{address:pinned.address,family:pinned.family}]:pinned.address,pinned.family),headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-CRM-Event-ID':row.event_id,'X-CRM-Timestamp':timestamp,'X-CRM-Signature':'sha256='+signature}},response=>{let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>65536)req.destroy(new Error('Response too large'));});response.on('end',()=>resolve(response.statusCode));response.on('error',reject);});
    const deadline=setTimeout(()=>req.destroy(new Error('Webhook deadline exceeded')),10000);
    req.on('close',()=>clearTimeout(deadline));req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('Webhook timeout')));req.end(body);
  });
}
export async function runWorkspaceWebhooks({limit=20}={}){
  const rows=await transaction(async client=>{
    await client.query("UPDATE workspace_webhook_deliveries SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,error_code='WORKER_INTERRUPTED',run_at=NOW(),locked_at=NULL WHERE status='processing' AND locked_at<NOW()-INTERVAL '2 minutes'");
    const selected=(await client.query("SELECT d.*,h.url,h.signing_secret_encrypted FROM workspace_webhook_deliveries d JOIN workspace_webhooks h ON h.id=d.webhook_id AND h.business_id=d.business_id JOIN businesses b ON b.id=d.business_id WHERE d.status='queued' AND d.run_at<=NOW() AND h.enabled AND b.account_status<>'suspended' AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr WHERE dr.business_id=b.id AND dr.status IN ('scheduled','pending_approval')) ORDER BY d.run_at,d.id LIMIT $1 FOR UPDATE OF d SKIP LOCKED",[Math.min(50,Math.max(1,Number(limit)||20))])).rows;
    if(selected.length)await client.query("UPDATE workspace_webhook_deliveries SET status='processing',attempts=attempts+1,locked_at=NOW() WHERE id=ANY($1)",[selected.map(row=>row.id)]);
    return selected;
  });
  const summary={claimed:rows.length,delivered:0,failed:0};
  await Promise.all(rows.map(async row=>{
    let status=null,code='';try{status=await deliverWebhook(row);if(status<200||status>=300)code='HTTP_REJECTED';}catch(error){code=error.code==='WEBHOOK_ADDRESS_DENIED'||error.code==='WEBHOOK_HOST_NOT_ALLOWED'?error.code:'DELIVERY_FAILED';}
    const success=status>=200&&status<300,final=!success&&(row.attempts+1>=5||['WEBHOOK_ADDRESS_DENIED','WEBHOOK_HOST_NOT_ALLOWED'].includes(code));
    await query("UPDATE workspace_webhook_deliveries SET status=$1,response_status=$2,error_code=$3,run_at=NOW()+($4::int*INTERVAL '1 second'),locked_at=NULL,delivered_at=CASE WHEN $1='delivered' THEN NOW() ELSE NULL END WHERE id=$5 AND business_id=$6 AND status='processing'",[success?'delivered':final?'failed':'queued',status,code,Math.min(3600,30*2**row.attempts),row.id,row.business_id]);
    summary[success?'delivered':'failed']++;
  }));
  return summary;
}
