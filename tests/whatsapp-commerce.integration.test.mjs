import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';
import { ingestCatalogOrder, reconcileWhatsAppPayment } from '../lib/whatsapp-commerce.js';

test('commerce ingestion and reconciliation remain idempotent and company-scoped', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix = crypto.randomBytes(8).toString('hex');
  const company = `commerce_b_${suffix}`;
  const other = `commerce_other_${suffix}`;
  const account = `commerce_w_${suffix}`;
  const phone = `commerce_p_${suffix}`;
  const metaPhone = `100${BigInt(`0x${suffix}`)}`;
  const message = { id: `wamid.${suffix}`, from: '919999999999', type: 'order', order: { catalog_id: '123', product_items: [{ product_retailer_id: 'sku', quantity: 3, item_price: '0.10', currency: 'INR' }] } };
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)', [company, other]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)', [account, company, `200${BigInt(`0x${suffix}`)}`]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)', [phone, company, account, metaPhone]);
    await ingestCatalogOrder(company, metaPhone, message);
    await ingestCatalogOrder(company, metaPhone, message);
    await ingestCatalogOrder(other, metaPhone, message);
    const orders = (await query('SELECT * FROM whatsapp_orders WHERE business_id IN ($1,$2)', [company, other])).rows;
    assert.equal(orders.length, 1); assert.equal(orders[0].total_amount, '0.300000');
    await assert.rejects(query(
      `INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount)
       VALUES ($1,$2,$3,$4,'919999999999','123','[]'::jsonb,'INR',1)`,
      [`invalid_${suffix}`, other, phone, `invalid_message_${suffix}`]
    ), { code: '23503' });
    await query('UPDATE whatsapp_orders SET reference_id=$1,checkout_message_id=$2 WHERE id=$3', [`ref_${suffix}`, `checkout_${suffix}`, orders[0].id]);
    const payment = { id: `checkout_${suffix}`, type: 'payment', status: 'captured', timestamp: '1700000000', payment: { reference_id: `ref_${suffix}` } };
    assert.equal(await reconcileWhatsAppPayment(other, metaPhone, payment), false);
    assert.equal(await reconcileWhatsAppPayment(company, metaPhone, payment), true);
    assert.equal(await reconcileWhatsAppPayment(company, metaPhone, payment), true);
    await reconcileWhatsAppPayment(company, metaPhone, { ...payment, status: 'pending', timestamp: '1700000100' });
    assert.equal((await query('SELECT payment_status FROM whatsapp_orders WHERE id=$1', [orders[0].id])).rows[0].payment_status, 'captured');
    const flags = (await query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('whatsapp_orders','whatsapp_payment_events')")).rows;
    assert.equal(flags.length, 2); assert.ok(flags.every((row) => row.relrowsecurity && row.relforcerowsecurity));
  } finally {
    await query('DELETE FROM businesses WHERE id IN ($1,$2)', [company, other]);
  }
});
