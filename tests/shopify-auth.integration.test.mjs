import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';
import {decryptSecret,encryptSecret} from '../lib/meta.js';
import {shopifyAccessToken} from '../lib/shopify-auth.js';

test('Shopify expiring offline token refresh is serialized and stores the rotated pair',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='sau_'+suffix,connection='avc_'+suffix;
  const saved={fetch:global.fetch,id:process.env.SHOPIFY_CLIENT_ID,secret:process.env.SHOPIFY_CLIENT_SECRET,encryption:process.env.ENCRYPTION_KEY};
  let exchanges=0;
  try{
    process.env.SHOPIFY_CLIENT_ID='test-client';process.env.SHOPIFY_CLIENT_SECRET='test-secret';process.env.ENCRYPTION_KEY='test-shopify-oauth-encryption-key';
    await query('INSERT INTO businesses(id,name,slug) VALUES($1,$1,$1)',[business]);
    await query("INSERT INTO availability_connections(id,business_id,provider,source,credential_encrypted,refresh_encrypted,auth_method,token_expires_at,refresh_expires_at) VALUES($1,$2,'shopify','store.myshopify.com',$3,$4,'oauth',NOW()-INTERVAL '1 minute',NOW()+INTERVAL '1 day')",[connection,business,encryptSecret('old-access'),encryptSecret('old-refresh')]);
    global.fetch=async(url,options)=>{
      exchanges++;assert.equal(String(url),'https://store.myshopify.com/admin/oauth/access_token');
      assert.equal(new URLSearchParams(options.body).get('refresh_token'),'old-refresh');
      return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600,refresh_token_expires_in:86400});
    };
    const input={id:connection,business_id:business,source:'store.myshopify.com',auth_method:'oauth'};
    const tokens=await Promise.all([shopifyAccessToken(input),shopifyAccessToken(input)]);
    assert.deepEqual(tokens,['new-access','new-access']);assert.equal(exchanges,1);
    const row=(await query('SELECT credential_encrypted,refresh_encrypted,token_expires_at FROM availability_connections WHERE id=$1 AND business_id=$2',[connection,business])).rows[0];
    assert.equal(decryptSecret(row.credential_encrypted),'new-access');assert.equal(decryptSecret(row.refresh_encrypted),'new-refresh');
    assert.ok(new Date(row.token_expires_at).getTime()>Date.now()+3000000);
    await query("UPDATE availability_connections SET token_expires_at=NOW()-INTERVAL '1 minute',refresh_expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[connection]);
    await assert.rejects(()=>shopifyAccessToken(input),{code:'SHOPIFY_REAUTHORIZE'});
  }finally{
    enterSystemContext();await query('DELETE FROM businesses WHERE id=$1',[business]);
    global.fetch=saved.fetch;
    for(const [key,value] of [['SHOPIFY_CLIENT_ID',saved.id],['SHOPIFY_CLIENT_SECRET',saved.secret],['ENCRYPTION_KEY',saved.encryption]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
