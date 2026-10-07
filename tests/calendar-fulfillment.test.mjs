import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarEventBody,createCalendarBooking,cancelCalendarBooking} from '../lib/calendar-fulfillment.js';
import {GOOGLE_EVENTS_SCOPE} from '../lib/external-availability.js';

const start=new Date(Date.now()+7*24*60*60*1000).toISOString();
const end=new Date(Date.parse(start)+30*60*1000).toISOString();
const job={business_id:'b_123',reservation_id:'frv_123',external_id:'abcd1234',external_target:'owner@example.com',granted_scopes:[GOOGLE_EVENTS_SCOPE],refresh_encrypted:'encrypted',snapshot:{title:'Consultation',starts_at:start,ends_at:end}};

test('Calendar booking includes stable event and reservation identity without customer PII',()=>{
  const body=calendarEventBody(job);
  assert.equal(body.id,job.external_id);
  assert.equal(body.extendedProperties.private.crmReservationId,job.reservation_id);
  assert.equal(body.extendedProperties.private.crmBusinessId,job.business_id);
  assert.equal(body.start.dateTime,start);
  assert.equal(body.end.dateTime,end);
});

test('Calendar booking accepts only the matching event after a duplicate response',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return calls.length===1?new Response('',{status:404}):Response.json({id:job.external_id,extendedProperties:{private:{crmReservationId:job.reservation_id,crmBusinessId:job.business_id}}});
    if(String(url).endsWith('/freeBusy'))return Response.json({calendars:{[job.external_target]:{busy:[]}}});
    return new Response('{}',{status:409});
  };
  assert.equal(await createCalendarBooking(job,{accessToken:'test-token',fetcher}),job.external_id);
  assert.equal(calls.length,4);
  assert.equal(calls[3].options.method,'GET');
  const mismatch=async()=>Response.json({id:job.external_id,extendedProperties:{private:{crmReservationId:'another',crmBusinessId:job.business_id}}});
  await assert.rejects(createCalendarBooking(job,{accessToken:'test-token',fetcher:mismatch}),{code:'CALENDAR_EVENT_CONFLICT'});
});

test('Calendar booking rechecks availability and cancellation verifies event ownership',async()=>{
  const busy=async(_url,options)=>options.method==='GET'?new Response('',{status:404}):Response.json({calendars:{[job.external_target]:{busy:[{start,end}]}}});
  await assert.rejects(createCalendarBooking(job,{accessToken:'test-token',fetcher:busy}),{code:'CALENDAR_BOOKING_REJECTED'});
  let deleted=false;
  const owned=async(_url,options)=>{
    if(options.method==='DELETE'){deleted=true;return new Response(null,{status:204});}
    return Response.json({id:job.external_id,extendedProperties:{private:{crmReservationId:job.reservation_id,crmBusinessId:job.business_id}}});
  };
  assert.equal(await cancelCalendarBooking(job,{accessToken:'test-token',fetcher:owned}),job.external_id);
  assert.equal(deleted,true);
  await assert.rejects(cancelCalendarBooking(job,{accessToken:'test-token',fetcher:async()=>Response.json({id:job.external_id,extendedProperties:{private:{crmReservationId:'other',crmBusinessId:job.business_id}}})}),{code:'CALENDAR_EVENT_CONFLICT'});
});

test('Calendar booking retries uncertain results and requires write authorization',async()=>{
  await assert.rejects(createCalendarBooking({...job,granted_scopes:[]},{accessToken:'test-token'}),{code:'AVAILABILITY_REAUTHORIZE'});
  await assert.rejects(createCalendarBooking(job,{accessToken:'test-token',fetcher:async()=>{throw new Error('network lost');}}),{code:'CALENDAR_RETRY'});
  await assert.rejects(createCalendarBooking(job,{accessToken:'test-token',fetcher:async()=>new Response('{}',{status:429})}),{code:'CALENDAR_RETRY'});
});
