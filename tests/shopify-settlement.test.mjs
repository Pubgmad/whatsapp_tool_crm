import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyShopifyOAuthHmac} from '../lib/shopify-auth.js';
import {normalizeProviderEvent} from '../lib/provider-connectors.js';
import {verifiedShopifySettlement} from '../lib/shopify-drafts.js';

const money=amount=>({presentmentMoney:{amount,currencyCode:'USD'}});
const tx=(id,kind,amount,overrides={})=>({id:`gid://shopify/OrderTransaction/${id}`,kind,status:'SUCCESS',test:false,manualPaymentGateway:false,processedAt:'2026-10-01T00:00:00Z',amountSet:money(amount),...overrides});
const order=(transactions,status='PAID',refunded='0.00')=>({id:'gid://shopify/Order/123',test:false,displayFinancialStatus:status,transactions,totalReceivedSet:money('40.00'),totalRefundedSet:money(refunded)});

test('Shopify settlement requires actual non-test successful transactions and exact totals',()=>{
  const paid=verifiedShopifySettlement(order([tx(1,'SALE','40.00')]),'gid://shopify/Order/123','40.00','USD');
  assert.equal(paid.state,'captured');
  assert.equal(verifiedShopifySettlement(order([tx(1,'SALE','40.00'),tx(2,'REFUND','10.00')],'PARTIALLY_REFUNDED','10.00'),'gid://shopify/Order/123','40.00','USD').state,'partially_refunded');
  assert.equal(verifiedShopifySettlement(order([tx(1,'SALE','40.00'),tx(2,'REFUND','40.00')],'REFUNDED','40.00'),'gid://shopify/Order/123','40.00','USD').state,'refunded');
  for(const candidate of [order([tx(1,'SALE','39.00')]),order([tx(1,'SALE','40.00',{status:'PENDING'})]),order([tx(1,'SALE','40.00',{test:true})]),order([tx(1,'SALE','40.00',{manualPaymentGateway:true})]),order([tx(1,'SALE','40.00'),tx(1,'REFUND','1.00')],'PARTIALLY_REFUNDED','1.00')]){
    assert.throws(()=>verifiedShopifySettlement(candidate,'gid://shopify/Order/123','40.00','USD'));
  }
  assert.throws(()=>verifiedShopifySettlement(order([tx(1,'SALE','40.00')]),'gid://shopify/Order/456','40.00','USD'));
});

test('Shopify OAuth callback HMAC rejects changed or duplicate parameters',()=>{
  const secret='test-secret',params=new URLSearchParams({shop:'test.myshopify.com',state:'abc',code:'def'});
  const message=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&');
  params.set('hmac',crypto.createHmac('sha256',secret).update(message).digest('hex'));
  assert.equal(verifyShopifyOAuthHmac(params,secret),true);
  params.set('code','changed');assert.equal(verifyShopifyOAuthHmac(params,secret),false);
  params.set('code','def');params.append('code','def');assert.equal(verifyShopifyOAuthHmac(params,secret),false);
});

test('refund webhooks only trigger order reconciliation and cannot assert settlement amounts',()=>{
  const event=normalizeProviderEvent('shopify','refunds/create',{id:999,order_id:123,created_at:'2026-10-01T00:00:00Z',transactions:[{amount:'40.00'}]});
  assert.deepEqual(event,{resource:'order',externalId:'123',occurredAt:'2026-10-01T00:00:00.000Z',phone:'',amount:'0',currency:'USD',terminal:true,state:'refunded'});
  assert.throws(()=>verifiedShopifySettlement(order([tx(1,'SALE','40.00'),tx(2,'REFUND','20.00')],'REFUNDED','20.00'),'gid://shopify/Order/123','40.00','USD'),{code:'SHOPIFY_PAYMENT_MISMATCH'});
});
