import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {enterSystemContext,enterTenantContext,query} from '../lib/db.js';
import {encryptSecret} from '../lib/meta.js';
import {runCalendarFulfillment} from '../lib/calendar-fulfillment.js';
import {runBookingNotices} from '../lib/booking-notices.js';
import {handleRuntimeExchange} from '../lib/flow-runtime.js';
import {GOOGLE_EVENTS_SCOPE,GOOGLE_FREEBUSY_SCOPE} from '../lib/external-availability.js';
import {verifiedSupportFacts} from '../lib/ai-support.js';

test('Calendar worker confirms a tenant-owned pending booking only after provider event creation',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const ids={business:'calb_'+suffix,account:'cala_'+suffix,phone:'calp_'+suffix,contact:'calc_'+suffix,flow:'calf_'+suffix,resource:'frr_'+suffix,session:'frs_'+suffix,reservation:'frv_'+suffix,connection:'avc_'+suffix,template:'tpl_'+suffix};
  const eventId=crypto.createHash('sha256').update(`${ids.business}:${ids.reservation}`).digest('hex');
  const flowToken=crypto.createHash('sha256').update(suffix).digest('hex');
  const startsAt=new Date(Date.now()+7*86400000).toISOString(),endsAt=new Date(Date.parse(startsAt)+1800000).toISOString();
  const oldFetch=global.fetch,oldClient=process.env.GOOGLE_CLIENT_ID,oldSecret=process.env.GOOGLE_CLIENT_SECRET;
  let inserted=0,deleted=0,messages=0;
  process.env.GOOGLE_CLIENT_ID='calendar-test-client';process.env.GOOGLE_CLIENT_SECRET='calendar-test-secret';
  global.fetch=async(url,options)=>{
    if(String(url).includes('graph.facebook.com')&&String(url).endsWith('/messages')){messages++;return Response.json({messages:[{id:'wamid.booking.'+messages}]});}
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-access'});
    if(String(url)==='https://www.googleapis.com/calendar/v3/freeBusy')return Response.json({calendars:{'owner@example.com':{busy:[]}}});
    if(options.method==='GET')return inserted<2?new Response('',{status:404}):Response.json({id:eventId,extendedProperties:{private:{crmReservationId:ids.reservation,crmBusinessId:ids.business}}});
    if(options.method==='DELETE'){deleted++;return new Response(null,{status:204});}
    assert.match(String(url),/www\.googleapis\.com\/calendar\/v3\/calendars\/owner%40example\.com\/events$/);
    assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);
    assert.equal(body.id,eventId);
    assert.equal(body.extendedProperties.private.crmReservationId,ids.reservation);
    inserted++;
    return inserted===1?new Response('{}',{status:503}):Response.json({id:eventId});
  };
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$2,$1)',[ids.business,'Calendar test']);
    await query('UPDATE businesses SET review_access=TRUE WHERE id=$1',[ids.business]);
    await query('INSERT INTO whatsapp_accounts(id,business_id,waba_id) VALUES($1,$2,$3)',[ids.account,ids.business,'waba_'+suffix]);
    await query('UPDATE whatsapp_accounts SET access_token_encrypted=$1 WHERE id=$2',[encryptSecret('meta-token'),ids.account]);
    await query('INSERT INTO whatsapp_phone_numbers(id,business_id,whatsapp_account_id,phone_number_id) VALUES($1,$2,$3,$4)',[ids.phone,ids.business,ids.account,'phone_'+suffix]);
    await query("UPDATE whatsapp_phone_numbers SET registration_state='registered' WHERE id=$1",[ids.phone]);
    await query('INSERT INTO contacts(id,business_id,name,phone) VALUES($1,$2,$3,$4)',[ids.contact,ids.business,'Test contact','1555'+suffix.replace(/[a-f]/g,'1').slice(0,7)]);
    await query('INSERT INTO whatsapp_native_flows(id,business_id,whatsapp_account_id,name,endpoint_phone_id) VALUES($1,$2,$3,$4,$5)',[ids.flow,ids.business,ids.account,'Calendar flow '+suffix,ids.phone]);
    await query('INSERT INTO flow_runtime_configs(flow_id,business_id,config) VALUES($1,$2,$3)',[ids.flow,ids.business,JSON.stringify({enabled:true,mode:'booking',resourceIds:[ids.resource],initialScreen:'CHOOSE',reviewScreen:'REVIEW',allowedActions:['list','reserve','confirm'],holdMinutes:10})]);
    await query("INSERT INTO flow_runtime_resources(id,business_id,kind,title,capacity,starts_at,ends_at,unit_price,currency) VALUES($1,$2,'slot',$3,1,$4,$5,0,'USD')",[ids.resource,ids.business,'Consultation',startsAt,endsAt]);
    await query("INSERT INTO flow_runtime_sessions(id,business_id,flow_id,phone_id,contact_id,token_hash,revision,screen,expires_at) VALUES($1,$2,$3,$4,$5,$6,1,'REVIEW',NOW()+INTERVAL '1 day')",[ids.session,ids.business,ids.flow,ids.phone,ids.contact,crypto.createHash('sha256').update(flowToken).digest('hex')]);
    await query("INSERT INTO flow_runtime_reservations(id,business_id,session_id,resource_id,quantity,snapshot,status,expires_at) VALUES($1,$2,$3,$4,1,$5,'held',NOW()+INTERVAL '1 day')",[ids.reservation,ids.business,ids.session,ids.resource,JSON.stringify({title:'Consultation',unit_price:'0',currency:'USD',catalog_id:'',retailer_id:'',starts_at:startsAt,ends_at:endsAt})]);
    await query("INSERT INTO availability_connections(id,business_id,provider,source,refresh_encrypted,granted_scopes) VALUES($1,$2,'google_calendar','calendar',$3,$4)",[ids.connection,ids.business,encryptSecret('refresh-token'),[GOOGLE_FREEBUSY_SCOPE,GOOGLE_EVENTS_SCOPE]]);
    await query('INSERT INTO availability_mappings(resource_id,business_id,connection_id,external_id,write_enabled) VALUES($1,$2,$3,$4,TRUE)',[ids.resource,ids.business,ids.connection,'owner@example.com']);
    await query("INSERT INTO templates(id,business_id,name,category,body,status,meta_template_name,waba_id) VALUES($1,$2,$3,'UTILITY','Booking status','Approved','booking_status',$4)",[ids.template,ids.business,'Booking status '+suffix,'waba_'+suffix]);
    await query('INSERT INTO availability_booking_notice_rules(business_id,kind,template_id,enabled) VALUES($1,\'confirmed\',$2,TRUE),($1,\'cancelled\',$2,TRUE)',[ids.business,ids.template]);
    enterTenantContext(ids.business);
    const flowResponse=await handleRuntimeExchange({businessId:ids.business,flowId:ids.flow,payload:{version:'3.0',action:'data_exchange',screen:'REVIEW',flow_token:flowToken,data:{operation:'confirm',request_id:'booking_'+suffix}}});
    assert.equal(flowResponse.screen,'SUCCESS');
    assert.equal(flowResponse.data.fulfillment_status,'pending_external');
    assert.equal((await query('SELECT status FROM flow_runtime_reservations WHERE id=$1',[ids.reservation])).rows[0].status,'pending_external');
    enterSystemContext();
    assert.deepEqual(await runCalendarFulfillment(),{claimed:1,confirmed:0,status:'pending'});
    assert.equal((await query('SELECT status FROM flow_runtime_reservations WHERE id=$1',[ids.reservation])).rows[0].status,'pending_external');
    await query('UPDATE availability_fulfillments SET next_attempt_at=NOW() WHERE reservation_id=$1',[ids.reservation]);
    assert.deepEqual(await runCalendarFulfillment(),{claimed:1,confirmed:1,cancelled:0});
    assert.equal(inserted,2);
    assert.equal((await query('SELECT status FROM flow_runtime_reservations WHERE id=$1',[ids.reservation])).rows[0].status,'confirmed');
    assert.equal((await verifiedSupportFacts(ids.business,ids.contact)).find(fact=>fact.kind==='crm_booking')?.id,`booking:${ids.reservation}`);
    assert.equal((await verifiedSupportFacts(ids.business,'other_contact')).length,0);
    assert.equal((await query('SELECT status FROM availability_fulfillments WHERE reservation_id=$1',[ids.reservation])).rows[0].status,'confirmed');
    assert.equal((await query("SELECT COUNT(*)::integer AS count FROM events WHERE business_id=$1 AND type='whatsapp_flow_booking_confirmed'",[ids.business])).rows[0].count,1);
    assert.equal((await query("SELECT status FROM availability_booking_notices WHERE business_id=$1 AND reservation_id=$2 AND kind='confirmed'",[ids.business,ids.reservation])).rows[0].status,'queued');
    assert.deepEqual(await runBookingNotices(),{claimed:1,status:'sent'});
    assert.equal(messages,1);
    assert.equal((await query("SELECT COUNT(*)::integer AS count FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.business_id=$1 AND m.metadata->>'bookingReservationId'=$2",[ids.business,ids.reservation])).rows[0].count,1);
    assert.equal((await query('SELECT COUNT(*)::integer AS count FROM message_usage_events WHERE business_id=$1',[ids.business])).rows[0].count,1);
    await query("UPDATE flow_runtime_reservations SET status='cancel_pending' WHERE id=$1",[ids.reservation]);
    await query("UPDATE availability_fulfillments SET requested_action='cancel',status='cancel_pending',next_attempt_at=NOW() WHERE reservation_id=$1",[ids.reservation]);
    assert.deepEqual(await runCalendarFulfillment(),{claimed:1,confirmed:0,cancelled:1});
    assert.equal(deleted,1);
    assert.equal((await query('SELECT status FROM flow_runtime_reservations WHERE id=$1',[ids.reservation])).rows[0].status,'cancelled');
    assert.equal((await query('SELECT status FROM availability_fulfillments WHERE reservation_id=$1',[ids.reservation])).rows[0].status,'cancelled');
    assert.equal((await query("SELECT status FROM availability_booking_notices WHERE business_id=$1 AND reservation_id=$2 AND kind='cancelled'",[ids.business,ids.reservation])).rows[0].status,'queued');
    assert.deepEqual(await runBookingNotices(),{claimed:1,status:'sent'});
    assert.equal(messages,2);
    assert.equal((await query('SELECT COUNT(*)::integer AS count FROM message_usage_events WHERE business_id=$1',[ids.business])).rows[0].count,2);
    const policy=(await query("SELECT c.relrowsecurity,c.relforcerowsecurity,p.qual FROM pg_class c JOIN pg_policies p ON p.tablename=c.relname WHERE c.relname='availability_fulfillments' AND p.policyname='tenant_isolation'")).rows[0];
    assert.equal(policy.relrowsecurity,true);
    assert.equal(policy.relforcerowsecurity,true);
    assert.match(policy.qual,/business_id/);
    const role=(await query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(!role.rolsuper&&!role.rolbypassrls){
      enterTenantContext('other_'+suffix);
      assert.equal((await query('SELECT 1 FROM availability_fulfillments WHERE reservation_id=$1',[ids.reservation])).rowCount,0);
    }
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[ids.business]);
    global.fetch=oldFetch;
    if(oldClient===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=oldClient;
    if(oldSecret===undefined)delete process.env.GOOGLE_CLIENT_SECRET;else process.env.GOOGLE_CLIENT_SECRET=oldSecret;
  }
});
