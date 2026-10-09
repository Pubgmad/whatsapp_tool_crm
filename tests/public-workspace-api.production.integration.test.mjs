import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import {createSessionToken} from '../lib/auth.js';
import {enterSystemContext,query} from '../lib/db.js';
import {reconcileIntegrationApiRequest} from '../lib/integration-api-reconciliation.js';
import {encryptSecret} from '../lib/meta.js';
import {listPublicContacts,listPublicTemplates,sendPublicTemplate,upsertPublicContact} from '../lib/public-workspace-api.js';
import {createCsrfToken} from '../lib/security.js';
import {authenticateWorkspaceApi,integrationSettings,triggerIntegrationWorkflow} from '../lib/workspace-integrations.js';

const dbTest={skip:!process.env.TEST_DATABASE_URL,concurrency:false};
const base='https://workspace-api.example.test';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const unique=prefix=>`${prefix}_${crypto.randomBytes(7).toString('hex')}`;
const token=()=>crypto.randomBytes(32).toString('hex');

function apiRequest(path,credential,{method='GET',body,idempotencyKey,ip='198.51.100.10'}={}){
  return new globalThis.Request(new globalThis.URL(path,base),{
    method,
    headers:{
      authorization:`Bearer ${credential}`,
      'x-real-ip':ip,
      ...(idempotencyKey?{'idempotency-key':idempotencyKey}:{}),
      ...(body===undefined?{}:{'content-type':'application/json'})
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
}

async function responseCode(response){
  return (await response.json()).code;
}

async function fixture(){
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(7).toString('hex');
  const ids={
    business:`pwa_b_${suffix}`,other:`pwa_o_${suffix}`,user:`pwa_u_${suffix}`,
    contact:`pwa_c_${suffix}`,otherContact:`pwa_oc_${suffix}`,flow:`pwa_f_${suffix}`,
    template:`pwa_t_${suffix}`,otherTemplate:`pwa_ot_${suffix}`,
    account:`pwa_a_${suffix}`,otherAccount:`pwa_oa_${suffix}`,
    phone:`pwa_p_${suffix}`,otherPhone:`pwa_op_${suffix}`,
    number:`1555${crypto.randomInt(1000000,9999999)}`,otherNumber:`1666${crypto.randomInt(1000000,9999999)}`
  };
  await query('INSERT INTO businesses (id,name,slug,review_access,account_status) VALUES ($1,$1,$1,TRUE,\'active\'),($2,$2,$2,TRUE,\'active\')',[ids.business,ids.other]);
  await query("INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$1,$2,'unused',NOW())",[ids.user,`${ids.user}@example.test`]);
  await query("INSERT INTO memberships (id,business_id,user_id,role) VALUES ($1,$2,$3,'Owner'),($4,$5,$3,'Owner')",[unique('mem'),ids.business,ids.user,unique('mem'),ids.other]);
  await query("INSERT INTO contacts (id,business_id,name,phone,marketing_permission,source,opt_in_at,opt_in_source) VALUES ($1,$2,'Primary buyer','+15550001111',TRUE,'fixture',NOW(),'fixture'),($3,$4,'Foreign buyer','+15550001111',TRUE,'fixture',NOW(),'fixture')",[ids.contact,ids.business,ids.otherContact,ids.other]);
  await query("INSERT INTO contact_consent_events (id,business_id,contact_id,recorded_by,source,evidence,occurred_at) VALUES ($1,$2,$3,$4,'fixture','Explicit production API fixture consent',NOW()),($5,$6,$7,$4,'fixture','Explicit foreign fixture consent',NOW())",[unique('cce'),ids.business,ids.contact,ids.user,unique('cce'),ids.other,ids.otherContact]);
  await query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,status,access_token_encrypted,is_default) VALUES ($1,$2,$3,'connected',$4,TRUE),($5,$6,$7,'connected',$4,TRUE)",[ids.account,ids.business,`waba_${suffix}`,encryptSecret('provider-token'),ids.otherAccount,ids.other,`other_waba_${suffix}`]);
  await query("INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,is_default,registration_state) VALUES ($1,$2,$3,$4,TRUE,'registered'),($5,$6,$7,$8,TRUE,'registered')",[ids.phone,ids.business,ids.account,ids.number,ids.otherPhone,ids.other,ids.otherAccount,ids.otherNumber]);
  await query("INSERT INTO templates (id,business_id,waba_id,name,body,variables,category,status,meta_template_name) VALUES ($1,$2,$3,'Receipt','Hello {{name}}, order {{order}}',$4,'UTILITY','Approved','receipt_api'),($5,$6,$7,'Foreign receipt','Foreign','[]','UTILITY','Approved','foreign_receipt')",[ids.template,ids.business,`waba_${suffix}`,JSON.stringify(['name','order']),ids.otherTemplate,ids.other,`other_waba_${suffix}`]);
  await query("INSERT INTO automation_flows (id,business_id,name,status,trigger_mode,definition) VALUES ($1,$2,'Public workflow','active','manual',$3)",[ids.flow,ids.business,JSON.stringify({startNodeId:'end',nodes:[{id:'end',type:'end'}]})]);
  return ids;
}

async function addKey(ids,{scopes,flowIds=[],ipAllowlist=[],expires='NOW()+INTERVAL \'1 day\''}={}){
  const credential=token(),keyId=unique('key');
  await query(`INSERT INTO workspace_api_keys (id,business_id,created_by,name,token_hash,allowed_flow_ids,scopes,expires_at,ip_allowlist,rate_limit_per_minute)
    VALUES ($1,$2,$3,'Production test',$4,$5,$6,${expires},$7,1000)`,[keyId,ids.business,ids.user,hash(credential),JSON.stringify(flowIds),JSON.stringify(scopes),JSON.stringify(ipAllowlist)]);
  return {credential,keyId};
}

async function cleanup(ids){
  enterSystemContext();
  await query('DELETE FROM businesses WHERE id IN ($1,$2)',[ids.business,ids.other]);
  await query('DELETE FROM users WHERE id=$1',[ids.user]);
}

test('public API authentication enforces scopes, tenant state, IP rules, expiry, and rotation',dbTest,async()=>{
  const saved={auth:process.env.AUTH_SECRET,csrf:process.env.CSRF_SECRET,header:process.env.WORKSPACE_API_CLIENT_IP_HEADER,encryption:process.env.ENCRYPTION_KEY};
  process.env.AUTH_SECRET=token();process.env.CSRF_SECRET=token();process.env.ENCRYPTION_KEY=token();process.env.WORKSPACE_API_CLIENT_IP_HEADER='x-real-ip';
  const ids=await fixture();
  try{
    const scoped=await addKey(ids,{scopes:['contacts:read'],ipAllowlist:['198.51.100.0/24']});
    const listed=await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential));
    assert.equal(listed.status,200);
    assert.deepEqual((await listed.json()).data.map(item=>item.id),[ids.contact]);
    assert.equal(await responseCode(await upsertPublicContact(apiRequest('/api/v1/contacts',scoped.credential,{method:'PUT',idempotencyKey:unique('scope_reference'),body:{name:'Denied',phone:'+15551112222'}}))), 'INTEGRATION_SCOPE_REQUIRED');
    assert.equal(await responseCode(await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential,{ip:'203.0.113.20'}))), 'INTEGRATION_IP_DENIED');

    await query("UPDATE workspace_api_keys SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[scoped.keyId]);
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential))).status,401);
    await query("UPDATE workspace_api_keys SET expires_at=NOW()+INTERVAL '1 day' WHERE id=$1",[scoped.keyId]);
    await query("UPDATE businesses SET account_status='suspended' WHERE id=$1",[ids.business]);
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential))).status,401);
    await query("UPDATE businesses SET account_status='active' WHERE id=$1",[ids.business]);
    await query("INSERT INTO workspace_deletion_requests (id,business_id,status,execute_after) VALUES ($1,$2,'scheduled',NOW()+INTERVAL '1 day')",[unique('delete'),ids.business]);
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential))).status,401);
    await query('DELETE FROM workspace_deletion_requests WHERE business_id=$1',[ids.business]);

    const csrf=createCsrfToken(),session=createSessionToken({businessId:ids.business,userId:ids.user,role:'Owner',sessionVersion:0});
    const rotate=new globalThis.Request(new globalThis.URL('/api/integrations',base),{method:'POST',headers:{cookie:`wcrm_session=${encodeURIComponent(session)}; wcrm_csrf=${encodeURIComponent(csrf)}`,origin:base,'x-csrf-token':csrf,'content-type':'application/json'},body:JSON.stringify({action:'rotateKey',id:scoped.keyId,graceMinutes:60})});
    const rotatedResponse=await integrationSettings(rotate);
    assert.equal(rotatedResponse.status,200);
    const rotated=await rotatedResponse.json();
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential))).status,200);
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',rotated.token))).status,200);
    await query("UPDATE workspace_api_keys SET previous_token_valid_until=NOW()-INTERVAL '1 second' WHERE id=$1",[scoped.keyId]);
    assert.equal((await listPublicContacts(apiRequest('/api/v1/contacts',scoped.credential))).status,401);
  }finally{
    await cleanup(ids);
    for(const [name,value] of Object.entries(saved)){const env={auth:'AUTH_SECRET',csrf:'CSRF_SECRET',header:'WORKSPACE_API_CLIENT_IP_HEADER',encryption:'ENCRYPTION_KEY'}[name];if(value===undefined)delete process.env[env];else process.env[env]=value;}
  }
});

