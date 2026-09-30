import crypto from 'node:crypto';
import {requireSession} from './auth.js';
import {AppError,query,transaction,id,json,errorJson,enterSystemContext} from './db.js';
import {readJsonBodyLimited,readTextBodyLimited} from './security.js';
import {razorpayClient,verifyRazorpaySignature,razorpayCheckoutUrl,paymentMinorUnits,razorpayRequestRejected} from './razorpay.js';

const clean=value=>String(value||'').trim();
const provider=()=>razorpayClient(process.env.RAZORPAY_KEY_ID,process.env.RAZORPAY_KEY_SECRET);
function owner(session){if(session.role!=='Owner')throw new AppError('Only the workspace owner can manage subscriptions.',403,'BILLING_FORBIDDEN');}

export function razorpayPlanVersion(plan,interval) {
  return crypto.createHash('sha256').update(JSON.stringify([plan.id,interval,plan.currency,interval==='monthly'?plan.monthly_price_cents:plan.yearly_price_cents,plan.updated_at])).digest('hex');
}
export function verifiedSubscriptionStatus(status,paid) {
  if(status==='active')return paid?'active':'pending';
  if(status==='completed'&&paid)return 'active';
  if(status==='halted'||status==='pending')return 'past_due';
  if(status==='cancelled'||status==='completed'||status==='expired')return 'canceled';
  if(status==='paused')return 'expired';
  return 'pending';
}

export function invoiceCoversCurrentPeriod(invoice,sub,amount,now=Math.floor(Date.now()/1000)){
  const start=Number(sub.current_start),end=Number(sub.current_end),paidAt=Number(invoice.paid_at);
  return Number.isSafeInteger(start)&&start>0&&Number.isSafeInteger(end)&&end>start&&start<=now&&end>now&&
    Number.isSafeInteger(paidAt)&&paidAt>=start&&paidAt<end&&paidAt<=now&&Number(invoice.billing_start)===start&&Number(invoice.billing_end)===end&&invoice.subscription_id===sub.id&&
    invoice.status==='paid'&&Boolean(invoice.payment_id)&&Number(invoice.amount_paid)===Number(amount);
}

async function providerPlan(plan,interval,client){
  const cents=Number(interval==='monthly'?plan.monthly_price_cents:plan.yearly_price_cents);
  if(!Number.isSafeInteger(cents)||cents<=0)throw new AppError('A paid plan price is required.',400,'PLAN_PRICE_INVALID');
  const amount=paymentMinorUnits(String(Math.floor(cents/100))+'.'+String(cents%100).padStart(2,'0'),plan.currency);
  const version=razorpayPlanVersion(plan,interval);
  const existing=(await query('SELECT * FROM razorpay_billing_plans WHERE version=$1',[version])).rows[0];
  if(existing?.provider_plan_id)return existing.provider_plan_id;
  const reserved=await query('INSERT INTO razorpay_billing_plans (version,plan_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING version',[version,plan.id]);
  if(!reserved.rowCount)throw new AppError('Plan creation is pending verification. Check Razorpay before retrying.',409,'RAZORPAY_PLAN_UNCONFIRMED');
  try{
    const created=await client.plans.create({period:interval==='yearly'?'yearly':'monthly',interval:1,item:{name:plan.name,amount,currency:plan.currency},notes:{version}});
    if(!/^plan_[A-Za-z0-9]+$/.test(created.id||''))throw new AppError('Plan creation was not confirmed.',409,'RAZORPAY_PLAN_UNCONFIRMED');
    await query("UPDATE razorpay_billing_plans SET provider_plan_id=$1,state='ready' WHERE version=$2",[created.id,version]);
    return created.id;
  }catch(error){
    if(razorpayRequestRejected(error))await query('DELETE FROM razorpay_billing_plans WHERE version=$1 AND provider_plan_id IS NULL',[version]);
    throw new AppError('Razorpay plan creation failed or remains unconfirmed. Check platform credentials and currency support.',409,'RAZORPAY_PLAN_UNCONFIRMED');
  }
}

