import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,enterSystemContext,enterTenantContext} from '../lib/db.js';
import {resolveTrackedParameters,visitTrackedLink} from '../lib/click-tracking.js';
import {audienceContactQuery} from '../lib/audience-rules.js';
test('recipient tracking is idempotent, preview-safe, origin-checked and tenant-scoped',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
 const previous=process.env.APP_URL;process.env.APP_URL='https://crm.example.test';
 const suffix=crypto.randomBytes(6).toString('hex'),b='track_'+suffix,o='foreign_'+suffix,c='ct_'+suffix,t='tpl_'+suffix,k='camp_'+suffix,r='recipient_'+suffix,l='link_'+suffix;
 try{
  await query("INSERT INTO businesses(id,name,slug,account_status) VALUES($1,$1,$1,'active'),($2,$2,$2,'active')",[b,o]);
  await query("INSERT INTO contacts(id,business_id,name,phone,marketing_permission) VALUES($1,$2,$1,'15550004567',TRUE)",[c,b]);
  await query("INSERT INTO templates(id,business_id,name,body,status) VALUES($1,$2,$1,'Link {{1}}','Approved')",[t,b]);
  await query("INSERT INTO campaigns(id,business_id,name,template_id,status) VALUES($1,$2,$1,$3,'completed')",[k,b,t]);
  await query("INSERT INTO campaign_recipients(id,campaign_id,contact_id,message,status,sent_at) VALUES($1,$2,$3,'Link','sent',NOW())",[r,k,c]);
  await query("INSERT INTO tracked_link_definitions(id,business_id,name,destination,enabled,expires_days) VALUES($1,$2,'Checkout','https://shop.example.test/checkout',TRUE,7)",[l,b]);
  const args={businessId:b,contactId:c,recipientId:r,reference:r,variables:['{{tracked_link:'+l+'}}'],parameters:{}};
  const first=await resolveTrackedParameters(args),second=await resolveTrackedParameters(args);
  assert.equal(first.variables[0],second.variables[0]);
  await assert.rejects(resolveTrackedParameters({...args,businessId:o}));
  const code=new URL(first.variables[0]).pathname.split('/').at(-1),context={params:Promise.resolve({token:code})};
  const get=await visitTrackedLink(new Request(first.variables[0]),context);
  assert.equal(get.status,200);
  assert.equal((await query('SELECT confirmed_at FROM tracked_link_tokens WHERE business_id=$1',[b])).rows[0].confirmed_at,null);
  const denied=await visitTrackedLink(new Request(first.variables[0],{method:'POST',headers:{origin:'https://attacker.example.test'}}),context);
  assert.equal(denied.status,403);
  assert.equal((await query('SELECT COUNT(*)::int AS count FROM tracked_link_click_events WHERE business_id=$1',[b])).rows[0].count,0);
  const clickRequest=()=>new Request(first.variables[0],{method:'POST',headers:{origin:'https://crm.example.test'}});
  const clicked=await visitTrackedLink(clickRequest(),context);
  assert.equal(clicked.status,303);assert.equal(clicked.headers.get('location'),'https://shop.example.test/checkout');
  const firstConfirmed=(await query('SELECT confirmed_at FROM tracked_link_tokens WHERE business_id=$1',[b])).rows[0].confirmed_at;
  assert.ok(firstConfirmed);
  assert.equal((await visitTrackedLink(clickRequest(),context)).status,303);
  const metrics=(await query(`SELECT COUNT(*)::int AS total_clicks,COUNT(DISTINCT contact_id)::int AS unique_clickers,
    MIN(clicked_at) AS first_clicked_at,MAX(clicked_at) AS last_clicked_at
    FROM tracked_link_click_events WHERE business_id=$1 AND definition_id=$2`,[b,l])).rows[0];
  assert.equal(metrics.total_clicks,2);
  assert.equal(metrics.unique_clickers,1);
  assert.ok(new Date(metrics.first_clicked_at)<=new Date(metrics.last_clicked_at));
  assert.ok((await query('SELECT confirmed_at FROM tracked_link_tokens WHERE business_id=$1',[b])).rows[0].confirmed_at>=firstConfirmed);
  enterTenantContext(b);
  assert.equal((await query('SELECT COUNT(*)::int AS count FROM tracked_link_click_events')).rows[0].count,2);
  assert.equal((await query('UPDATE tracked_link_click_events SET clicked_at=NOW() RETURNING id')).rowCount,0);
  enterTenantContext(o);
  assert.equal((await query('SELECT COUNT(*)::int AS count FROM tracked_link_click_events')).rows[0].count,0);
  enterSystemContext();
  const statement=audienceContactQuery(b,{engagement:[{campaignId:k,event:'clicked',match:'matched'}]});
  assert.deepEqual((await query(statement.text,statement.params)).rows.map(row=>row.id),[c]);
  await query('UPDATE tracked_link_definitions SET enabled=FALSE WHERE id=$1',[l]);
  assert.equal((await visitTrackedLink(new Request(first.variables[0]),context)).status,404);
 }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN($1,$2)',[b,o]);if(previous===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous;}
});
