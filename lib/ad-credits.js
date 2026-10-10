import { AppError, errorJson, id, json, query, transaction } from './db.js';
import { requireSession } from './auth.js';
import { assertWorkspaceFeature } from './feature-controls.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { assertSubscriptionActive, subscriptionUsage } from './limits.js';
import { paymentMinorUnits, razorpayCheckoutUrl, razorpayClient, razorpayRequestRejected, verifyRazorpaySignature } from './razorpay.js';
import { readJsonBodyLimited, readTextBodyLimited } from './security.js';

const clean = (value) => String(value || '').trim();

async function settingNumber(key, fallback) {
  const row = (await query('SELECT value FROM platform_settings WHERE key=$1', [key])).rows[0];
  const number = Number(row?.value);
  return Number.isFinite(number) ? number : fallback;
}

async function settingText(key, fallback) {
  const row = (await query('SELECT value FROM platform_settings WHERE key=$1', [key])).rows[0];
  if (row?.value === undefined || row?.value === null) return fallback;
  return typeof row.value === 'string' ? row.value : String(row.value);
}

async function settingBool(key, fallback = true) {
  const row = (await query('SELECT value FROM platform_settings WHERE key=$1', [key])).rows[0];
  if (row?.value === undefined || row?.value === null) return fallback;
  return row.value !== false && row.value !== 'false';
}

export function estimateAdCreditHoldMinor(operation, { now = Date.now() } = {}) {
  const adset = operation?.payload?.adset || {};
  const daily = Number(adset.daily_budget || 0);
  const lifetime = Number(adset.lifetime_budget || 0);
  if (Number.isFinite(lifetime) && lifetime > 0) return Math.trunc(lifetime);
  if (!Number.isFinite(daily) || daily <= 0) {
    throw new AppError('Campaign budget is required to reserve ad credits.', 409, 'AD_CREDITS_BUDGET_REQUIRED');
  }
  const start = adset.start_time ? Date.parse(adset.start_time) : now;
  const end = adset.end_time ? Date.parse(adset.end_time) : start + 7 * 86400000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new AppError('Campaign schedule is invalid for credit reservation.', 409, 'AD_CREDITS_SCHEDULE_INVALID');
  }
  const days = Math.max(1, Math.ceil((end - Math.max(start, now)) / 86400000));
  return Math.trunc(daily * days);
}

async function ensureWallet(client, businessId, currency = 'INR') {
  await client.query(
    `INSERT INTO ad_credit_wallets (business_id, currency) VALUES ($1,$2)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId, currency]
  );
  return (
    await client.query('SELECT * FROM ad_credit_wallets WHERE business_id=$1 FOR UPDATE', [businessId])
  ).rows[0];
}

async function writeLedger(client, {
  businessId,
  entryType,
  amountMinor,
  balanceAfter,
  reservedAfter,
  currency,
  operationId = null,
  purchaseId = null,
  note = '',
  metadata = {}
}) {
  await client.query(
    `INSERT INTO ad_credit_ledger
      (id, business_id, entry_type, amount_minor, balance_after_minor, reserved_after_minor, currency, operation_id, purchase_id, note, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      id('acl'),
      businessId,
      entryType,
      amountMinor,
      balanceAfter,
      reservedAfter,
      currency,
      operationId,
      purchaseId,
      String(note || '').slice(0, 500),
      JSON.stringify(metadata)
    ]
  );
}

