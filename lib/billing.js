import Stripe from 'stripe';
import crypto from 'node:crypto';
import { requireSession } from './auth.js';
import { AppError, enterSystemContext, errorJson, id, json, query, transaction } from './db.js';
import { readTextBodyLimited } from './security.js';

function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new AppError('Stripe billing is not configured.', 503, 'STRIPE_NOT_CONFIGURED');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function appUrl() {
  const url = process.env.APP_URL;
  if (!url) throw new AppError('APP_URL is required for billing.', 503, 'BILLING_URL_MISSING');
  const parsed = new URL(url);
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new AppError('Billing requires HTTPS.', 503, 'BILLING_HTTPS_REQUIRED');
  }
  return parsed.origin;
}

function requireBillingOwner(session) {
  if (session.role !== 'Owner') throw new AppError('Only the workspace owner can manage billing.', 403, 'BILLING_FORBIDDEN');
}

function mapStripeStatus(status) {
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled') return status;
  if (status === 'unpaid' || status === 'incomplete_expired' || status === 'paused') return 'expired';
  return 'pending';
}

function dateFromSeconds(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value) * 1000) : null;
}

export function checkoutPriceVersion(plan, interval, amount) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([plan.id, interval, amount, plan.currency, plan.updated_at]))
    .digest('hex').slice(0, 24);
}

export async function listBillingPlans(request) {
  try {
    await requireSession(request);
    const result = await query(
      'SELECT id,code,name,description,currency,monthly_price_cents,yearly_price_cents,features,trial_days FROM subscription_plans WHERE is_active=TRUE AND visible=TRUE ORDER BY display_order,name'
    );
    return json({ plans: result.rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, description: row.description,
      currency: row.currency, monthlyPriceCents: row.monthly_price_cents,
      yearlyPriceCents: row.yearly_price_cents, features: row.features, trialDays: row.trial_days
    })), billingAvailable: Boolean(process.env.STRIPE_SECRET_KEY) });
  } catch (error) { return errorJson(error); }
}

export async function createCheckout(request) {
  try {
    const session = await requireSession(request);
    requireBillingOwner(session);
    const body = await request.json();
    const interval = body.interval === 'yearly' ? 'yearly' : body.interval === 'monthly' ? 'monthly' : '';
    if (!interval) throw new AppError('Choose monthly or yearly billing.', 400, 'BILLING_INTERVAL_INVALID');
    const plan = (await query(
      'SELECT * FROM subscription_plans WHERE id=$1 AND is_active=TRUE AND visible=TRUE',
      [String(body.planId || '')]
    )).rows[0];
    if (!plan) throw new AppError('This subscription plan is not available.', 404, 'PLAN_NOT_FOUND');
    const amount = Number(interval === 'monthly' ? plan.monthly_price_cents : plan.yearly_price_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('This plan does not have a paid price for the selected interval.', 400, 'PLAN_PRICE_INVALID');

    const subscription = (await query(
      'SELECT provider_customer_id,provider_subscription_id,status FROM business_subscriptions WHERE business_id=$1',
      [session.businessId]
    )).rows[0];
    if (subscription?.provider_subscription_id && ['active', 'trialing', 'past_due'].includes(subscription.status)) {
      throw new AppError('Manage the existing subscription before starting a new checkout.', 409, 'SUBSCRIPTION_EXISTS');
    }
    const owner = (await query('SELECT email FROM users WHERE id=$1', [session.userId])).rows[0];
    const stripe = stripeClient();
    const base = appUrl();
    const metadata = { businessId: session.businessId, planId: plan.id, interval };
    const trialDays = !subscription?.provider_subscription_id && subscription?.status !== 'trialing' ? Number(plan.trial_days) : 0;
    const priceVersion = checkoutPriceVersion(plan, interval, amount);
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: session.businessId,
      ...(subscription?.provider_customer_id ? { customer: subscription.provider_customer_id } : { customer_email: owner.email }),
      line_items: [{
        price_data: {
          currency: String(plan.currency).toLowerCase(),
          unit_amount: amount,
          recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
          product_data: { name: plan.name, description: plan.description || undefined }
        },
        quantity: 1
      }],
      metadata,
      subscription_data: { metadata, ...(Number.isSafeInteger(trialDays) && trialDays > 0 ? { trial_period_days: trialDays } : {}) },
      success_url: base + '/app/settings/billing?checkout=success',
      cancel_url: base + '/app/settings/billing?checkout=cancelled'
    }, { idempotencyKey: 'checkout:' + session.businessId + ':' + priceVersion + ':' + Math.floor(Date.now() / 3600000) });
    if (!checkout.url) throw new AppError('Stripe did not return a checkout URL.', 502, 'STRIPE_CHECKOUT_FAILED');
    return json({ url: checkout.url });
  } catch (error) { return errorJson(error); }
}

