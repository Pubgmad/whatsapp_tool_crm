import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';
import {publicWebview} from '../lib/whatsapp-webviews.js';

test('hosted pages use the connected business phone and disappear when it disconnects',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const first='wb_'+suffix,account='wa_'+suffix,phone='wap_'+suffix,view='wv_'+suffix;
  try{
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$2,$1)',[first,'First business']);
    await query("INSERT INTO whatsapp_accounts(id,business_id,waba_id,status) VALUES($1,$2,$3,'connected')",[account,first,'1'+BigInt('0x'+suffix).toString()]);
    await query("INSERT INTO whatsapp_phone_numbers(id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,registration_state) VALUES($1,$2,$3,$4,$5,'registered')",[phone,first,account,'2'+BigInt('0x'+suffix).toString(),'+1 555 000 1234']);
    await query('INSERT INTO whatsapp_webviews(id,business_id,phone_id,title,description,button_label,prefilled_message,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,TRUE)',[view,first,phone,'Help','Talk to our team','Chat','Hello']);
    assert.equal((await publicWebview(view)).url,'https://wa.me/15550001234?text=Hello');
    enterSystemContext();
    await query("UPDATE whatsapp_accounts SET status='disconnected' WHERE id=$1",[account]);
    assert.equal(await publicWebview(view),null);
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[first]);
  }
});