export async function createRazorpaySubscriptionCheckout(request){
  try{
    const session=await requireSession(request);owner(session);
    const body=await readJsonBodyLimited(request,16384);
    const interval=clean(body.interval);
    if(!['monthly','yearly'].includes(interval))throw new AppError('Choose monthly or yearly billing.',400,'BILLING_INTERVAL_INVALID');
    const plan=(await query('SELECT * FROM subscription_plans WHERE id=$1 AND is_active=TRUE AND visible=TRUE',[clean(body.planId)])).rows[0];
    if(!plan)throw new AppError('Subscription plan not found.',404,'PLAN_NOT_FOUND');
    const cycles=Number((await query("SELECT value FROM platform_settings WHERE key='razorpay_subscription_total_count'")).rows[0]?.value);
    if(!Number.isInteger(cycles)||cycles<1||cycles>1000)throw new AppError('Set a valid Razorpay billing-cycle count in Super Admin settings.',503,'RAZORPAY_CYCLES_REQUIRED');
    const client=provider(),planId=await providerPlan(plan,interval,client);
    const checkout=await transaction(async db=>{
      await db.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[session.businessId]);
      const current=(await db.query('SELECT * FROM business_subscriptions WHERE business_id=$1 FOR UPDATE',[session.businessId])).rows[0];
      if(current?.provider_subscription_id&&!['canceled','expired'].includes(current.status))throw new AppError('Manage the current subscription before creating another.',409,'SUBSCRIPTION_EXISTS');
      const pending=(await db.query("SELECT * FROM razorpay_subscription_checkouts WHERE business_id=$1 AND state IN ('processing','created','authenticated','unconfirmed') ORDER BY created_at DESC LIMIT 1",[session.businessId])).rows[0];
      if(pending){
        if(pending.plan_id!==plan.id||pending.billing_interval!==interval)throw new AppError('Cancel the pending subscription before selecting another plan.',409,'SUBSCRIPTION_EXISTS');
        return {...pending,existing:true};
      }
      const row=(await db.query("INSERT INTO razorpay_subscription_checkouts (id,business_id,plan_id,billing_interval,provider_plan_id,total_count) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",[id('rsc'),session.businessId,plan.id,interval,planId,cycles])).rows[0];
      return {...row,trialEnd:current?.status==='trialing'?current.trial_ends_at:null};
    });
    if(checkout.existing){
      if(!checkout.checkout_url)throw new AppError('Reconcile the pending Razorpay subscription before retrying.',409,'SUBSCRIPTION_CREATE_UNCONFIRMED');
      return json({url:checkout.checkout_url,duplicate:true});
    }
    try{
      const trialEnd=checkout.trialEnd?Math.floor(new Date(checkout.trialEnd).getTime()/1000):0;
      const created=await client.subscriptions.create({plan_id:planId,total_count:cycles,quantity:1,customer_notify:0,notes:{checkoutId:checkout.id},...(trialEnd>Math.floor(Date.now()/1000)?{start_at:trialEnd}:{})});
      if(!/^sub_[A-Za-z0-9]+$/.test(created.id||''))throw new Error('Subscription ID missing');
      await query('UPDATE razorpay_subscription_checkouts SET provider_subscription_id=$1 WHERE id=$2 AND business_id=$3',[created.id,checkout.id,session.businessId]);
      const url=razorpayCheckoutUrl(created.short_url);
      await query("UPDATE razorpay_subscription_checkouts SET state='created',checkout_url=$1 WHERE id=$2 AND business_id=$3 AND state='processing'",[url,checkout.id,session.businessId]);
      return json({url},201);
    }catch(error){
      await query("UPDATE razorpay_subscription_checkouts SET state=$1 WHERE id=$2 AND business_id=$3 AND state='processing'",[razorpayRequestRejected(error)?'failed':'unconfirmed',checkout.id,session.businessId]);
      throw new AppError('Razorpay subscription creation was not confirmed. Reconcile before retrying.',409,'SUBSCRIPTION_CREATE_UNCONFIRMED');
    }
  }catch(error){return errorJson(error);}
}

