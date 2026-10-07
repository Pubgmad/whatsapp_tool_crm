import crypto from 'node:crypto';
import { requireSession } from './auth.js';
import { AppError, errorJson, json, query } from './db.js';
import { readJsonBodyLimited } from './security.js';
import {
  createRazorpaySubscriptionCheckout,
  changeRazorpayPlan,
  manageRazorpaySubscription
} from './razorpay-billing.js';
import { razorpayClient, razorpayCheckoutUrl } from './razorpay.js';

function requireBillingOwner(session) {
  if (session.role !== 'Owner') throw new AppError('Only the workspace owner can manage billing.', 403, 'BILLING_FORBIDDEN');
}

export function checkoutPriceVersion(plan, interval, amount) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([plan.id, interval, amount, plan.currency, plan.updated_at]))
    .digest('hex').slice(0, 24);
}

async function razorpayBillingConfigured() {
  const cycles = Number((await query("SELECT value FROM platform_settings WHERE key='razorpay_subscription_total_count'")).rows[0]?.value);
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET &&
    Number.isInteger(cycles) &&
    cycles >= 1 &&
    cycles <= 1000
  );
}

export async function listBillingPlans(request) {
  try {
    await requireSession(request);
    const result = await query(
      'SELECT id,code,name,description,currency,monthly_price_cents,yearly_price_cents,features,trial_days FROM subscription_plans WHERE is_active=TRUE AND visible=TRUE ORDER BY display_order,name'
    );
    const billingAvailable = await razorpayBillingConfigured();
    return json({
      plans: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        currency: row.currency,
        monthlyPriceCents: row.monthly_price_cents,
        yearlyPriceCents: row.yearly_price_cents,
        features: row.features,
        trialDays: row.trial_days
      })),
      provider: 'razorpay',
      billingAvailable
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function createCheckout(request) {
  return createRazorpaySubscriptionCheckout(request);
}

export async function createBillingPortal(request) {
  try {
    const session = await requireSession(request);
    requireBillingOwner(session);
    if (!(await razorpayBillingConfigured())) {
      throw new AppError('Razorpay billing is not configured on this platform.', 503, 'RAZORPAY_NOT_CONFIGURED');
    }
    const local = (await query(
      'SELECT provider_subscription_id,status FROM business_subscriptions WHERE business_id=$1 AND provider=$2',
      [session.businessId, 'razorpay']
    )).rows[0];
    if (!local?.provider_subscription_id) {
      throw new AppError('No Razorpay subscription is linked to this workspace.', 409, 'RAZORPAY_SUBSCRIPTION_MISSING');
    }
    const checkout = (await query(
      'SELECT checkout_url FROM razorpay_subscription_checkouts WHERE business_id=$1 AND provider_subscription_id=$2 ORDER BY created_at DESC LIMIT 1',
      [session.businessId, local.provider_subscription_id]
    )).rows[0];
    if (checkout?.checkout_url?.startsWith('https://')) {
      return json({ url: checkout.checkout_url });
    }
    const client = razorpayClient(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);
    const sub = await client.subscriptions.fetch(local.provider_subscription_id);
    const url = razorpayCheckoutUrl(sub.short_url);
    if (!url?.startsWith('https://')) {
      throw new AppError('Razorpay did not return a secure subscription management URL.', 502, 'RAZORPAY_PORTAL_UNAVAILABLE');
    }
    return json({ url });
  } catch (error) {
    return errorJson(error);
  }
}

export async function changeSubscriptionPlan(request) {
  try {
    const session = await requireSession(request);
    requireBillingOwner(session);
    const body = await readJsonBodyLimited(request, 65536);
    const interval = body.interval === 'monthly' || body.interval === 'yearly' ? body.interval : '';
    if (!interval) throw new AppError('Choose monthly or yearly billing.', 400, 'BILLING_INTERVAL_INVALID');
    const plan = (await query(
      'SELECT * FROM subscription_plans WHERE id=$1 AND is_active=TRUE AND visible=TRUE',
      [String(body.planId || '')]
    )).rows[0];
    if (!plan) throw new AppError('This subscription plan is not available.', 404, 'PLAN_NOT_FOUND');
    const amount = Number(interval === 'monthly' ? plan.monthly_price_cents : plan.yearly_price_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new AppError('This plan has no paid price for that interval.', 400, 'PLAN_PRICE_INVALID');
    }
    const local = (await query(
      'SELECT plan_id,provider,provider_subscription_id,status FROM business_subscriptions WHERE business_id=$1',
      [session.businessId]
    )).rows[0];
    if (local?.provider && local.provider !== 'razorpay') {
      throw new AppError('This workspace uses a legacy billing provider. Contact platform support to migrate to Razorpay.', 409, 'BILLING_PROVIDER_UNSUPPORTED');
    }
    if (!local?.provider_subscription_id || !['active', 'trialing'].includes(local.status)) {
      throw new AppError('An active subscription is required to switch plans.', 409, 'SUBSCRIPTION_NOT_SWITCHABLE');
    }
    return json(await changeRazorpayPlan(session, plan, interval, local));
  } catch (error) {
    return errorJson(error);
  }
}

export async function manageBilling(request) {
  return manageRazorpaySubscription(request);
}
