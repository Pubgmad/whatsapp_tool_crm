import assert from 'node:assert/strict';
import test from 'node:test';
import {availableCapacity} from '../lib/flow-runtime.js';
import {codeChallenge,googleCalendarAvailable,shopifyQuantity} from '../lib/external-availability.js';

test('Google PKCE challenge uses SHA-256 base64url',()=>{
  assert.equal(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('mapped external capacity also accounts for local holds',()=>{
  assert.equal(availableCapacity(10,8,5),3);
  assert.equal(availableCapacity(10,4,5),0);
  assert.equal(availableCapacity(10,8,0),0);
  assert.equal(availableCapacity(10,8,null),8);
});

test('Shopify availability requires a matching tracked variant',async()=>{
  const previous=process.env.SHOPIFY_ADMIN_API_VERSION;
  process.env.SHOPIFY_ADMIN_API_VERSION='2026-07';
  try {
    const variantId='gid://shopify/ProductVariant/123';
    const input={domain:'example.myshopify.com',token:'test-token',variantId};
    const quantity=await shopifyQuantity({...input,fetcher:async(url,options)=>{
      assert.match(url,/example\.myshopify\.com\/admin\/api\/2026-07\/graphql\.json$/);
      assert.equal(JSON.parse(options.body).variables.id,variantId);
      return {data:{productVariant:{id:variantId,inventoryQuantity:6,inventoryItem:{tracked:true}}}};
    }});
    assert.equal(quantity,6);
    await assert.rejects(shopifyQuantity({...input,fetcher:async()=>({data:{productVariant:{id:variantId,inventoryQuantity:6,inventoryItem:{tracked:false}}}})}),{code:'AVAILABILITY_UNCONFIRMED'});
  } finally {
    if(previous===undefined)delete process.env.SHOPIFY_ADMIN_API_VERSION;
    else process.env.SHOPIFY_ADMIN_API_VERSION=previous;
  }
});

test('Google Calendar availability is fail-closed on provider errors',async()=>{
  const input={calendar:'team@example.com',startsAt:'2026-10-03T10:00:00Z',endsAt:'2026-10-03T11:00:00Z',accessToken:'test-token'};
  assert.equal(await googleCalendarAvailable({...input,fetcher:async(_url,options)=>{
    assert.equal(JSON.parse(options.body).items[0].id,input.calendar);
    return {calendars:{[input.calendar]:{busy:[]}}};
  }}),true);
  assert.equal(await googleCalendarAvailable({...input,fetcher:async()=>({calendars:{[input.calendar]:{busy:[{start:input.startsAt,end:input.endsAt}]}}})}),false);
  await assert.rejects(googleCalendarAvailable({...input,fetcher:async()=>({calendars:{[input.calendar]:{errors:[{reason:'forbidden'}]}}})}),{code:'AVAILABILITY_UNCONFIRMED'});
});