test('contact upsert preserves tenant isolation and requires auditable consent restoration',dbTest,async()=>{
  const previous=process.env.ENCRYPTION_KEY;process.env.ENCRYPTION_KEY=token();
  const ids=await fixture();
  try{
    const key=await addKey(ids,{scopes:['contacts:write','contacts:read','templates:read']});
    const phone='+15558889999',send=(reference,body)=>upsertPublicContact(apiRequest('/api/v1/contacts',key.credential,{method:'PUT',idempotencyKey:reference,body}));
    const missing=await send(unique('contact_reference'),{name:'API lead',phone,marketingPermission:true,optInSource:'landing'});
    assert.equal(missing.status,400);assert.equal(await responseCode(missing),'CONSENT_EVIDENCE_REQUIRED');
    const reference=unique('contact_reference'),body={name:'API lead',phone,source:'Landing',tags:['VIP'],customAttributes:{campaign:'fall'},marketingPermission:true,optInSource:'landing',consentEvidence:'Checked the WhatsApp consent box at 2026-10-09T10:00:00Z'};
    const created=await send(reference,body),replayed=await send(reference,body);
    assert.equal(created.status,201);assert.equal(replayed.status,201);assert.equal(replayed.headers.get('Idempotency-Replayed'),'true');
    const contact=(await created.json()).contact;
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM contact_consent_events WHERE business_id=$1 AND contact_id=$2',[ids.business,contact.id])).rows[0].count,1);
    assert.equal((await send(reference,{...body,name:'Changed'})).status,409);
    await query('UPDATE contacts SET unsubscribed=TRUE,marketing_permission=FALSE WHERE id=$1 AND business_id=$2',[contact.id,ids.business]);
    assert.equal(await responseCode(await send(unique('contact_reference'),{...body,consentEvidence:'New explicit consent after opt-out'})),'CONSENT_RECONFIRM_REQUIRED');
    const restored=await send(unique('contact_reference'),{...body,reconfirmOptIn:true,consentEvidence:'New explicit consent after opt-out'});
    assert.equal(restored.status,200);
    assert.deepEqual((await query('SELECT unsubscribed,marketing_permission FROM contacts WHERE id=$1',[contact.id])).rows[0],{unsubscribed:false,marketing_permission:true});
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM contact_consent_events WHERE business_id=$1 AND contact_id=$2',[ids.business,contact.id])).rows[0].count,2);

    const contacts=await (await listPublicContacts(apiRequest('/api/v1/contacts',key.credential))).json();
    assert.ok(contacts.data.every(item=>item.id!==ids.otherContact));
    const templates=await (await listPublicTemplates(apiRequest('/api/v1/templates',key.credential))).json();
    assert.deepEqual(templates.data.map(item=>item.id),[ids.template]);
  }finally{await cleanup(ids);if(previous===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=previous;}
});

test('direct template sends are leased, provider-confirmed, and idempotent',dbTest,async()=>{
  const saved={encryption:process.env.ENCRYPTION_KEY,fetch:globalThis.fetch};process.env.ENCRYPTION_KEY=token();
  const ids=await fixture();
  let calls=0;
  try{
    const key=await addKey(ids,{scopes:['messages:template:send']});
    globalThis.fetch=async(_url,options)=>{
      calls++;
      const payload=JSON.parse(options.body);
      assert.equal(payload.to,'15550001111');
      assert.equal(payload.template.name,'receipt_api');
      return globalThis.Response.json({messages:[{id:`wamid.accepted_${ids.business}`}]});
    };
    const reference=unique('template_reference'),body={contactId:ids.contact,templateId:ids.template,variables:{order:'A-100'}};
    const first=await sendPublicTemplate(apiRequest('/api/v1/messages/templates',key.credential,{method:'POST',idempotencyKey:reference,body}));
    const replay=await sendPublicTemplate(apiRequest('/api/v1/messages/templates',key.credential,{method:'POST',idempotencyKey:reference,body}));
    assert.equal(first.status,202);assert.equal(replay.status,202);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.equal(calls,1);
    const request=(await query('SELECT dispatch_status,provider_message_id,lease_token,response_status FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[ids.business,reference])).rows[0];
    assert.equal(request.dispatch_status,'completed');assert.equal(request.response_status,202);assert.ok(request.lease_token);assert.match(request.provider_message_id,/^wamid\.accepted_/);
    const messages=await query('SELECT body FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.meta_message_id=$2',[ids.business,request.provider_message_id]);
    assert.equal(messages.rowCount,1);assert.equal(messages.rows[0].body,'Hello Primary buyer, order A-100');
    const mismatch=await sendPublicTemplate(apiRequest('/api/v1/messages/templates',key.credential,{method:'POST',idempotencyKey:reference,body:{...body,variables:{order:'A-101'}}}));
    assert.equal(mismatch.status,409);assert.equal(await responseCode(mismatch),'INTEGRATION_REFERENCE_MISMATCH');assert.equal(calls,1);

    globalThis.fetch=async()=>{calls++;return globalThis.Response.json({messages:[]});};
    const uncertainReference=unique('template_uncertain'),uncertainBody={...body,variables:{order:'A-102'}};
    const uncertain=await sendPublicTemplate(apiRequest('/api/v1/messages/templates',key.credential,{method:'POST',idempotencyKey:uncertainReference,body:uncertainBody}));
    assert.equal(uncertain.status,409);assert.equal(await responseCode(uncertain),'META_SEND_UNCONFIRMED');
    const blockedReplay=await sendPublicTemplate(apiRequest('/api/v1/messages/templates',key.credential,{method:'POST',idempotencyKey:uncertainReference,body:uncertainBody}));
    assert.equal(blockedReplay.status,409);assert.equal(await responseCode(blockedReplay),'INTEGRATION_RECONCILIATION_REQUIRED');assert.equal(calls,2);
    assert.deepEqual((await query('SELECT dispatch_status,error_code FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[ids.business,uncertainReference])).rows[0],{dispatch_status:'unconfirmed',error_code:'META_SEND_UNCONFIRMED'});
  }finally{await cleanup(ids);globalThis.fetch=saved.fetch;if(saved.encryption===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=saved.encryption;}
});

test('sent and not-sent reconciliation is tenant-safe and rejects foreign duplicate Meta IDs',dbTest,async()=>{
  const previous=process.env.ENCRYPTION_KEY;process.env.ENCRYPTION_KEY=token();
  const ids=await fixture();
  try{
    const key=await addKey(ids,{scopes:['messages:template:send']});
    const insertRequest=async(id,status='provider_accepted',providerId='')=>query(`INSERT INTO workspace_api_requests
      (id,business_id,key_id,fingerprint,operation,resource_id,request_payload,dispatch_status,provider_message_id,lease_token)
      VALUES ($1,$2,$3,$4,'template.send',$5,$6,$7,$8,$9)`,[id,ids.business,key.keyId,hash(id),ids.contact,JSON.stringify({templateId:ids.template,variables:{order:'R-200'},phoneNumberId:ids.number}),status,providerId,unique('lease')]);

    const sentId=unique('reconcile_sent'),sentMeta=unique('wamid.sent');
    await insertRequest(sentId,'provider_accepted',sentMeta);
    const sent=await reconcileIntegrationApiRequest({businessId:ids.business,userId:ids.user,requestId:sentId,outcome:'sent'});
    assert.equal(sent.status,202);
    const sentBody=await sent.json();assert.equal(sentBody.status,'sent');assert.equal(sentBody.metaMessageId,sentMeta);
    assert.equal((await query('SELECT body FROM messages WHERE id=$1',[sentBody.messageId])).rows[0].body,'Hello Primary buyer, order R-200');

    const notSentId=unique('reconcile_not_sent');
    await insertRequest(notSentId,'unconfirmed');
    const notSent=await reconcileIntegrationApiRequest({businessId:ids.business,userId:ids.user,requestId:notSentId,outcome:'not_sent'});
    assert.deepEqual(await notSent.json(),{ok:true,resolvedAs:'not_sent'});
    assert.deepEqual((await query('SELECT dispatch_status,error_code,response_status FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[ids.business,notSentId])).rows[0],{dispatch_status:'failed',error_code:'PROVIDER_NOT_SENT',response_status:409});

    const foreignConversation=unique('foreign_v'),duplicateMeta=unique('wamid.duplicate');
    await query('INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4)',[foreignConversation,ids.other,ids.otherContact,ids.otherNumber]);
    await query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id,message_type) VALUES ($1,$2,'outgoing','foreign','sent',$3,'template')",[unique('foreign_m'),foreignConversation,duplicateMeta]);
    const duplicateId=unique('reconcile_duplicate');
    await insertRequest(duplicateId,'provider_accepted',duplicateMeta);
    await assert.rejects(()=>reconcileIntegrationApiRequest({businessId:ids.business,userId:ids.user,requestId:duplicateId,outcome:'sent'}),{code:'INTEGRATION_PROVIDER_ID_CONFLICT',status:409});
    assert.equal((await query('SELECT dispatch_status FROM workspace_api_requests WHERE business_id=$1 AND id=$2',[ids.business,duplicateId])).rows[0].dispatch_status,'provider_accepted');
  }finally{await cleanup(ids);if(previous===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=previous;}
});

test('workflow execution isolates tenants and persists validated variables exactly once',dbTest,async()=>{
  const previous=process.env.ENCRYPTION_KEY;process.env.ENCRYPTION_KEY=token();
  const ids=await fixture();
  try{
    const key=await addKey(ids,{scopes:['workflows:execute'],flowIds:[ids.flow]});
    const reference=unique('workflow_reference'),variables={orderReference:'external-123',nested:{source:'api',items:[1,true,'sku']}};
    const execute=(body,idempotencyKey=reference)=>triggerIntegrationWorkflow(apiRequest('/api/v1/workflows',key.credential,{method:'POST',idempotencyKey,body}));
    const first=await execute({flowId:ids.flow,contactId:ids.contact,variables}),replay=await execute({flowId:ids.flow,contactId:ids.contact,variables});
    assert.equal(first.status,202);assert.equal(replay.status,200);
    assert.deepEqual((await query('SELECT context FROM automation_sessions WHERE business_id=$1 AND contact_id=$2',[ids.business,ids.contact])).rows[0].context,variables);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM automation_jobs WHERE business_id=$1',[ids.business])).rows[0].count,1);
    assert.equal((await execute({flowId:ids.flow,contactId:ids.otherContact,variables},unique('workflow_reference'))).status,404);
    const tooDeep={one:{two:{three:{four:'denied'}}}};
    const invalid=await execute({flowId:ids.flow,contactId:ids.contact,variables:tooDeep},unique('workflow_reference'));
    assert.equal(invalid.status,400);assert.equal(await responseCode(invalid),'INTEGRATION_VARIABLES_INVALID');
    await assert.rejects(()=>authenticateWorkspaceApi(apiRequest('/api/v1/workflows',key.credential),'contacts:read'),{code:'INTEGRATION_SCOPE_REQUIRED'});
  }finally{await cleanup(ids);if(previous===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=previous;}
});