export async function reconcileSubscription(checkout,client,eventId='',eventType='reconcile'){
  return transaction(async db=>{
  await db.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[checkout.business_id]);
  const locked=(await db.query('SELECT * FROM business_subscriptions WHERE business_id=$1 FOR UPDATE',[checkout.business_id])).rows[0];
  const sub=await client.subscriptions.fetch(checkout.provider_subscription_id);
  if(sub.id!==checkout.provider_subscription_id||sub.notes?.checkoutId!==checkout.id)throw new AppError('Subscription identity does not match this workspace.',409,'SUBSCRIPTION_MISMATCH');
  const mapping=(await db.query('SELECT plan_id FROM razorpay_billing_plans WHERE provider_plan_id=$1 AND state=$2',[sub.plan_id,'ready'])).rows[0];
  if(!mapping)throw new AppError('Razorpay returned an unregistered subscription plan.',409,'SUBSCRIPTION_PLAN_MISMATCH');
  const plan=await client.plans.fetch(sub.plan_id);
  const invoices=await client.invoices.all({subscription_id:sub.id,count:100});
  let paid=false,invoiceId='';
  for(const invoice of invoices.items||[]){
    if(!invoiceCoversCurrentPeriod(invoice,sub,plan.item?.amount))continue;
    const payment=await client.payments.fetch(invoice.payment_id);
    if(payment.status==='captured'&&Number(payment.amount_refunded||0)===0&&payment.invoice_id===invoice.id&&Number(payment.amount)===Number(plan.item.amount)&&payment.currency===plan.item.currency){paid=true;invoiceId=invoice.id;break;}
  }
  const status=verifiedSubscriptionStatus(sub.status,paid);
  const start=Number(sub.current_start)>0?new Date(sub.current_start*1000):null;
  const end=Number(sub.current_end)>0?new Date(sub.current_end*1000):null;
    if(locked?.provider_subscription_id&&locked.provider_subscription_id!==sub.id&&!['canceled','expired'].includes(locked.status))throw new AppError('Another subscription is active for this workspace.',409,'SUBSCRIPTION_EXISTS');
    if(eventId){
      const inserted=await db.query('INSERT INTO billing_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',['razorpay:'+eventId,eventType]);
      if(!inserted.rowCount)return {duplicate:true};
    }
    const trialValid=locked?.status==='trialing'&&new Date(locked.trial_ends_at)>new Date()&&['created','authenticated'].includes(sub.status);
    const resolved=trialValid?'trialing':status;
    const interval=plan.period==='yearly'?'yearly':plan.period==='monthly'?'monthly':'';
    if(!interval)throw new AppError('Unsupported recurring plan period.',409,'SUBSCRIPTION_PLAN_MISMATCH');
    const row=(await db.query("INSERT INTO business_subscriptions (id,business_id,plan_id,status,payment_status,starts_at,trial_ends_at,current_period_start,current_period_end,renews_at,provider,provider_subscription_id,billing_interval) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$8,'razorpay',$9,$10) ON CONFLICT (business_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,payment_status=EXCLUDED.payment_status,trial_ends_at=EXCLUDED.trial_ends_at,current_period_start=EXCLUDED.current_period_start,current_period_end=EXCLUDED.current_period_end,renews_at=EXCLUDED.renews_at,provider='razorpay',provider_customer_id=NULL,cancel_at_period_end=CASE WHEN business_subscriptions.provider_subscription_id=EXCLUDED.provider_subscription_id THEN business_subscriptions.cancel_at_period_end ELSE FALSE END,provider_subscription_id=EXCLUDED.provider_subscription_id,billing_interval=EXCLUDED.billing_interval,updated_at=NOW() RETURNING id",[id('sub'),checkout.business_id,trialValid?locked.plan_id:mapping.plan_id,resolved,paid?'paid':status==='past_due'?'failed':'pending',trialValid?locked.trial_ends_at:null,start,end,sub.id,interval])).rows[0];
    await db.query('UPDATE razorpay_subscription_checkouts SET state=$1 WHERE id=$2 AND business_id=$3',[sub.status,checkout.id,checkout.business_id]);
    if(eventId)await db.query('INSERT INTO billing_events (id,business_id,subscription_id,event_type,amount_cents,currency,provider,provider_event_id,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id('be'),checkout.business_id,row.id,eventType,paid?Number(plan.item.amount)*100/10**new Intl.NumberFormat('en',{style:'currency',currency:plan.item.currency}).resolvedOptions().maximumFractionDigits:0,plan.item.currency,'razorpay',eventId,JSON.stringify({invoiceId})]);
    return {status:resolved,paymentStatus:paid?'paid':'pending'};
  });
}

