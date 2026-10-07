import assert from 'node:assert/strict';
import test from 'node:test';
import {shopifyDraftInput,confirmedDraftStock,verifiedShopifyOrderSnapshot} from '../lib/shopify-drafts.js';

test('Shopify draft input carries one mapped variant and stable CRM identity, not payment claims',()=>{
  const input=shopifyDraftInput({order_id:'wo_123',variant_id:'gid://shopify/ProductVariant/123',quantity:2,tag:'wcrm_wo_123'});
  assert.deepEqual(input.lineItems,[{variantId:'gid://shopify/ProductVariant/123',quantity:2}]);
  assert.deepEqual(input.tags,['wcrm_wo_123']);
  assert.doesNotMatch(JSON.stringify(input),/paid|captured|financialStatus/i);
});

test('Shopify draft input rejects invalid variant and quantity',()=>{
  assert.throws(()=>shopifyDraftInput({order_id:'wo_123',variant_id:'bad',quantity:1,tag:'wcrm_wo_123'}),{code:'SHOPIFY_DRAFT_INVALID'});
  assert.throws(()=>shopifyDraftInput({order_id:'wo_123',variant_id:'gid://shopify/ProductVariant/123',quantity:0,tag:'wcrm_wo_123'}),{code:'SHOPIFY_DRAFT_INVALID'});
});

test('draft handoff fails closed on stale, untracked or insufficient Shopify inventory',()=>{
  const variantId='gid://shopify/ProductVariant/123';
  const result={productVariant:{id:variantId,inventoryQuantity:3,inventoryItem:{tracked:true}}};
  assert.equal(confirmedDraftStock(result,variantId,2),3);
  assert.throws(()=>confirmedDraftStock(result,variantId,4),{code:'SHOPIFY_OUT_OF_STOCK'});
  assert.throws(()=>confirmedDraftStock(result,'gid://shopify/ProductVariant/456',1),{code:'SHOPIFY_STOCK_UNCONFIRMED'});
  assert.throws(()=>confirmedDraftStock({productVariant:{...result.productVariant,inventoryItem:{tracked:false}}},variantId,1),{code:'SHOPIFY_STOCK_UNCONFIRMED'});
});

test('Shopify order snapshot distinguishes a draft, reported payment, and amount mismatch',()=>{
  const draftId='gid://shopify/DraftOrder/123';
  assert.deepEqual(verifiedShopifyOrderSnapshot({id:draftId,status:'OPEN',order:null},draftId,'40.00','USD'),
    {orderId:null,status:'OPEN',financialStatus:null,amount:null,currency:null,amountMatches:null});
  const completed={id:draftId,status:'COMPLETED',order:{id:'gid://shopify/Order/456',displayFinancialStatus:'PAID',currentTotalPriceSet:{presentmentMoney:{amount:'40.00',currencyCode:'USD'}}}};
  assert.equal(verifiedShopifyOrderSnapshot(completed,draftId,'40.00','USD').amountMatches,true);
  assert.equal(verifiedShopifyOrderSnapshot(completed,draftId,'41.00','USD').amountMatches,false);
  assert.equal(verifiedShopifyOrderSnapshot(completed,draftId,'40.00','INR').amountMatches,false);
  assert.equal(verifiedShopifyOrderSnapshot({...completed,order:{...completed.order,currentTotalPriceSet:{presentmentMoney:{amount:'40.001',currencyCode:'USD'}}}},draftId,'40.000','USD').amountMatches,false);
  assert.throws(()=>verifiedShopifyOrderSnapshot(completed,'gid://shopify/DraftOrder/999','40.00','USD'),{code:'SHOPIFY_ORDER_UNCONFIRMED'});
  assert.throws(()=>verifiedShopifyOrderSnapshot({...completed,order:null},draftId,'40.00','USD'),{code:'SHOPIFY_ORDER_UNCONFIRMED'});
});