export async function createBillingPortal(request) {
  try {
    const session = await requireSession(request);
    requireBillingOwner(session);
    const row = (await query(
      'SELECT provider_customer_id FROM business_subscriptions WHERE business_id=$1 AND provider=$2',
      [session.businessId, 'stripe']
    )).rows[0];
    if (!row?.provider_customer_id) throw new AppError('No Stripe billing account is linked to this workspace.', 409, 'STRIPE_CUSTOMER_MISSING');
    const portal = await stripeClient().billingPortal.sessions.create({
      customer: row.provider_customer_id,
      return_url: appUrl() + '/app/settings/billing'
    });
    return json({ url: portal.url });
  } catch (error) { return errorJson(error); }
}

export async function changeSubscriptionPlan(request) {
  try {
    const session = await requireSession(request);
    requireBillingOwner(session);
    const body = await request.json();
    const interval = body.interval === 'monthly' || body.interval === 'yearly' ? body.interval : '';
    if (!interval) throw new AppError('Choose monthly or yearly billing.', 400, 'BILLING_INTERVAL_INVALID');
    const plan = (await query(
      'SELECT * FROM subscription_plans WHERE id=$1 AND is_active=TRUE AND visible=TRUE',
      [String(body.planId || '')]
    )).rows[0];
    if (!plan) throw new AppError('This subscription plan is not available.', 404, 'PLAN_NOT_FOUND');
    const amount = Number(interval === 'monthly' ? plan.monthly_price_cents : plan.yearly_price_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('This plan has no paid price for that interval.', 400, 'PLAN_PRICE_INVALID');
    const local = (await query(
      'SELECT plan_id,provider_customer_id,provider_subscription_id,status FROM business_subscriptions WHERE business_id=$1 AND provider=$2',
      [session.businessId, 'stripe']
    )).rows[0];
    if (!local?.provider_subscription_id || !['active', 'trialing'].includes(local.status)) {
      throw new AppError('An active Stripe subscription is required to switch plans.', 409, 'SUBSCRIPTION_NOT_SWITCHABLE');
    }
    const stripe = stripeClient();
    const subscription = await stripe.subscriptions.retrieve(local.provider_subscription_id);
    if (subscription.metadata?.businessId !== session.businessId || subscription.customer !== local.provider_customer_id ||
        !['active', 'trialing'].includes(subscription.status) || subscription.items.data.length !== 1) {
      throw new AppError('Stripe subscription cannot be safely changed. Contact support.', 409, 'SUBSCRIPTION_MISMATCH');
    }
    const item = subscription.items.data[0];
    const oldPriceId = typeof item.price === 'string' ? item.price : item.price.id;
    const oldPrice = typeof item.price === 'string' ? await stripe.prices.retrieve(item.price) : item.price;
    if (subscription.metadata?.planId === plan.id && oldPrice.unit_amount === amount &&
        oldPrice.currency?.toUpperCase() === String(plan.currency).toUpperCase() &&
        oldPrice.recurring?.interval === (interval === 'yearly' ? 'year' : 'month')) {
      throw new AppError('This is already your current plan.', 409, 'PLAN_ALREADY_CURRENT');
    }
    const version = checkoutPriceVersion(plan, interval, amount);
    const price = await stripe.prices.create({
      currency: String(plan.currency).toLowerCase(),
      unit_amount: amount,
      recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
      product_data: { name: plan.name, description: plan.description || undefined },
      metadata: { planId: plan.id, interval }
    }, { idempotencyKey: 'plan-price:' + session.businessId + ':' + version });
    await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: price.id }],
      metadata: { ...subscription.metadata, businessId: session.businessId, planId: plan.id, interval },
      payment_behavior: 'error_if_incomplete',
      proration_behavior: 'always_invoice'
    }, { idempotencyKey: 'plan-switch:' + subscription.id + ':' + oldPriceId + ':' + price.id });
    return json({ ok: true, pendingWebhook: true });
  } catch (error) { return errorJson(error); }
}

function subscriptionIdFromEvent(event) {
  const object = event.data.object;
  if (event.type.startsWith('customer.subscription.')) return object.id;
  if (event.type.startsWith('checkout.session.')) return typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
  if (event.type.startsWith('invoice.')) {
    const subscription = object.subscription || object.parent?.subscription_details?.subscription;
    return typeof subscription === 'string' ? subscription : subscription?.id;
  }
  return null;
}

