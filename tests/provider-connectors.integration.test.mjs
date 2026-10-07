import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';
import {encryptSecret} from '../lib/meta.js';
import {receiveProviderEvent,runProviderConnectorEvents} from '../lib/provider-connectors.js';

test('signed connector deliveries are idempotent and never create consent or outbound jobs', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const businessId='connector_b_'+suffix,connectorId='pc_'+suffix,secret='connector-secret-'+suffix;
  const raw=Buffer.from(JSON.stringify({id:123,updated_at:new Date().toISOString(),total_price:'10.00',currency:'USD',phone:'+15550001111'}));
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  const url='https://crm.example.test/api/connectors/events/'+connectorId;
  const headers={'content-type':'application/json','x-shopify-hmac-sha256':signature,'x-shopify-shop-domain':'test.myshopify.com','x-shopify-topic':'orders/create','x-shopify-event-id':'event-123'};
  const deliver=(overrides={})=>receiveProviderEvent(new Request(url,{method:'POST',headers:{...headers,...overrides},body:raw}),{params:Promise.resolve({connectorId})});
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)',[businessId]);
    await query('INSERT INTO provider_connectors (id,business_id,name,provider,source,secret_encrypted) VALUES ($1,$2,$3,$4,$5,$6)',[connectorId,businessId,'Store','shopify','test.myshopify.com',encryptSecret(secret)]);
    assert.equal((await deliver({'x-shopify-hmac-sha256':crypto.createHmac('sha256','wrong').update(raw).digest('base64')})).status,401);
    assert.equal((await deliver()).status,202);
    assert.equal((await deliver()).status,200);
    assert.equal((await query('SELECT id FROM provider_connector_events WHERE connector_id=$1',[connectorId])).rowCount,1);
    enterSystemContext();
    assert.deepEqual(await runProviderConnectorEvents(),{processed:0,skipped:1});
    const event=(await query('SELECT status,error_code FROM provider_connector_events WHERE connector_id=$1',[connectorId])).rows[0];
    assert.deepEqual(event,{status:'skipped',error_code:'STATE_ONLY'});
    assert.equal((await query('SELECT id FROM automation_jobs WHERE business_id=$1',[businessId])).rowCount,0);
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[businessId]);
  }
});

test('completed Shopify order removes its checkout from recovery review', {skip:!process.env.TEST_DATABASE_URL}, async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex');
  const businessId='connector_b_'+suffix,connectorId='pc_'+suffix,secret='connector-secret-'+suffix;
  const at=new Date(Date.now()-7200000).toISOString();
  async function deliver(topic,payload,eventId){
    const raw=Buffer.from(JSON.stringify(payload));
    const response=await receiveProviderEvent(new Request('https://crm.example.test/api/connectors/events/'+connectorId,{method:'POST',headers:{'x-shopify-hmac-sha256':crypto.createHmac('sha256',secret).update(raw).digest('base64'),'x-shopify-shop-domain':'test.myshopify.com','x-shopify-topic':topic,'x-shopify-event-id':eventId},body:raw}),{params:Promise.resolve({connectorId})});
    assert.equal(response.status,202);
  }
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)',[businessId]);
    await query('INSERT INTO provider_connectors (id,business_id,name,provider,source,secret_encrypted) VALUES ($1,$2,$3,$4,$5,$6)',[connectorId,businessId,'Store','shopify','test.myshopify.com',encryptSecret(secret)]);
    await deliver('checkouts/update',{token:'checkout_123',updated_at:at,total_price:'10.00',currency:'USD'},'checkout-1');
    enterSystemContext();
    await runProviderConnectorEvents();
    const candidates=()=>query(`SELECT r.external_id FROM provider_connector_records r JOIN provider_connectors c ON c.id=r.connector_id
      WHERE r.business_id=$1 AND r.resource='checkout' AND r.data->>'terminal'='false' AND r.occurred_at<=NOW()-(c.recovery_after_minutes*INTERVAL '1 minute')
        AND NOT EXISTS (SELECT 1 FROM provider_connector_records o WHERE o.business_id=r.business_id AND o.connector_id=r.connector_id AND o.resource='order' AND o.data->>'checkoutId'=r.external_id)`,[businessId]);
    assert.equal((await candidates()).rowCount,1);
    await deliver('orders/create',{id:123,checkout_id:987,checkout_token:'checkout_123',updated_at:at,total_price:'10.00',currency:'USD'},'order-1');
    enterSystemContext();
    await runProviderConnectorEvents();
    assert.equal((await candidates()).rowCount,0);
  }finally{
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1',[businessId]);
  }
});
