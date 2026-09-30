import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {query,transaction,enterSystemContext} from '../lib/db.js';
import {applyFlowReply,applyEntryAttribution} from '../lib/whatsapp-experiences.js';
test('Flow responses and QR welcome workflows are tenant-bound, consent-safe and duplicate-safe',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),business='exp_'+suffix,other='other_'+suffix,contact='contact_'+suffix,phone='phone_'+suffix,number='555'+Date.now(),account='account_'+suffix,flow='native_'+suffix,conversation='conversation_'+suffix,token=crypto.randomBytes(32).toString('hex'),invite='invite_'+suffix,message='message_'+suffix,workflow='workflow_'+suffix;
  try{
    await query('INSERT INTO businesses (id,name,slug,review_access) VALUES ($1,$1,$1,TRUE),($2,$2,$2,TRUE)',[business,other]);
    await query("INSERT INTO contacts (id,business_id,name,phone,custom_attributes) VALUES ($1,$2,'Existing','15550001111',$3)",[contact,business,JSON.stringify({email:'existing@example.test'})]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[account,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,account,number]);
    await query('INSERT INTO conversations (id,business_id,contact_id,whatsapp_phone_number_id) VALUES ($1,$2,$3,$4)',[conversation,business,contact,number]);
    await query("INSERT INTO whatsapp_native_flows (id,business_id,whatsapp_account_id,name) VALUES ($1,$2,$3,'Profile')",[flow,business,account]);
    await query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id) VALUES ($1,$2,'incoming','Flow reply','received',$1)",[message,conversation]);
    const mapping=[{field:'email',target:'attribute',key:'email',mode:'fill'},{field:'company',target:'attribute',key:'company',mode:'replace'}];
    await query("INSERT INTO whatsapp_flow_invites (id,business_id,flow_id,contact_id,phone_id,token_hash,request_id,fingerprint,mapping,fields,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$1,'fixture',$7,$8,'sent',NOW()+INTERVAL '1 hour')",[invite,business,flow,contact,phone,crypto.createHash('sha256').update(token).digest('hex'),JSON.stringify(mapping),JSON.stringify(['email','company'])]);
    const response={businessId:business,contactId:contact,phoneNumberId:number,messageId:message,reply:{flow_token:token,email:'new@example.test',company:'Buyer company',marketing_permission:true},at:new Date()};
    assert.equal((await transaction(client=>applyFlowReply(client,{...response,businessId:other}))).matched,false);
    assert.equal((await transaction(client=>applyFlowReply(client,{...response,phoneNumberId:'foreign'}))).matched,false);
    assert.equal((await transaction(client=>applyFlowReply(client,response))).matched,true);
    assert.equal((await transaction(client=>applyFlowReply(client,response))).duplicate,true);
    const saved=(await query('SELECT * FROM contacts WHERE id=$1',[contact])).rows[0];assert.equal(saved.custom_attributes.email,'existing@example.test');assert.equal(saved.custom_attributes.company,'Buyer company');assert.equal(saved.marketing_permission,false);
    assert.equal((await query('SELECT 1 FROM whatsapp_flow_submissions WHERE business_id=$1',[business])).rowCount,1);
    await query("INSERT INTO automation_flows (id,business_id,name,status,trigger_mode,definition) VALUES ($1,$2,'Welcome','active','manual',$3)",[workflow,business,JSON.stringify({startNodeId:'end',nodes:[{id:'end',type:'end',body:''}]})]);
    await query("INSERT INTO whatsapp_entry_rules (id,business_id,phone_id,code,source_name,prefilled_message,workflow_id,cooldown_minutes) VALUES ($1,$2,$3,'QR_CODE','Store counter','Help from counter',$4,60)",['rule_'+suffix,business,phone,workflow]);
    const enter=async(messageId)=>{await query("INSERT INTO messages (id,conversation_id,direction,body,status,meta_message_id) VALUES ($1,$2,'incoming','Help from counter','received',$1)",[messageId,conversation]);return transaction(client=>applyEntryAttribution(client,{businessId:business,contactId:contact,phoneNumberId:number,messageId,text:'Help from counter',at:new Date()}));};
    assert.equal((await enter('qr_'+suffix)).status,'queued');assert.equal((await enter('qr_again_'+suffix)).status,'cooldown');
    assert.equal((await query('SELECT 1 FROM automation_sessions WHERE business_id=$1',[business])).rowCount,1);
    await query('UPDATE contacts SET unsubscribed=TRUE WHERE id=$1',[contact]);
    assert.equal((await enter('qr_optout_'+suffix)).status,'opted_out');assert.equal((await query('SELECT 1 FROM automation_sessions WHERE business_id=$1',[business])).rowCount,1);
    assert.equal((await query('SELECT 1 FROM whatsapp_entry_attributions WHERE business_id=$1',[other])).rowCount,0);
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
