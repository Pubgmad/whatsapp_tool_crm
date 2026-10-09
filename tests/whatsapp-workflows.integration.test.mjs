import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,transaction,enterSystemContext} from '../lib/db.js';
import {createSessionToken} from '../lib/auth.js';
import {createCsrfToken} from '../lib/security.js';
import {integrationSettings,triggerIntegrationWorkflow} from '../lib/workspace-integrations.js';
import {upsertPublicContact} from '../lib/public-workspace-api.js';
import {runCommerceAutomation} from '../lib/commerce-automation.js';
import {journeyReportForBusiness} from '../lib/whatsapp-journey-analytics.js';

test('workflow API keys are scoped, revocable, CSRF-protected and idempotent',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const before={auth:process.env.AUTH_SECRET,csrf:process.env.CSRF_SECRET};process.env.AUTH_SECRET=crypto.randomBytes(32).toString('hex');process.env.CSRF_SECRET=crypto.randomBytes(32).toString('hex');
  const suffix=crypto.randomBytes(7).toString('hex'),business='api_b_'+suffix,other='api_o_'+suffix,user='api_u_'+suffix,contact='api_c_'+suffix,flow='api_f_'+suffix;
  const base=process.env.APP_URL||'https://example.test',csrf=createCsrfToken(),session=createSessionToken({businessId:business,userId:user,role:'Owner',sessionVersion:0});
  const request=(body,withCsrf=true)=>new Request(new URL('/api/integrations',base),{method:'POST',headers:{cookie:'wcrm_session='+encodeURIComponent(session)+'; wcrm_csrf='+encodeURIComponent(csrf),origin:new URL(base).origin,'content-type':'application/json',...(withCsrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(body)});
  try{
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE),($2,$2,$2,TRUE)',[business,other]);
    await query("INSERT INTO users (id,name,email,password_hash,email_verified_at) VALUES ($1,$1,$2,'unused',NOW())",[user,user+'@example.test']);
    await query("INSERT INTO memberships (id,business_id,user_id,role) VALUES ($1,$2,$3,'Owner')",['mem_'+suffix,business,user]);
    await query("INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,'Buyer','15550001111')",[contact,business]);
    await query('INSERT INTO conversations (id,business_id,contact_id) VALUES ($1,$2,$3)',['v_'+suffix,business,contact]);
    await query("INSERT INTO automation_flows (id,business_id,name,status,trigger_mode,definition) VALUES ($1,$2,'Manual','active','manual',$3)",[flow,business,JSON.stringify({startNodeId:'end',nodes:[{id:'end',type:'end',body:''}]})]);
    assert.equal((await integrationSettings(request({action:'createKey',name:'Store',flowIds:[flow]},false))).status,403);
    const created=await integrationSettings(request({action:'createKey',name:'Store',flowIds:[flow],scopes:['workflows:execute'],expiresInDays:30,rateLimitPerMinute:100}));assert.equal(created.status,201);const key=await created.json();
    enterSystemContext();const saved=(await query('SELECT token_hash,scopes,expires_at FROM workspace_api_keys WHERE id=$1',[key.id])).rows[0];assert.notEqual(saved.token_hash,key.token);assert.equal(saved.token_hash,crypto.createHash('sha256').update(key.token).digest('hex'));assert.deepEqual(saved.scopes,['workflows:execute']);assert.ok(saved.expires_at);
    const scopedCreated=await integrationSettings(request({action:'createKey',name:'Contacts only',flowIds:[],scopes:['contacts:write'],expiresInDays:30,rateLimitPerMinute:10}));assert.equal(scopedCreated.status,201);const scoped=await scopedCreated.json();
    await query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,status,access_token_encrypted) VALUES ($1,$2,$3,'connected','test-encrypted')",['api_wa_'+suffix,business,'api_waba_'+suffix]);
    await query("INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,is_default,registration_state) VALUES ($1,$2,$3,$4,TRUE,'registered')",['api_wp_'+suffix,business,'api_wa_'+suffix,'api_phone_'+suffix]);
    const contactRequest=()=>new Request(new URL('/api/v1/contacts',base),{method:'PUT',headers:{authorization:'Bearer '+scoped.token,'idempotency-key':'contact_reference_'+suffix,'content-type':'application/json'},body:JSON.stringify({name:'API buyer',phone:'+15550002222',source:'Landing page',tags:['Lead','VIP'],customAttributes:{campaign:'October'}})});
    const contactResults=await Promise.all([upsertPublicContact(contactRequest()),upsertPublicContact(contactRequest())]);assert.deepEqual(contactResults.map(result=>result.status),[201,201]);const contactPayload=await contactResults[0].json();assert.equal(contactPayload.contact.source,'Landing page');assert.deepEqual(contactPayload.contact.tags,['lead','vip']);
    const scopedTrigger=new Request(new URL('/api/v1/workflows',base),{method:'POST',headers:{authorization:'Bearer '+scoped.token,'idempotency-key':'scoped_reference_'+suffix,'content-type':'application/json'},body:JSON.stringify({flowId:flow,contactId:contact})});assert.equal((await triggerIntegrationWorkflow(scopedTrigger)).status,403);
    const rotatedResponse=await integrationSettings(request({action:'rotateKey',id:key.id,graceMinutes:60}));assert.equal(rotatedResponse.status,200);const rotated=await rotatedResponse.json();
    const trigger=(body,token=rotated.token)=>new Request(new URL('/api/v1/workflows',base),{method:'POST',headers:{authorization:'Bearer '+token,'idempotency-key':'unique_reference_'+suffix,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await triggerIntegrationWorkflow(trigger({businessId:other,flowId:flow,contactId:contact},key.token))).status,400);
    assert.equal((await triggerIntegrationWorkflow(trigger({businessId:other,flowId:flow,contactId:contact}))).status,400);
    const variables={orderReference:'external-123',nested:{source:'api'}},results=await Promise.all([triggerIntegrationWorkflow(trigger({flowId:flow,contactId:contact,variables})),triggerIntegrationWorkflow(trigger({flowId:flow,contactId:contact,variables}))]);assert.deepEqual(results.map(response=>response.status).sort(),[200,202]);
    enterSystemContext();assert.equal((await query('SELECT 1 FROM automation_jobs WHERE business_id=$1',[business])).rowCount,1);assert.equal((await query('SELECT 1 FROM automation_jobs WHERE business_id=$1',[other])).rowCount,0);assert.deepEqual((await query('SELECT context FROM automation_sessions WHERE business_id=$1',[business])).rows[0].context,variables);
    assert.equal((await integrationSettings(request({action:'revokeKey',id:key.id}))).status,200);
    assert.equal((await triggerIntegrationWorkflow(trigger({flowId:flow,contactId:contact}))).status,401);
    enterSystemContext();await assert.rejects(transaction(async client=>{
      const role='workflow_rls_'+suffix;await client.query(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);await client.query(`GRANT SELECT ON workspace_api_keys TO ${role}`);await client.query(`SET LOCAL ROLE ${role}`);await client.query("SELECT set_config('app.business_id',$1,true),set_config('app.system_access','false',true)",[other]);assert.equal((await client.query('SELECT * FROM workspace_api_keys')).rowCount,0);const error=new Error('rollback');error.code='TEST_ROLLBACK';throw error;
    }),{code:'TEST_ROLLBACK'});
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);await query('DELETE FROM users WHERE id=$1',[user]);for(const [key,value] of [['AUTH_SECRET',before.auth],['CSRF_SECRET',before.csrf]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
test('commerce events enqueue once, use real order context, skip captured reminders and isolate reports',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();const suffix=crypto.randomBytes(7).toString('hex'),business='commerce_b_'+suffix,other='commerce_o_'+suffix,contact='commerce_c_'+suffix,account='commerce_a_'+suffix,phone='commerce_p_'+suffix,number='123'+Date.now(),flow='commerce_f_'+suffix,template='commerce_t_'+suffix,rule='commerce_r_'+suffix,order='commerce_order_'+suffix;
  try{
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE),($2,$2,$2,TRUE)',[business,other]);
    await query("INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,'Buyer','15550001111')",[contact,business]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[account,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,account,number]);
    await query('INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4)',['commerce_v_'+suffix,business,contact,number]);
    await query("INSERT INTO templates (id,business_id,name,body,category,status) VALUES ($1,$2,'Receipt','Order received','UTILITY','Approved')",[template,business]);
    const definition={startNodeId:'receipt',nodes:[{id:'receipt',type:'template',templateId:template,inputKind:'none',next:'end'},{id:'end',type:'end',body:'',next:''}]};
    await query("INSERT INTO automation_flows (id,business_id,name,status,trigger_mode,definition) VALUES ($1,$2,'Receipt','active','manual',$3)",[flow,business,JSON.stringify(definition)]);
    await query("INSERT INTO commerce_automation_rules (id,business_id,name,flow_id,event_type,unpaid_only,delay_minutes) VALUES ($1,$2,'Receipt',$3,'whatsapp_order_received',FALSE,0)",[rule,business,flow]);
    await query("INSERT INTO workspace_webhooks (id,business_id,url,event_types,signing_secret_encrypted) VALUES ($1,$2,'https://hooks.example.test/events',$3,'test-unused')",['hook_'+suffix,business,JSON.stringify(['whatsapp_order_received','whatsapp_payment_captured'])]);
    await query("INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount) VALUES ($1,$2,$3,$4,'15550001111','123','[]','INR',25)",[order,business,phone,'message_'+suffix]);
    const first=await runCommerceAutomation();assert.equal(first.started,1);
    const session=(await query('SELECT context FROM automation_sessions WHERE business_id=$1',[business])).rows[0];assert.equal(session.context.orderId,order);assert.equal(session.context.orderCurrency,'INR');assert.equal((await runCommerceAutomation()).started,0);
    assert.equal((await query('SELECT 1 FROM workspace_webhook_deliveries WHERE business_id=$1',[business])).rowCount,1);
    await query("UPDATE whatsapp_orders SET payment_status='captured' WHERE id=$1",[order]);
    await query("UPDATE whatsapp_orders SET payment_status='captured' WHERE id=$1",[order]);
    assert.equal((await query('SELECT 1 FROM workspace_webhook_deliveries WHERE business_id=$1',[business])).rowCount,2);
    const payload=(await query('SELECT payload FROM workspace_webhook_deliveries WHERE business_id=$1 ORDER BY id',[business])).rows[0].payload;assert.ok(payload.data.orderId);assert.equal(payload.customerPhone,undefined);
    const range={since:new Date().toISOString().slice(0,10),until:new Date().toISOString().slice(0,10)},report=await journeyReportForBusiness(business,range),foreign=await journeyReportForBusiness(other,range);assert.equal(report.summary[0].paid_orders,1);assert.equal(report.summary[0].captured_value,'25.000000');assert.deepEqual(foreign.orders,[]);assert.deepEqual(foreign.summary,[]);
    await query("INSERT INTO commerce_automation_rules (id,business_id,name,flow_id,event_type,unpaid_only,delay_minutes) VALUES ($1,$2,'Reminder',$3,'whatsapp_order_received',TRUE,1)",['reminder_'+suffix,business,flow]);
    await query("INSERT INTO events (id,business_id,type,metadata) VALUES ($1,$2,'whatsapp_order_received',$3)",['reminder_event_'+suffix,business,JSON.stringify({orderId:order})]);
    await query("UPDATE commerce_automation_tasks SET run_at=NOW() WHERE business_id=$1 AND status='queued'",[business]);assert.equal((await runCommerceAutomation()).skipped,1);
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