export async function manageRazorpaySubscription(request){
  try{
    const session=await requireSession(request);owner(session);
    const body=await readJsonBodyLimited(request,8192);
    if(body.action==='recoverPlan'){
      const interval=clean(body.interval);
      if(!['monthly','yearly'].includes(interval)||!/^plan_[A-Za-z0-9]+$/.test(clean(body.providerPlanId)))throw new AppError('Provide a valid plan and interval.',400,'PLAN_RECOVERY_INVALID');
      const plan=(await query('SELECT * FROM subscription_plans WHERE id=$1 AND is_active=TRUE AND visible=TRUE',[clean(body.planId)])).rows[0];
      if(!plan)throw new AppError('Plan not found.',404,'PLAN_NOT_FOUND');
      const version=razorpayPlanVersion(plan,interval),remote=await provider().plans.fetch(clean(body.providerPlanId));
      const cents=Number(interval==='monthly'?plan.monthly_price_cents:plan.yearly_price_cents);
      const amount=paymentMinorUnits(String(Math.floor(cents/100))+'.'+String(cents%100).padStart(2,'0'),plan.currency);
      if(remote.notes?.version!==version||remote.period!==interval||remote.interval!==1||remote.item?.currency!==plan.currency||Number(remote.item.amount)!==amount)throw new AppError('Provider plan does not match the configured price.',409,'PLAN_RECOVERY_MISMATCH');
      const recovered=await query("UPDATE razorpay_billing_plans SET provider_plan_id=$1,state='ready' WHERE version=$2 AND provider_plan_id IS NULL RETURNING version",[remote.id,version]);
      if(!recovered.rowCount)throw new AppError('No unconfirmed provider plan exists.',409,'PLAN_RECOVERY_INVALID');
      return json({ok:true});
    }
    const checkout=(await query('SELECT * FROM razorpay_subscription_checkouts WHERE business_id=$1 ORDER BY created_at DESC LIMIT 1',[session.businessId])).rows[0];
    if(!checkout)throw new AppError('No Razorpay subscription exists for this workspace.',404,'NOT_FOUND');
    const client=provider();
    if(body.action==='recover'){
      if(checkout.provider_subscription_id||!/^sub_[A-Za-z0-9]+$/.test(clean(body.subscriptionId)))throw new AppError('Provide the subscription ID from the Razorpay dashboard.',400,'SUBSCRIPTION_RECOVERY_INVALID');
      const recovered=await client.subscriptions.fetch(clean(body.subscriptionId));
      if(recovered.notes?.checkoutId!==checkout.id||recovered.plan_id!==checkout.provider_plan_id)throw new AppError('This subscription does not match the pending checkout.',409,'SUBSCRIPTION_MISMATCH');
      await query('UPDATE razorpay_subscription_checkouts SET provider_subscription_id=$1,checkout_url=$2 WHERE id=$3 AND business_id=$4',[recovered.id,razorpayCheckoutUrl(recovered.short_url),checkout.id,session.businessId]);
      checkout.provider_subscription_id=recovered.id;
    }
    if(!checkout.provider_subscription_id)throw new AppError('Recover the provider subscription ID before reconciling.',409,'SUBSCRIPTION_CREATE_UNCONFIRMED');
    if(body.action==='cancel'){
      const sub=await client.subscriptions.fetch(checkout.provider_subscription_id);
      if(sub.notes?.checkoutId!==checkout.id)throw new AppError('Subscription identity mismatch.',409,'SUBSCRIPTION_MISMATCH');
      await client.subscriptions.cancel(sub.id,sub.status==='active'?true:false);
      if(sub.status==='active')await query("UPDATE business_subscriptions SET cancel_at_period_end=TRUE,updated_at=NOW() WHERE business_id=$1 AND provider='razorpay' AND provider_subscription_id=$2",[session.businessId,sub.id]);
      else await query("UPDATE razorpay_subscription_checkouts SET state='cancelled' WHERE id=$1 AND business_id=$2",[checkout.id,session.businessId]);
      return json({ok:true,cancelAtPeriodEnd:sub.status==='active'});
    }
    if(!['refresh','recover'].includes(body.action))throw new AppError('Unsupported subscription action.',400,'INVALID_ACTION');
    return json({ok:true,...await reconcileSubscription(checkout,client)});
  }catch(error){if(!error.code)return errorJson(new AppError('Razorpay could not verify this subscription.',502,'RAZORPAY_REQUEST_FAILED'));return errorJson(error);}
}

