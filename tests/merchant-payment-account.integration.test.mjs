import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';
import { createSessionToken } from '../lib/auth.js';
import { getMerchantPayments } from '../lib/merchant-payments.js';

test('merchant checkouts expose their real sender WABA and bounded utility templates', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  enterSystemContext();
  const suffix = crypto.randomBytes(6).toString('hex');
  const business = `pay_b_${suffix}`, user = `pay_u_${suffix}`;
  const accountA = `pay_a_${suffix}`, accountB = `pay_ba_${suffix}`;
  const phone = `pay_p_${suffix}`, order = `pay_o_${suffix}`, checkout = `pay_c_${suffix}`;
  try {
    await query('INSERT INTO businesses(id,name,slug,waba_id) VALUES($1,$1,$1,$2)', [business, '10001']);
    await query("INSERT INTO users(id,name,email,password_hash) VALUES($1,$1,$2,'unused')", [user, `${user}@example.test`]);
    await query("INSERT INTO memberships(id,user_id,business_id,role) VALUES($1,$2,$3,'Owner')", [`mem_${suffix}`, user, business]);
    await query('INSERT INTO whatsapp_accounts(id,business_id,waba_id) VALUES($1,$2,$3),($4,$2,$5)', [accountA, business, '10001', accountB, '10002']);
    await query('INSERT INTO whatsapp_phone_numbers(id,business_id,whatsapp_account_id,phone_number_id) VALUES($1,$2,$3,$4)', [phone, business, accountB, `num_${suffix}`]);
    await query("INSERT INTO whatsapp_orders(id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount) VALUES($1,$2,$3,$4,'15550001111','catalog','[]','USD',12)", [order, business, phone, `source_${suffix}`]);
    await query("INSERT INTO merchant_checkouts(id,business_id,order_id,amount_minor,currency,status) VALUES($1,$2,$3,1200,'USD','pending')", [checkout, business, order]);
    await query("INSERT INTO templates(id,business_id,waba_id,name,body,status,category,variables) VALUES($1,$2,$3,'pay_link','Use {{1}}','Approved','UTILITY','[\"1\"]')", [`template_${suffix}`, business, '10002']);
    const token = createSessionToken({ userId: user, businessId: business, role: 'Owner', sessionVersion: 0 });
    const response = await getMerchantPayments(new Request('https://crm.example.test/api/whatsapp/payments', { headers: { cookie: `wcrm_session=${encodeURIComponent(token)}` } }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.checkouts[0].sender_waba_id, '10002');
    assert.equal(payload.checkouts[0].default_waba_id, '10001');
    assert.equal(payload.templates[0].wabaId, '10002');
    assert.ok(payload.templates.length <= 25);
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1', [business]);
    await query('DELETE FROM users WHERE id=$1', [user]);
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});
