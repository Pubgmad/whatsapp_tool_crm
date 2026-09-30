import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,enterSystemContext} from '../lib/db.js';
import {ingestCallingWebhook} from '../lib/whatsapp-calling.js';

test('calling preserves tenant ownership, webhook ordering and terminal states',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),business='call_b_'+suffix,other='call_o_'+suffix,account='call_a_'+suffix,phone='call_p_'+suffix,number='call_num_'+suffix,provider='wacid.'+suffix;
  const offer={sdp_type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=fingerprint:sha-256 00:11\r\n'};
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,status) VALUES ($1,$2,$3,'connected')",[account,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,account,number]);
    const value={metadata:{phone_number_id:number},calls:[{id:provider,direction:'USER_INITIATED',from:'919999999999',event:'connect',timestamp:'1770000000',session:offer}]};
    await assert.rejects(ingestCallingWebhook(other,value),{code:'NOT_FOUND'});
    await ingestCallingWebhook(business,value);await ingestCallingWebhook(business,value);
    let row=(await query('SELECT * FROM whatsapp_calls WHERE business_id=$1',[business])).rows[0];assert.equal(row.status,'ringing');assert.equal(row.remote_session.sdp,offer.sdp);
    assert.equal((await query('SELECT * FROM whatsapp_calls WHERE business_id=$1',[business])).rowCount,1);
    await ingestCallingWebhook(business,{metadata:value.metadata,calls:[{id:provider,event:'terminate',timestamp:'1770000010'}]});
    await ingestCallingWebhook(business,{metadata:value.metadata,statuses:[{id:provider,type:'call',status:'ACCEPTED',timestamp:'1770000020'}]});
    row=(await query('SELECT * FROM whatsapp_calls WHERE business_id=$1',[business])).rows[0];assert.equal(row.status,'terminated');assert.deepEqual(row.remote_session,{});
    await assert.rejects(query("INSERT INTO whatsapp_calls (id,business_id,phone_number_id,remote_number,direction,status) VALUES ($1,$2,$3,'919999999999','USER_INITIATED','ringing')",['wrong_'+suffix,other,number]),{code:'23503'});
    await ingestCallingWebhook(business,{metadata:value.metadata,calls:[{id:'wacid.early'+suffix,direction:'BUSINESS_INITIATED',from:number,event:'connect',timestamp:'1770000030',session:{...offer,sdp_type:'answer'}}]});
    assert.equal((await query('SELECT 1 FROM whatsapp_call_webhook_buffer WHERE business_id=$1',[business])).rowCount,1);
    const tables=(await query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('whatsapp_calls','whatsapp_call_actions','whatsapp_call_permission_requests','whatsapp_call_webhook_buffer')")).rows;
    assert.equal(tables.length,4);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
  }finally{await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
test('native payments reject cross-company orders and duplicate uncertain checkout requests',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),business='native_b_'+suffix,other='native_o_'+suffix,account='native_a_'+suffix,phone='native_p_'+suffix,order='native_order_'+suffix;
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[account,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,account,'number_'+suffix]);
    await query("INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount) VALUES ($1,$2,$3,$4,'919999999999','123','[]','INR',50)",[order,business,phone,'source_'+suffix]);
    const sql="INSERT INTO whatsapp_native_checkouts (id,business_id,order_id,configuration_name,amount_minor,status) VALUES ($1,$2,$3,'real-config',5000,'unconfirmed')";
    await assert.rejects(query(sql,['wrong_'+suffix,other,order]),{code:'23503'});
    await query(sql,['first_'+suffix,business,order]);await assert.rejects(query(sql,['duplicate_'+suffix,business,order]),{code:'23505'});
    const tables=(await query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('whatsapp_native_checkouts','whatsapp_ads_connections','whatsapp_ads_operations')")).rows;
    assert.equal(tables.length,3);assert.ok(tables.every(t=>t.relrowsecurity&&t.relforcerowsecurity));
    await assert.rejects(query('INSERT INTO whatsapp_ads_connections (business_id,ad_account_id,page_id,phone_number_id,currency,access_token_encrypted) VALUES ($1,\'123\',\'456\',$2,\'INR\',\'encrypted\')',[other,'number_'+suffix]),{code:'23503'});
  }finally{await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
