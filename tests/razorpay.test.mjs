import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {verifyRazorpaySignature,paymentMinorUnits,paymentLinkState,razorpayCheckoutUrl,razorpayRequestRejected} from '../lib/razorpay.js';
import {invoiceCoversCurrentPeriod,verifiedSubscriptionStatus,razorpayPlanVersion} from '../lib/razorpay-billing.js';
import {receiveRazorpayBillingWebhook} from '../lib/razorpay-billing.js';

test('Razorpay signatures authenticate the exact raw body',()=>{
  const raw='{"event":"payment_link.paid"}',secret='private-webhook-key';
  const signature=crypto.createHmac('sha256',secret).update(raw).digest('hex');
  assert.doesNotThrow(()=>verifyRazorpaySignature(raw,signature,secret));
  assert.throws(()=>verifyRazorpaySignature(raw+' ',signature,secret));
  assert.throws(()=>verifyRazorpaySignature(raw,'00',secret));
});
test('payment amounts use exact currency precision',()=>{
  assert.equal(paymentMinorUnits('123.45','INR'),12345);
  assert.equal(paymentMinorUnits('100','JPY'),100);
  assert.equal(paymentMinorUnits('1.23','KWD'),1230);
  for(const [amount,currency] of [['0','INR'],['-1','INR'],['1.001','INR'],['1.234','KWD'],['2.1','JPY'],['1','ZZZ']])assert.throws(()=>paymentMinorUnits(amount,currency));
});
test('timeouts and conflicts remain unconfirmed rather than enabling duplicate charges',()=>{
  for(const statusCode of [408,409,500,502,504,undefined])assert.equal(razorpayRequestRejected({statusCode}),false);
  assert.equal(razorpayRequestRejected({statusCode:403}),true);
});
test('paid links must match company checkout reference, amount and currency',()=>{
  const checkout={id:'checkout-one',amount_minor:'5000',currency:'INR'};
  const link={id:'plink_valid',reference_id:checkout.id,amount:5000,amount_paid:5000,currency:'INR',status:'paid'};
  assert.equal(paymentLinkState(link,checkout),'captured');
  for(const change of [{reference_id:'another-company'},{currency:'USD'},{amount:5001},{amount_paid:4999}])assert.throws(()=>paymentLinkState({...link,...change},checkout));
});
test('checkout redirects reject unexpected hosts and credentials',()=>{
  assert.equal(razorpayCheckoutUrl('https://rzp.io/i/abc'),'https://rzp.io/i/abc');
  for(const url of ['http://rzp.io/i/a','https://rzp.io.attacker.test','https://attacker.test','https://user:secret@rzp.io/i/a'])assert.throws(()=>razorpayCheckoutUrl(url));
});
test('only a verified current-cycle invoice grants subscription access',()=>{
  const sub={id:'sub_one',current_start:100,current_end:200};
  const invoice={subscription_id:'sub_one',status:'paid',payment_id:'pay_one',amount_paid:1000,paid_at:110,billing_start:100,billing_end:200};
  assert.equal(invoiceCoversCurrentPeriod(invoice,sub,1000,150),true);
  for(const change of [{paid_at:null},{paid_at:99},{paid_at:201},{subscription_id:'sub_other'},{amount_paid:999}])assert.equal(invoiceCoversCurrentPeriod({...invoice,...change},sub,1000,150),false);
  assert.equal(invoiceCoversCurrentPeriod(invoice,sub,1000,201),false);
  assert.equal(verifiedSubscriptionStatus('active',false),'pending');
  assert.equal(verifiedSubscriptionStatus('active',true),'active');
  assert.equal(verifiedSubscriptionStatus('completed',true),'active');
  assert.equal(verifiedSubscriptionStatus('completed',false),'canceled');
  assert.equal(verifiedSubscriptionStatus('halted',true),'past_due');
});
test('admin price updates produce new provider plan versions',()=>{
  const plan={id:'plan',currency:'INR',monthly_price_cents:1000,yearly_price_cents:10000,updated_at:'today'};
  assert.notEqual(razorpayPlanVersion(plan,'monthly'),razorpayPlanVersion({...plan,monthly_price_cents:2000},'monthly'));
});
test('billing webhook rejects untrusted requests before accessing storage',async()=>{
  const result=await receiveRazorpayBillingWebhook(new Request('https://crm.example/api/webhooks/razorpay',{method:'POST',body:'{}',headers:{'x-razorpay-signature':'invalid'}}));
  assert.equal(result.status,403);
});
