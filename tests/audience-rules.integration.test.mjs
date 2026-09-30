import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { query, enterSystemContext } from '../lib/db.js';
import { audienceContactQuery } from '../lib/audience-rules.js';

test('dynamic audiences use actual campaign replies and captured tenant payments',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(6).toString('hex'),business='aud_'+suffix,other='audo_'+suffix;
  const a='a_'+suffix,b='b_'+suffix,c='c_'+suffix,x='x_'+suffix,k='k_'+suffix,t='t_'+suffix,cv='cv_'+suffix,wa='wa_'+suffix,phone='p_'+suffix;
  const match=async rules=>{const statement=audienceContactQuery(business,rules);return (await query(statement.text,statement.params)).rows.map(row=>row.id).sort();};
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query("INSERT INTO contacts (id,business_id,name,phone,marketing_permission,custom_attributes) VALUES ($1,$5,'Reader','15550001111',TRUE,'{\"stage\":\"lead\"}'),($2,$5,'Delivered','15550002222',TRUE,'{}'),($3,$5,'Unrelated','15550003333',TRUE,'{}'),($4,$6,'Foreign','15550001111',TRUE,'{}')",[a,b,c,x,business,other]);
    await query("INSERT INTO templates (id,business_id,name,body,status) VALUES ($1,$2,'Audience','Hello','Approved')",[t,business]);
    await query("INSERT INTO campaigns (id,business_id,name,template_id,status) VALUES ($1,$2,'Engagement',$3,'completed')",[k,business,t]);
    await query("INSERT INTO campaign_recipients (id,campaign_id,contact_id,message,status,sent_at) VALUES ($1,$3,$4,'Hello','read',NOW()),($2,$3,$5,'Hello','delivered',NOW())",['ra_'+suffix,'rb_'+suffix,k,a,b]);
    await query('INSERT INTO conversations (id,business_id,contact_id) VALUES ($1,$2,$3)',[cv,business,a]);
    await query("INSERT INTO messages (id,conversation_id,direction,body,status,campaign_recipient_id) VALUES ($1,$2,'incoming','Reply','received',$3)",['m_'+suffix,cv,'ra_'+suffix]);
    const engagement=(event,match='matched')=>({engagement:[{campaignId:k,event,match,withinDays:7}]});
    assert.deepEqual(await match(engagement('delivered')),[a,b].sort());
    assert.deepEqual(await match(engagement('read')),[a]);
    assert.deepEqual(await match(engagement('replied')),[a]);
    assert.deepEqual(await match(engagement('replied','not_matched')),[b]);
    assert.deepEqual(await match({attributes:[{key:'stage',operator:'equals',value:'lead'}]}),[a]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[wa,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,wa,'number_'+suffix]);
    await query("INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount,payment_status,payment_event_at) VALUES ($1,$2,$3,$1,'15550001111','catalog','[]','INR',10,'captured',NOW())",['order_'+suffix,business,phone]);
    assert.deepEqual(await match({...engagement('delivered'),purchase:'not_purchased'}),[b]);
    assert.deepEqual(await match({purchase:'purchased',purchaseWithinDays:7}),[a]);
    await query('UPDATE contacts SET unsubscribed=TRUE WHERE id=$1',[b]);
    assert.deepEqual(await match(engagement('replied','not_matched')),[]);
    const foreign=audienceContactQuery(other,engagement('delivered'));assert.equal((await query(foreign.text,foreign.params)).rowCount,0);
  }finally{enterSystemContext();await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});
