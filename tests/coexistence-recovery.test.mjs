import test from 'node:test';
import assert from 'node:assert/strict';
import {coexistenceFailureState} from '../lib/coexistence.js';
import crypto from 'node:crypto';
import {query,enterSystemContext} from '../lib/db.js';
import {encryptSecret} from '../lib/meta.js';
import {requestCoexistenceSync,coexistenceStatusForBusiness} from '../lib/coexistence.js';

test('coexistence recovery retries only definitive provider rejections',()=>{
  for(const status of [400,401,403,404,422,429])assert.equal(coexistenceFailureState({status}),'failed');
  for(const error of [new Error('timeout'),{status:408},{status:409},{status:500},{status:502}])assert.equal(coexistenceFailureState(error),'unconfirmed');
});

test('uncertain coexistence requests are not replayed and progress stays tenant-scoped',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const originalKey=process.env.ENCRYPTION_KEY,originalFetch=globalThis.fetch;
  process.env.ENCRYPTION_KEY=crypto.randomBytes(32).toString('hex');
  const suffix=crypto.randomBytes(8).toString('hex'),business='recovery_b_'+suffix,account='recovery_a_'+suffix,phone='recovery_p_'+suffix,number='number_'+suffix;
  let attempts=0;
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)',[business]);
    await query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,access_token_encrypted,onboarding_method) VALUES ($1,$2,$3,$4,'coexistence')",[account,business,'waba_'+suffix,encryptSecret('mock-provider-token')]);
    await query("INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,onboarding_method) VALUES ($1,$2,$3,$4,'coexistence')",[phone,business,account,number]);
    await query("INSERT INTO whatsapp_coexistence_sync (phone_id,business_id,onboarding_at) VALUES ($1,$2,NOW())",[phone,business]);
    globalThis.fetch=async()=>{attempts++;return Response.json({error:{message:'Provider unavailable'}},{status:502});};
    await assert.rejects(requestCoexistenceSync(business,number,'history'),{code:'COEXISTENCE_SYNC_FAILED'});
    assert.equal((await coexistenceStatusForBusiness(business))[0].coexistence.historyStatus,'unconfirmed');
    await assert.rejects(requestCoexistenceSync(business,number,'history'),{code:'COEXISTENCE_SYNC_UNCONFIRMED'});
    assert.equal(attempts,1);
    assert.deepEqual(await coexistenceStatusForBusiness('other_'+suffix),[]);
    await query("UPDATE whatsapp_coexistence_sync SET contacts_status='requesting',contacts_claimed_at=NOW()-INTERVAL '3 minutes' WHERE phone_id=$1",[phone]);
    assert.equal((await coexistenceStatusForBusiness(business))[0].coexistence.contactsStatus,'unconfirmed');
    await query("UPDATE whatsapp_coexistence_sync SET contacts_status='not_requested',onboarding_at=NOW()-INTERVAL '2 days' WHERE phone_id=$1",[phone]);
    await assert.rejects(requestCoexistenceSync(business,number,'contacts'),{code:'COEXISTENCE_SYNC_WINDOW_CLOSED'});
    assert.equal(attempts,1);
  }finally{
    globalThis.fetch=originalFetch;
    await query('DELETE FROM businesses WHERE id=$1',[business]);
    if(originalKey===undefined)delete process.env.ENCRYPTION_KEY;else process.env.ENCRYPTION_KEY=originalKey;
  }
});
