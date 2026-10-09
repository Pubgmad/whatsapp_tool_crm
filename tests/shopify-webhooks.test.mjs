import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {normalizeProviderEvent,verifyProviderSignature} from '../lib/provider-connectors.js';
import {reconcileShopifyWebhooks,SHOPIFY_WEBHOOK_TOPICS} from '../lib/shopify-auth.js';

const connectorId='pc_0123456789abcdef';
const callback='https://crm.example.test/api/connectors/events/'+connectorId;

async function withShopifyConfig(run){
  const saved={app:process.env.APP_URL,version:process.env.SHOPIFY_ADMIN_API_VERSION,privacy:process.env.SHOPIFY_PRIVACY_WEBHOOKS_CONFIGURED};
  process.env.APP_URL='https://crm.example.test';
  process.env.SHOPIFY_ADMIN_API_VERSION='2026-07';
  process.env.SHOPIFY_PRIVACY_WEBHOOKS_CONFIGURED='true';
  try{return await run();}
  finally{
    for(const [key,value] of [['APP_URL',saved.app],['SHOPIFY_ADMIN_API_VERSION',saved.version],['SHOPIFY_PRIVACY_WEBHOOKS_CONFIGURED',saved.privacy]])value===undefined?delete process.env[key]:process.env[key]=value;
  }
}

test('Shopify webhook reconciliation is idempotent when every callback is active',()=>withShopifyConfig(async()=>{
  let calls=0;
  const fetcher=async(_url,options)=>{
    calls++;
    const request=JSON.parse(options.body);
    assert.match(request.query,/ManagedWebhooks/);
    return Response.json({data:{webhookSubscriptions:{nodes:SHOPIFY_WEBHOOK_TOPICS.map((item,index)=>({id:`gid://shopify/WebhookSubscription/${index+1}`,topic:item.topic,uri:callback}))}}});
  };
  const status=await reconcileShopifyWebhooks({shop:'store.myshopify.com',token:'token',connectorId,fetcher});
  assert.equal(calls,1);
  assert.equal(status.state,'active');
  assert.equal(status.callbackUrl,callback);
  assert.ok(status.topics.every(item=>item.status===(item.privacy?'configured':'active')));
}));

test('Shopify webhook reconciliation repairs orders and reports app-level privacy configuration',()=>withShopifyConfig(async()=>{
  process.env.SHOPIFY_PRIVACY_WEBHOOKS_CONFIGURED='false';
  const operations=[];
  const fetcher=async(url,options)=>{
    assert.equal(String(url),'https://store.myshopify.com/admin/api/2026-07/graphql.json');
    const request=JSON.parse(options.body);
    if(request.query.includes('ManagedWebhooks'))return Response.json({data:{webhookSubscriptions:{nodes:[
      {id:'gid://shopify/WebhookSubscription/10',topic:'ORDERS_UPDATED',uri:callback},
      {id:'gid://shopify/WebhookSubscription/11',topic:'ORDERS_PAID',uri:'https://old.example.test/hook'}
    ]}}});
    if(request.query.includes('RepairWebhook')){
      operations.push(['repair',request.variables.id,request.variables.subscription.uri]);
      return Response.json({data:{webhookSubscriptionUpdate:{webhookSubscription:{id:request.variables.id,topic:'ORDERS_PAID',uri:callback},userErrors:[]}}});
    }
    if(request.query.includes('CreateWebhook')){
      operations.push(['create',request.variables.topic]);
      return Response.json({data:{webhookSubscriptionCreate:{webhookSubscription:{id:'gid://shopify/WebhookSubscription/20',topic:request.variables.topic,uri:callback},userErrors:[]}}});
    }
    throw new Error('Unexpected operation');
  };
  const status=await reconcileShopifyWebhooks({shop:'store.myshopify.com',token:'token',connectorId,fetcher});
  assert.equal(status.state,'privacy_action_required');
  assert.deepEqual(operations[0],['repair','gid://shopify/WebhookSubscription/11',callback]);
  assert.equal(status.topics.find(item=>item.topic==='REFUNDS_CREATE').status,'created');
  assert.ok(status.topics.filter(item=>item.privacy).every(item=>item.status==='configuration_required'));
  assert.equal(status.privacyCallbackUrl,'https://crm.example.test/api/webhooks/shopify/privacy');
  assert.equal(operations.length,2);
}));

test('verified Shopify privacy callbacks normalize without trusting customer payload data',()=>{
  const secret='shopify-app-secret';
  const raw=Buffer.from(JSON.stringify({shop_id:22,shop_domain:'store.myshopify.com',customer:{id:33,email:'private@example.test'},orders_to_redact:[44,45]}));
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('base64');
  assert.equal(verifyProviderSignature(raw,signature,secret),true);
  const event=normalizeProviderEvent('shopify','customers/redact',JSON.parse(raw));
  assert.equal(event.resource,'privacy');
  assert.equal(event.externalId,'33');
  assert.deepEqual(event.orderIds,['44','45']);
  assert.equal('email' in event,false);
});
