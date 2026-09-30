import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {enterSystemContext,query} from '../lib/db.js';
import {applyMerchantLink} from '../lib/merchant-payments.js';
import {reconcileSubscription} from '../lib/razorpay-billing.js';

test('merchant checkout ledger isolates tenants and never downgrades a captured payment',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='pay_b_'+suffix,other='pay_o_'+suffix;
  const account='pay_a_'+suffix,phone='pay_p_'+suffix,order='pay_order_'+suffix,checkout='pay_c_'+suffix;
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1),($2,$2,$2)',[business,other]);
    await query('INSERT INTO whatsapp_accounts (id,business_id,waba_id) VALUES ($1,$2,$3)',[account,business,'waba_'+suffix]);
    await query('INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id) VALUES ($1,$2,$3,$4)',[phone,business,account,'number_'+suffix]);
    await query("INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount) VALUES ($1,$2,$3,$4,'919999999999','catalog','[]','INR',50)",[order,business,phone,'source_'+suffix]);
    const insert="INSERT INTO merchant_checkouts (id,business_id,order_id,amount_minor,currency,status) VALUES ($1,$2,$3,5000,'INR','processing') RETURNING *";
    await assert.rejects(query(insert,['wrong_'+suffix,other,order]),{code:'23503'});
    const row=(await query(insert,[checkout,business,order])).rows[0];
    await assert.rejects(query(insert,['duplicate_'+suffix,business,order]),{code:'23505'});
    const link={id:'plink_'+suffix,reference_id:checkout,amount:5000,amount_paid:5000,currency:'INR',status:'paid',short_url:'https://rzp.io/i/'+suffix};
    await assert.rejects(applyMerchantLink(business,row,{...link,amount:4999}));
    assert.equal((await applyMerchantLink(business,row,link,'event_'+suffix)).status,'captured');
    assert.equal((await applyMerchantLink(business,row,link,'event_'+suffix)).duplicate,true);
    await applyMerchantLink(business,row,{...link,status:'created',amount_paid:0});
    assert.equal((await query('SELECT payment_status FROM whatsapp_orders WHERE id=$1',[order])).rows[0].payment_status,'captured');
    assert.equal((await query('SELECT status FROM merchant_checkouts WHERE id=$1',[checkout])).rows[0].status,'captured');
    const flags=(await query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('merchant_payment_settings','merchant_checkouts','merchant_payment_webhooks','razorpay_subscription_checkouts')")).rows;
    assert.equal(flags.length,4);assert.ok(flags.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  }finally{await query('DELETE FROM businesses WHERE id IN ($1,$2)',[business,other]);}
});

test('subscription access requires captured current-cycle payment and deduplicates webhooks',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;enterSystemContext();
  const suffix=crypto.randomBytes(8).toString('hex'),business='billing_b_'+suffix,plan='billing_plan_'+suffix;
  const checkout={id:'billing_c_'+suffix,business_id:business,provider_subscription_id:'sub_'+suffix};
  const providerPlan='plan_'+suffix,now=Math.floor(Date.now()/1000),start=now-100,end=now+3600;
  const subscription={id:checkout.provider_subscription_id,notes:{checkoutId:checkout.id},plan_id:providerPlan,status:'active',current_start:start,current_end:end};
  const invoice={id:'inv_'+suffix,subscription_id:subscription.id,status:'paid',payment_id:'pay_'+suffix,amount_paid:5000,paid_at:now-50,billing_start:start,billing_end:end};
  let invoices=[],paymentStatus='captured',refunded=0;
  const provider={
    subscriptions:{fetch:async()=>({...subscription})},
    plans:{fetch:async()=>({id:providerPlan,period:'monthly',item:{amount:5000,currency:'INR'}})},
    invoices:{all:async()=>({items:invoices})},
    payments:{fetch:async()=>({status:paymentStatus,amount_refunded:refunded,invoice_id:invoice.id,amount:5000,currency:'INR'})}
  };
  try{
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)',[business]);
    await query("INSERT INTO subscription_plans (id,code,name,currency,monthly_price_cents) VALUES ($1,$1,$1,'INR',5000)",[plan]);
    await query("INSERT INTO razorpay_billing_plans (version,plan_id,provider_plan_id,state) VALUES ($1,$2,$3,'ready')",['version_'+suffix,plan,providerPlan]);
    await query("INSERT INTO razorpay_subscription_checkouts (id,business_id,plan_id,billing_interval,provider_plan_id,provider_subscription_id,total_count) VALUES ($1,$2,$3,'monthly',$4,$5,12)",[checkout.id,business,plan,providerPlan,subscription.id]);
    assert.equal((await reconcileSubscription(checkout,provider)).status,'pending');
    invoices=[invoice];paymentStatus='authorized';
    assert.equal((await reconcileSubscription(checkout,provider)).status,'pending');
    paymentStatus='captured';
    assert.equal((await reconcileSubscription(checkout,provider,'charge_'+suffix,'subscription.charged')).status,'active');
    assert.equal((await reconcileSubscription(checkout,provider,'charge_'+suffix,'subscription.charged')).duplicate,true);
    assert.equal((await query('SELECT * FROM billing_events WHERE business_id=$1',[business])).rowCount,1);
    subscription.notes={checkoutId:'another-company'};
    await assert.rejects(reconcileSubscription(checkout,provider),{code:'SUBSCRIPTION_MISMATCH'});
    assert.equal((await query('SELECT status FROM business_subscriptions WHERE business_id=$1',[business])).rows[0].status,'active');
    subscription.notes={checkoutId:checkout.id};refunded=5000;
    assert.equal((await reconcileSubscription(checkout,provider)).status,'pending');
    refunded=0;subscription.status='completed';
    assert.equal((await reconcileSubscription(checkout,provider)).status,'active');
    subscription.current_end=now-1;
    assert.equal((await reconcileSubscription(checkout,provider)).status,'canceled');
  }finally{
    await query('DELETE FROM businesses WHERE id=$1',[business]);
    await query('DELETE FROM subscription_plans WHERE id=$1',[plan]);
    await query('DELETE FROM billing_webhook_events WHERE event_id=$1',['razorpay:charge_'+suffix]);
  }
});