export async function changeRazorpayPlan(session,plan,interval,local){
  const client=provider();
  const checkout=(await query('SELECT * FROM razorpay_subscription_checkouts WHERE business_id=$1 AND provider_subscription_id=$2',[session.businessId,local.provider_subscription_id])).rows[0];
  if(!checkout)throw new AppError('Subscription checkout record is missing.',409,'SUBSCRIPTION_MISMATCH');
  const sub=await client.subscriptions.fetch(local.provider_subscription_id);
  if(sub.notes?.checkoutId!==checkout.id||sub.status!=='active')throw new AppError('An active verified subscription is required.',409,'SUBSCRIPTION_NOT_SWITCHABLE');
  const planId=await providerPlan(plan,interval,client);
  if(sub.plan_id===planId)throw new AppError('This is already your current plan.',409,'PLAN_ALREADY_CURRENT');
  await client.subscriptions.update(sub.id,{plan_id:planId,schedule_change_at:'cycle_end'});
  return {ok:true,pendingWebhook:true};
}

export async function receiveRazorpayBillingWebhook(request){
  try{
    const raw=await readTextBodyLimited(request,262144);
    const signature=request.headers.get('x-razorpay-signature');
    try{verifyRazorpaySignature(raw,signature,process.env.RAZORPAY_WEBHOOK_SECRET);}
    catch(error){if(!process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS)throw error;verifyRazorpaySignature(raw,signature,process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS);}
    const event=JSON.parse(raw);
    enterSystemContext();
    let entity=event.payload?.subscription?.entity;
    if(!entity&&['payment.captured','payment.failed','payment.refunded','refund.processed','invoice.paid'].includes(event.event)){
      const client=provider();
      let invoiceId=event.payload?.invoice?.entity?.id||event.payload?.payment?.entity?.invoice_id;
      if(!invoiceId&&/^pay_[A-Za-z0-9]+$/.test(event.payload?.refund?.entity?.payment_id||''))invoiceId=(await client.payments.fetch(event.payload.refund.entity.payment_id)).invoice_id;
      if(/^inv_[A-Za-z0-9]+$/.test(invoiceId||'')){
        const invoice=await client.invoices.fetch(invoiceId);
        if(/^sub_[A-Za-z0-9]+$/.test(invoice.subscription_id||''))entity={id:invoice.subscription_id};
      }
    }
    if(!entity||!/^sub_[A-Za-z0-9]+$/.test(entity.id||''))return json({received:true,ignored:true});
    const checkout=(await query('SELECT * FROM razorpay_subscription_checkouts WHERE provider_subscription_id=$1 OR (id=$2 AND provider_subscription_id IS NULL)',[entity.id,clean(entity.notes?.checkoutId)])).rows[0];
    if(!checkout)return json({received:true,ignored:true});
    if(!checkout.provider_subscription_id){
      const sub=await provider().subscriptions.fetch(entity.id);
      if(sub.notes?.checkoutId!==checkout.id||sub.plan_id!==checkout.provider_plan_id)throw new AppError('Subscription identity mismatch.',409,'SUBSCRIPTION_MISMATCH');
      await query('UPDATE razorpay_subscription_checkouts SET provider_subscription_id=$1 WHERE id=$2',[sub.id,checkout.id]);
      checkout.provider_subscription_id=sub.id;
    }
    const eventId=request.headers.get('x-razorpay-event-id')||crypto.createHash('sha256').update(raw).digest('hex');
    if(eventId.length>256)throw new AppError('Invalid event ID.',400,'WEBHOOK_EVENT_INVALID');
    return json({received:true,...await reconcileSubscription(checkout,provider(),eventId,event.event)});
  }catch(error){return errorJson(error);}
}