export async function getAdCreditWallet(businessId) {
  const currency = (await settingText('ad_credits_currency', 'INR')).replace(/"/g, '') || 'INR';
  await query(
    `INSERT INTO ad_credit_wallets (business_id, currency) VALUES ($1,$2)
     ON CONFLICT (business_id) DO NOTHING`,
    [businessId, currency]
  );
  const wallet = (await query('SELECT * FROM ad_credit_wallets WHERE business_id=$1', [businessId])).rows[0];
  const packages = (
    await query(
      `SELECT id, name, currency, credits_minor, price_minor, display_order
       FROM ad_credit_packages WHERE is_active AND visible ORDER BY display_order, name`
    )
  ).rows;
  const ledger = (
    await query(
      `SELECT id, entry_type, amount_minor, balance_after_minor, reserved_after_minor, currency, operation_id, purchase_id, note, created_at
       FROM ad_credit_ledger WHERE business_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [businessId]
    )
  ).rows;
  const purchases = (
    await query(
      `SELECT id, package_id, currency, credits_minor, price_minor, status, checkout_url, created_at, updated_at
       FROM ad_credit_purchases WHERE business_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [businessId]
    )
  ).rows;
  const reservations = (
    await query(
      `SELECT id, operation_id, currency, reserved_minor, settled_minor, status, created_at, updated_at
       FROM ad_credit_reservations WHERE business_id=$1 ORDER BY created_at DESC LIMIT 25`,
      [businessId]
    )
  ).rows;
  return {
    enabled: await settingBool('ad_credits_enabled', true),
    currency: wallet.currency,
    balanceMinor: Number(wallet.balance_minor),
    reservedMinor: Number(wallet.reserved_minor),
    availableMinor: Number(wallet.balance_minor),
    starterGranted: Boolean(wallet.starter_granted),
    starterCreditsMinor: await settingNumber('ad_credits_starter_minor', 100000),
    packages,
    ledger,
    purchases,
    reservations,
    billingModel:
      'Prepaid ad credits fund campaigns created in this CRM Ads Manager (AiSensy-style). Credits are separate from WhatsApp conversation credits. Meta delivery still requires a connected ad account.'
  };
}

export async function grantStarterAdCredits(businessId, { actorUserId = null } = {}) {
  if (!(await settingBool('ad_credits_enabled', true))) return { granted: false, reason: 'disabled' };
  const currency = (await settingText('ad_credits_currency', 'INR')).replace(/"/g, '') || 'INR';
  const amount = await settingNumber('ad_credits_starter_minor', 100000);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { granted: false, reason: 'no_starter' };
  return transaction(async (client) => {
    const wallet = await ensureWallet(client, businessId, currency);
    if (wallet.starter_granted) return { granted: false, reason: 'already_granted', balanceMinor: Number(wallet.balance_minor) };
    const balance = Number(wallet.balance_minor) + amount;
    await client.query(
      `UPDATE ad_credit_wallets SET balance_minor=$2, starter_granted=TRUE, updated_at=NOW() WHERE business_id=$1`,
      [businessId, balance]
    );
    await writeLedger(client, {
      businessId,
      entryType: 'starter_grant',
      amountMinor: amount,
      balanceAfter: balance,
      reservedAfter: Number(wallet.reserved_minor),
      currency: wallet.currency,
      note: 'Welcome Meta ad credits',
      metadata: { actorUserId }
    });
    return { granted: true, amountMinor: amount, balanceMinor: balance, currency: wallet.currency };
  });
}

export async function creditAdWallet(businessId, { amountMinor, entryType, note = '', purchaseId = null, metadata = {} }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new AppError('Credit amount is invalid.', 400, 'AD_CREDITS_AMOUNT_INVALID');
  return transaction(async (client) => {
    const wallet = await ensureWallet(client, businessId);
    const balance = Number(wallet.balance_minor) + amountMinor;
    await client.query('UPDATE ad_credit_wallets SET balance_minor=$2, updated_at=NOW() WHERE business_id=$1', [
      businessId,
      balance
    ]);
    await writeLedger(client, {
      businessId,
      entryType,
      amountMinor,
      balanceAfter: balance,
      reservedAfter: Number(wallet.reserved_minor),
      currency: wallet.currency,
      purchaseId,
      note,
      metadata
    });
    return { balanceMinor: balance, currency: wallet.currency };
  });
}

export async function reserveAdCreditsForOperation(businessId, operation) {
  if (!(await settingBool('ad_credits_enabled', true))) return { skipped: true };
  const hold = estimateAdCreditHoldMinor(operation);
  return transaction(async (client) => {
    const wallet = await ensureWallet(client, businessId);
    const existing = (
      await client.query(
        `SELECT * FROM ad_credit_reservations WHERE business_id=$1 AND operation_id=$2 FOR UPDATE`,
        [businessId, operation.id]
      )
    ).rows[0];
    if (existing?.status === 'active') return { reservationId: existing.id, reservedMinor: Number(existing.reserved_minor), duplicate: true };
    if (Number(wallet.balance_minor) < hold) {
      throw new AppError(
        `Insufficient ad credits. Need ${hold} minor units; available ${wallet.balance_minor}. Buy credits before activating.`,
        402,
        'AD_CREDITS_INSUFFICIENT'
      );
    }
    const balance = Number(wallet.balance_minor) - hold;
    const reserved = Number(wallet.reserved_minor) + hold;
    await client.query(
      `UPDATE ad_credit_wallets SET balance_minor=$2, reserved_minor=$3, updated_at=NOW() WHERE business_id=$1`,
      [businessId, balance, reserved]
    );
    const reservationId = id('acr');
    await client.query(
      `INSERT INTO ad_credit_reservations (id, business_id, operation_id, currency, reserved_minor, settled_minor, status)
       VALUES ($1,$2,$3,$4,$5,0,'active')
       ON CONFLICT (business_id, operation_id) DO UPDATE SET
         reserved_minor=EXCLUDED.reserved_minor, settled_minor=0, status='active', updated_at=NOW()
       RETURNING id`,
      [reservationId, businessId, operation.id, wallet.currency, hold]
    );
    await writeLedger(client, {
      businessId,
      entryType: 'reserve',
      amountMinor: -hold,
      balanceAfter: balance,
      reservedAfter: reserved,
      currency: wallet.currency,
      operationId: operation.id,
      note: 'Reserved for campaign activation',
      metadata: { hold }
    });
    return { reservationId, reservedMinor: hold, balanceMinor: balance };
  });
}

export async function releaseAdCreditReservation(businessId, operationId) {
  return transaction(async (client) => {
    const reservation = (
      await client.query(
        `SELECT * FROM ad_credit_reservations WHERE business_id=$1 AND operation_id=$2 FOR UPDATE`,
        [businessId, operationId]
      )
    ).rows[0];
    if (!reservation || reservation.status !== 'active') return { released: false };
    const remaining = Number(reservation.reserved_minor) - Number(reservation.settled_minor);
    const wallet = await ensureWallet(client, businessId);
    const balance = Number(wallet.balance_minor) + remaining;
    const reserved = Math.max(0, Number(wallet.reserved_minor) - remaining);
    await client.query(
      `UPDATE ad_credit_wallets SET balance_minor=$2, reserved_minor=$3, updated_at=NOW() WHERE business_id=$1`,
      [businessId, balance, reserved]
    );
    await client.query(
      `UPDATE ad_credit_reservations SET status='released', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
      [reservation.id, businessId]
    );
    if (remaining > 0) {
      await writeLedger(client, {
        businessId,
        entryType: 'release',
        amountMinor: remaining,
        balanceAfter: balance,
        reservedAfter: reserved,
        currency: wallet.currency,
        operationId,
        note: 'Unused campaign reservation released'
      });
    }
    return { released: true, releasedMinor: remaining, balanceMinor: balance };
  });
}

/** Settle Meta-reported spend against an active reservation (idempotent by settled total). */
export async function settleAdCreditSpend(businessId, operationId, spendMinor) {
  const spend = Math.max(0, Math.trunc(Number(spendMinor) || 0));
  if (!spend) return { settled: 0 };
  return transaction(async (client) => {
    const reservation = (
      await client.query(
        `SELECT * FROM ad_credit_reservations WHERE business_id=$1 AND operation_id=$2 FOR UPDATE`,
        [businessId, operationId]
      )
    ).rows[0];
    if (!reservation || reservation.status !== 'active') return { settled: 0, reason: 'no_active_reservation' };
    const already = Number(reservation.settled_minor);
    const target = Math.min(Number(reservation.reserved_minor), spend);
    const delta = target - already;
    if (delta <= 0) return { settled: 0, settledMinor: already };
    const wallet = await ensureWallet(client, businessId);
    const reserved = Math.max(0, Number(wallet.reserved_minor) - delta);
    await client.query('UPDATE ad_credit_wallets SET reserved_minor=$2, updated_at=NOW() WHERE business_id=$1', [
      businessId,
      reserved
    ]);
    const status = target >= Number(reservation.reserved_minor) ? 'exhausted' : 'active';
    await client.query(
      `UPDATE ad_credit_reservations SET settled_minor=$2, status=$3, updated_at=NOW() WHERE id=$1`,
      [reservation.id, target, status]
    );
    await writeLedger(client, {
      businessId,
      entryType: 'spend_settle',
      amountMinor: -delta,
      balanceAfter: Number(wallet.balance_minor),
      reservedAfter: reserved,
      currency: wallet.currency,
      operationId,
      note: 'Settled from Meta campaign spend',
      metadata: { spendMinor: spend, settledMinor: target }
    });
    return { settled: delta, settledMinor: target, status };
  });
}

function razorpayProvider() {
  return razorpayClient(process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET);
}

export async function createAdCreditPurchase(session, { packageId }) {
  if (session.role !== 'Owner') throw new AppError('Only the owner can buy ad credits.', 403, 'FORBIDDEN');
  if (!(await settingBool('ad_credits_enabled', true))) throw new AppError('Ad credits are disabled by the platform.', 403, 'AD_CREDITS_DISABLED');
  assertSubscriptionActive(await subscriptionUsage(session.businessId));
  const pack = (
    await query(
      `SELECT * FROM ad_credit_packages WHERE id=$1 AND is_active AND visible`,
      [clean(packageId)]
    )
  ).rows[0];
  if (!pack) throw new AppError('Choose a valid ad credit package.', 404, 'AD_CREDITS_PACKAGE_NOT_FOUND');
  const purchaseId = id('adpay');
  await query(
    `INSERT INTO ad_credit_purchases (id, business_id, package_id, currency, credits_minor, price_minor, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'processing',$7)`,
    [purchaseId, session.businessId, pack.id, pack.currency, pack.credits_minor, pack.price_minor, session.userId]
  );
  try {
    const appUrl = clean(process.env.APP_URL);
    const link = await razorpayProvider().paymentLink.create({
      amount: Number(pack.price_minor),
      currency: pack.currency,
      accept_partial: false,
      reference_id: purchaseId,
      description: `Ad credits ${pack.name}`,
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: appUrl ? new URL('/app?section=ads&adCredits=1', appUrl).href : undefined,
      callback_method: appUrl ? 'get' : undefined,
      notes: { purchaseId, businessId: session.businessId, kind: 'ad_credits' }
    });
    const url = razorpayCheckoutUrl(link.short_url);
    await query(
      `UPDATE ad_credit_purchases SET status='pending', provider_link_id=$2, checkout_url=$3, updated_at=NOW()
       WHERE id=$1 AND business_id=$4`,
      [purchaseId, link.id, url, session.businessId]
    );
    await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
      id('a'),
      session.businessId,
      session.userId,
      'ad_credits_purchase_created',
      JSON.stringify({ purchaseId, packageId: pack.id, priceMinor: pack.price_minor })
    ]);
    return { purchaseId, url, creditsMinor: Number(pack.credits_minor), priceMinor: Number(pack.price_minor), currency: pack.currency };
  } catch (error) {
    const rejected = razorpayRequestRejected(error);
    await query(
      `UPDATE ad_credit_purchases SET status=$2, error_code=$3, updated_at=NOW() WHERE id=$1 AND business_id=$4`,
      [purchaseId, rejected ? 'failed' : 'unconfirmed', rejected ? 'RAZORPAY_CREATE_REJECTED' : 'PAYMENT_DELIVERY_UNCONFIRMED', session.businessId]
    );
    throw new AppError(
      rejected ? 'Razorpay rejected the ad-credit checkout.' : 'Ad-credit checkout is unconfirmed. Reconcile before retrying.',
      409,
      rejected ? 'RAZORPAY_CREATE_REJECTED' : 'PAYMENT_DELIVERY_UNCONFIRMED'
    );
  }
}

export async function captureAdCreditPurchase(purchase, link) {
  if (!purchase || purchase.status === 'captured') return { captured: false, duplicate: true };
  if (Number(link.amount) !== Number(purchase.price_minor) || link.currency !== purchase.currency) {
    throw new AppError('Paid amount does not match the ad-credit purchase.', 409, 'AD_CREDITS_PAYMENT_MISMATCH');
  }
  if (link.status !== 'paid' || Number(link.amount_paid) !== Number(purchase.price_minor)) {
    throw new AppError('Ad-credit payment is not captured yet.', 409, 'AD_CREDITS_PAYMENT_PENDING');
  }
  return transaction(async (client) => {
    const locked = (
      await client.query(`SELECT * FROM ad_credit_purchases WHERE id=$1 AND business_id=$2 FOR UPDATE`, [
        purchase.id,
        purchase.business_id
      ])
    ).rows[0];
    if (!locked || locked.status === 'captured') return { captured: false, duplicate: true };
    await client.query(
      `UPDATE ad_credit_purchases SET status='captured', updated_at=NOW() WHERE id=$1 AND business_id=$2`,
      [purchase.id, purchase.business_id]
    );
    const wallet = await ensureWallet(client, purchase.business_id, purchase.currency);
    const balance = Number(wallet.balance_minor) + Number(purchase.credits_minor);
    await client.query('UPDATE ad_credit_wallets SET balance_minor=$2, currency=$3, updated_at=NOW() WHERE business_id=$1', [
      purchase.business_id,
      balance,
      purchase.currency
    ]);
    await writeLedger(client, {
      businessId: purchase.business_id,
      entryType: 'purchase',
      amountMinor: Number(purchase.credits_minor),
      balanceAfter: balance,
      reservedAfter: Number(wallet.reserved_minor),
      currency: purchase.currency,
      purchaseId: purchase.id,
      note: 'Razorpay ad credit purchase',
      metadata: { providerLinkId: purchase.provider_link_id }
    });
    return { captured: true, balanceMinor: balance };
  });
}

export async function reconcileAdCreditPurchase(businessId, purchaseId) {
  const purchase = (
    await query('SELECT * FROM ad_credit_purchases WHERE id=$1 AND business_id=$2', [purchaseId, businessId])
  ).rows[0];
  if (!purchase) throw new AppError('Purchase not found.', 404, 'NOT_FOUND');
  if (purchase.status === 'captured') return { ok: true, status: 'captured' };
  if (!purchase.provider_link_id) throw new AppError('Purchase has no Razorpay link to reconcile.', 409, 'AD_CREDITS_LINK_MISSING');
  const link = await razorpayProvider().paymentLink.fetch(purchase.provider_link_id);
  if (['cancelled', 'expired'].includes(link.status)) {
    await query(
      `UPDATE ad_credit_purchases SET status=$2, updated_at=NOW() WHERE id=$1 AND business_id=$3 AND status NOT IN ('captured')`,
      [purchase.id, link.status, businessId]
    );
    return { ok: true, status: link.status };
  }
  if (link.status === 'paid') {
    await captureAdCreditPurchase(purchase, link);
    return { ok: true, status: 'captured' };
  }
  return { ok: true, status: purchase.status };
}

export async function adCreditsRequest(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    await assertWorkspaceFeature('ads', session.businessId);
    if (request.method === 'GET') return json(await getAdCreditWallet(session.businessId));
    const body = await readJsonBodyLimited(request, 16000);
    if (body.action === 'buy') return json(await createAdCreditPurchase(session, body), 201);
    if (body.action === 'reconcile') return json(await reconcileAdCreditPurchase(session.businessId, clean(body.purchaseId)));
    if (body.action === 'claimStarter') {
      if (session.role !== 'Owner') throw new AppError('Only the owner can claim starter ad credits.', 403, 'FORBIDDEN');
      return json(await grantStarterAdCredits(session.businessId, { actorUserId: session.userId }));
    }
    throw new AppError('Unsupported ad-credit action.', 400, 'INVALID_ACTION');
  } catch (error) {
    return errorJson(error);
  }
}

export async function adCreditsWebhook(request) {
  try {
    const secret = clean(process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET);
    const raw = await readTextBodyLimited(request, 2_000_000);
    verifyRazorpaySignature(raw, request.headers.get('x-razorpay-signature'), secret);
    const payload = JSON.parse(raw);
    const entity = payload?.payload?.payment_link?.entity;
    const purchaseId = clean(entity?.reference_id || entity?.notes?.purchaseId);
    if (!purchaseId.startsWith('adpay')) return json({ ok: true, ignored: true });
    const purchase = (await query('SELECT * FROM ad_credit_purchases WHERE id=$1', [purchaseId])).rows[0];
    if (!purchase) return json({ ok: true, ignored: true });
    if (entity?.status === 'paid') await captureAdCreditPurchase(purchase, entity);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function adminGrantAdCredits({ businessId, amountMinor, note, adminId }) {
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount === 0) throw new AppError('Provide a non-zero credit adjustment.', 400, 'AD_CREDITS_AMOUNT_INVALID');
  return transaction(async (client) => {
    const wallet = await ensureWallet(client, businessId);
    const next = Number(wallet.balance_minor) + amount;
    if (next < 0) throw new AppError('Adjustment would make the wallet negative.', 400, 'AD_CREDITS_AMOUNT_INVALID');
    await client.query('UPDATE ad_credit_wallets SET balance_minor=$2, updated_at=NOW() WHERE business_id=$1', [
      businessId,
      next
    ]);
    await writeLedger(client, {
      businessId,
      entryType: amount > 0 ? 'admin_grant' : 'admin_adjust',
      amountMinor: amount,
      balanceAfter: next,
      reservedAfter: Number(wallet.reserved_minor),
      currency: wallet.currency,
      note: note || 'Super Admin adjustment',
      metadata: { adminId }
    });
    return { balanceMinor: next, currency: wallet.currency };
  });
}

/** Convert Meta spend (major units string/number) into wallet minor units. */
export function metaSpendToMinor(spend, currency) {
  if (spend === null || spend === undefined || spend === '') return 0;
  return paymentMinorUnits(String(spend), currency);
}