async function applyStripeEvent(event, stripe) {
  const stripeSubscriptionId = subscriptionIdFromEvent(event);
  const stripeSubscription = stripeSubscriptionId ? await stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['latest_invoice'] }) : null;
  const metadata = stripeSubscription?.metadata || {};
  const businessId = metadata.businessId;
  const planId = metadata.planId;
  const stripeStatus = stripeSubscription ? mapStripeStatus(stripeSubscription.status) : null;
  const invoice = event.type.startsWith('invoice.') ? event.data.object : null;
  const item = stripeSubscription?.items?.data?.[0];
  const periodStart = dateFromSeconds(item?.current_period_start || stripeSubscription?.current_period_start);
  const periodEnd = dateFromSeconds(item?.current_period_end || stripeSubscription?.current_period_end);

  return transaction(async (client) => {
    const inserted = await client.query(
      'INSERT INTO billing_webhook_events (event_id,event_type) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING event_id',
      [event.id, event.type]
    );
    if (!inserted.rowCount) return { duplicate: true };
    if (!stripeSubscription || !businessId || !planId) return { ignored: true };
    const plan = (await client.query('SELECT id FROM subscription_plans WHERE id=$1', [planId])).rows[0];
    const business = (await client.query('SELECT id FROM businesses WHERE id=$1', [businessId])).rows[0];
    if (!plan || !business) return { ignored: true };
    const previous = (await client.query(
      'SELECT id,provider_subscription_id,status FROM business_subscriptions WHERE business_id=$1 FOR UPDATE',
      [businessId]
    )).rows[0];
    if (previous?.provider_subscription_id && previous.provider_subscription_id !== stripeSubscription.id &&
        ['active', 'trialing', 'past_due'].includes(previous.status)) return { ignored: true };
    const latestInvoice = stripeSubscription.latest_invoice && typeof stripeSubscription.latest_invoice === 'object'
      ? stripeSubscription.latest_invoice : null;
    const paymentStatus = latestInvoice?.status === 'paid' ? 'paid'
      : latestInvoice?.status === 'uncollectible' || stripeStatus === 'past_due' ? 'failed'
      : latestInvoice?.status === 'open' && Number(latestInvoice.attempt_count || 0) > 0 ? 'failed'
      : latestInvoice ? 'pending' : 'none';
    const local = await client.query(
      'INSERT INTO business_subscriptions (id,business_id,plan_id,status,payment_status,starts_at,trial_ends_at,current_period_start,current_period_end,renews_at,cancel_at_period_end,provider,provider_customer_id,provider_subscription_id,billing_interval) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (business_id) DO UPDATE SET plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,payment_status=EXCLUDED.payment_status,trial_ends_at=EXCLUDED.trial_ends_at,current_period_start=COALESCE(EXCLUDED.current_period_start,business_subscriptions.current_period_start),current_period_end=COALESCE(EXCLUDED.current_period_end,business_subscriptions.current_period_end),renews_at=EXCLUDED.renews_at,cancel_at_period_end=EXCLUDED.cancel_at_period_end,provider=EXCLUDED.provider,provider_customer_id=EXCLUDED.provider_customer_id,provider_subscription_id=EXCLUDED.provider_subscription_id,billing_interval=EXCLUDED.billing_interval,updated_at=NOW() RETURNING id',
      [id('sub'), businessId, planId, stripeStatus, paymentStatus, dateFromSeconds(stripeSubscription.trial_end), periodStart, periodEnd, periodEnd,
        Boolean(stripeSubscription.cancel_at_period_end), 'stripe',
        typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : stripeSubscription.customer?.id,
        stripeSubscription.id, metadata.interval === 'yearly' ? 'yearly' : 'monthly']
    );
    if (invoice) {
      await client.query(
        'INSERT INTO billing_events (id,business_id,subscription_id,event_type,amount_cents,currency,provider,provider_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id('be'), businessId, local.rows[0].id, event.type,
          Number(invoice.amount_paid ?? invoice.amount_due ?? 0), String(invoice.currency || '').toUpperCase(), 'stripe', event.id]
      );
    }
    return { updated: true, businessId };
  });
}

export async function receiveStripeWebhook(request) {
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) throw new AppError('Stripe webhook secret is not configured.', 503, 'STRIPE_WEBHOOK_NOT_CONFIGURED');
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new AppError('Stripe signature is required.', 400, 'STRIPE_SIGNATURE_MISSING');
    const rawBody = await readTextBodyLimited(request, 256000);
    const stripe = stripeClient();
    let event;
    try { event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET); }
    catch { throw new AppError('Invalid Stripe webhook signature.', 400, 'STRIPE_SIGNATURE_INVALID'); }
    enterSystemContext();
    const result = await applyStripeEvent(event, stripe);
    return json({ received: true, ...result });
  } catch (error) { return errorJson(error); }
}
