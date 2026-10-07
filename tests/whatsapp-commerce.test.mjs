import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogOrder, canTransitionOrder, ingestCatalogOrder, reconcileWhatsAppPayment } from '../lib/whatsapp-commerce.js';

const message = () => ({ id: 'wamid.order', from: '919999999999', type: 'order', order: { catalog_id: '123', product_items: [{ product_retailer_id: 'sku', quantity: 3, item_price: '0.10', currency: 'INR' }] } });

test('catalog order totals use exact decimal arithmetic', () => {
  assert.equal(normalizeCatalogOrder(message()).totalAmount, '0.300000');
  assert.equal(normalizeCatalogOrder({ type: 'text' }), null);
});

test('catalog orders reject ambiguous prices, currencies and quantities', () => {
  for (const patch of [{ item_price: 'NaN' }, { item_price: '-1' }, { item_price: '1e3' }, { quantity: 0 }, { quantity: 0.5 }, { currency: '' }]) {
    const input = message(); Object.assign(input.order.product_items[0], patch);
    assert.throws(() => normalizeCatalogOrder(input), { code: 'INVALID_WHATSAPP_ORDER' });
  }
  const input = message(); input.order.product_items.push({ ...input.order.product_items[0], currency: 'USD' });
  assert.throws(() => normalizeCatalogOrder(input), { code: 'INVALID_WHATSAPP_ORDER' });
});

test('order ingestion resolves a company-owned phone and is idempotent', async () => {
  await ingestCatalogOrder('company', '321', message(), async (sql, params) => {
    assert.match(sql, /p.business_id=\$2 AND p.phone_number_id=\$3/);
    assert.match(sql, /ON CONFLICT \(business_id,source_message_id\) DO NOTHING/);
    assert.deepEqual(params.slice(1,4), ['company', '321', 'wamid.order']);
  });
});

test('fulfillment cannot resurrect completed orders or cancel captured payments', () => {
  assert.equal(canTransitionOrder('pending', 'processing', 'unpaid'), true);
  assert.equal(canTransitionOrder('completed', 'pending', 'unpaid'), false);
  assert.equal(canTransitionOrder('processing', 'cancelled', 'captured'), false);
  assert.equal(canTransitionOrder('processing', 'cancelled', 'partially_refunded'), false);
});

test('payments require matching phone, reference and checkout message', async () => {
  let queries = 0;
  const updated = await reconcileWhatsAppPayment('company', '321', { id: 'wamid.checkout', type: 'payment', status: 'captured', timestamp: '1700000000', payment: { reference_id: 'order-reference' } }, async (run) => run({ query: async (sql, params) => {
    queries++;
    assert.match(sql, /o.checkout_message_id=\$4/);
    assert.deepEqual(params, ['company', '321', 'order-reference', 'wamid.checkout']);
    return { rows: [] };
  } }));
  assert.equal(updated, false); assert.equal(queries, 1);
});

test('delayed pending events cannot downgrade a captured payment', async () => {
  const calls = [];
  await reconcileWhatsAppPayment('company', '321', { id: 'wamid.checkout', type: 'payment', status: 'pending', timestamp: '1700000000', payment: { reference_id: 'reference' } }, async (run) => run({ query: async (sql, params) => {
    calls.push(sql);
    if (sql.startsWith('SELECT 1 FROM shopify_order_settlements')) return {rowCount:0,rows:[]};
    if (sql.startsWith('SELECT')) return { rows: [{ id: 'order', payment_status: 'captured', payment_event_at: new Date() }] };
    return { rowCount: 1, rows: [{ id: 'event' }] };
  } }));
  assert.equal(calls.length, 3);
});

test('Meta payment events do not overwrite a verified Shopify settlement', async () => {
  const calls=[];
  const handled=await reconcileWhatsAppPayment('company','321',{id:'wamid.checkout',type:'payment',status:'pending',timestamp:'1700000000',payment:{reference_id:'reference'}},async run=>run({query:async sql=>{
    calls.push(sql);
    if(sql.startsWith('SELECT 1 FROM shopify_order_settlements'))return {rowCount:1,rows:[{order_id:'order'}]};
    return {rows:[{id:'order',payment_status:'refunded'}]};
  }}));
  assert.equal(handled,false);assert.equal(calls.length,2);
});
