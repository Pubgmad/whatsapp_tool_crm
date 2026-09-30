import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';

test('conversion settings and events enforce tenant ownership and unique outcome references', {skip:!process.env.TEST_DATABASE_URL}, async () => {
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const company='conversion_b_'+suffix,other='conversion_other_'+suffix;
  const account='conversion_w_'+suffix,contact='conversion_contact_'+suffix,conversation='conversion_c_'+suffix;
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[company,other]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[account,company,'200'+BigInt('0x'+suffix)]);
    await query("INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,'Customer','919999999999')",[contact,company]);
    await query('INSERT INTO conversations (id,business_id,contact_id) VALUES ($1,$2,$3)',[conversation,company,contact]);
    await assert.rejects(query('INSERT INTO whatsapp_conversion_settings (business_id,whatsapp_account_id,dataset_id,page_id,access_token_encrypted) VALUES ($1,$2,$3,$4,$5)',[other,account,'123','456','ciphertext']),{code:'23503'});
    await query('INSERT INTO whatsapp_conversion_settings (business_id,whatsapp_account_id,dataset_id,page_id,access_token_encrypted) VALUES ($1,$2,$3,$4,$5)',[company,account,'123','456','ciphertext']);
    const insert="INSERT INTO whatsapp_conversion_events (id,business_id,conversation_id,event_id,event_name,dataset_id,payload,status,consent_confirmed) VALUES ($1,$2,$3,'outcome','Lead','123','{}'::jsonb,'processing',TRUE)";
    await assert.rejects(query(insert,['wrong_'+suffix,other,conversation]),{code:'23503'});
    await query(insert,['event_'+suffix,company,conversation]);
    await assert.rejects(query(insert,['duplicate_'+suffix,company,conversation]),{code:'23505'});
    const flags=(await query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('whatsapp_conversion_settings','whatsapp_conversion_events')")).rows;
    assert.equal(flags.length,2);assert.ok(flags.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
    await query('DELETE FROM conversations WHERE id=$1',[conversation]);
    assert.equal((await query('SELECT id FROM whatsapp_conversion_events WHERE business_id=$1',[company])).rowCount,0);
    await query('DELETE FROM whatsapp_accounts WHERE id=$1',[account]);
    assert.equal((await query('SELECT business_id FROM whatsapp_conversion_settings WHERE business_id=$1',[company])).rowCount,0);
  } finally {await query('DELETE FROM businesses WHERE id IN ($1,$2)',[company,other]);}
});
