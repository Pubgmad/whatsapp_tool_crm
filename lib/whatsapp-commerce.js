import crypto from 'node:crypto';
import { requireSession } from './auth.js';
import { AppError, query, transaction, id, json, errorJson } from './db.js';
import { decryptSecret } from './meta.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { readJsonBodyLimited } from './security.js';
import { assertSubscriptionActive, subscriptionUsage } from './limits.js';
import { metaGraphApiVersion } from './operational-policy.js';

const clean = (value) => String(value || '').trim();
const fail = (message = 'Invalid WhatsApp order.') => { throw new AppError(message, 400, 'INVALID_WHATSAPP_ORDER'); };

export function normalizeCatalogOrder(message) {
  if (message?.type !== 'order') return null;
  const order = message.order;
  if (!message.id || clean(message.id).length > 512 || !/^\d{5,20}$/.test(clean(message.from)) || !/^\d{1,32}$/.test(clean(order?.catalog_id)) || !Array.isArray(order?.product_items) || !order.product_items.length || order.product_items.length > 100) fail();
  let currency = '';
  let total = 0n;
  const items = order.product_items.map((item) => {
    const price = clean(item.item_price);
    const code = clean(item.currency).toUpperCase();
    const quantity = Number(item.quantity);
    if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(price) || !/^[A-Z]{3}$/.test(code) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000 || !clean(item.product_retailer_id) || clean(item.product_retailer_id).length > 256) fail();
    if (currency && currency !== code) fail('An order cannot mix currencies.');
    currency = code;
    const [whole, fraction = ''] = price.split('.');
    total += (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))) * BigInt(quantity);
    return { retailerId: clean(item.product_retailer_id), quantity, price, currency: code };
  });
  const amount = `${total / 1000000n}.${String(total % 1000000n).padStart(6, '0')}`;
  if (total >= 10n ** 24n) fail('Order total is too large.');
  return { sourceMessageId: clean(message.id), customerPhone: clean(message.from), catalogId: clean(order.catalog_id), items, currency, totalAmount: amount };
}

export function canTransitionOrder(current, next, paymentStatus) {
  if (current === next) return true;
  if (next === 'cancelled' && ['captured','partially_refunded'].includes(paymentStatus)) return false;
  const transitions = { pending: ['processing', 'cancelled'], processing: ['shipped', 'completed', 'cancelled'], shipped: ['completed'], completed: [], cancelled: [] };
  return Boolean(transitions[current]?.includes(next));
}

export async function ingestCatalogOrder(businessId, phoneNumberId, message, execute = query) {
  const order = normalizeCatalogOrder(message);
  if (!order) return;
  await execute(
    `INSERT INTO whatsapp_orders (id,business_id,phone_id,source_message_id,customer_phone,catalog_id,items,currency,total_amount)
     SELECT $1,$2,p.id,$4,$5,$6,$7::jsonb,$8,$9::numeric FROM whatsapp_phone_numbers p
     WHERE p.business_id=$2 AND p.phone_number_id=$3
     ON CONFLICT (business_id,source_message_id) DO NOTHING`,
    [id('wo'), businessId, clean(phoneNumberId), order.sourceMessageId, order.customerPhone, order.catalogId, JSON.stringify(order.items), order.currency, order.totalAmount]
  );
}

export async function reconcileWhatsAppPayment(businessId, phoneNumberId, update, transact = transaction) {
  if (update?.type !== 'payment' || !['pending', 'captured', 'failed'].includes(update.status)) return false;
  const reference = clean(update.payment?.reference_id);
  const seconds = Number(update.timestamp);
  if (!reference || !clean(update.id) || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8640000000000) return false;
  const occurredAt = new Date(seconds * 1000);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([businessId, phoneNumberId, update.id, reference, update.status, seconds])).digest('hex');
  return transact(async (client) => {
    const order = (await client.query(
      `SELECT o.* FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id
       WHERE o.business_id=$1 AND p.phone_number_id=$2 AND o.reference_id=$3 AND o.checkout_message_id=$4 FOR UPDATE OF o`,
      [businessId, clean(phoneNumberId), reference, clean(update.id)]
    )).rows[0];
    if (!order) return false;
    if((await client.query('SELECT 1 FROM shopify_order_settlements WHERE order_id=$1 AND business_id=$2',[order.id,businessId])).rowCount)return false;
    const inserted = await client.query(
      'INSERT INTO whatsapp_payment_events (id,business_id,order_id,fingerprint,status,occurred_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (fingerprint) DO NOTHING RETURNING id',
      [id('wpe'), businessId, order.id, fingerprint, update.status, occurredAt]
    );
    if (!inserted.rowCount) return true;
    if (order.payment_status !== 'captured' && (!order.payment_event_at || occurredAt >= new Date(order.payment_event_at) || update.status === 'captured')) {
      await client.query('UPDATE whatsapp_orders SET payment_status=$1,payment_event_at=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4', [update.status, occurredAt, order.id, businessId]);
    }
    return true;
  });
}

async function graph(path, account) {
  if (!account?.access_token_encrypted || account.status !== 'connected' || (account.token_expires_at && new Date(account.token_expires_at) <= new Date())) throw new AppError('Reconnect this WhatsApp account.', 409, 'META_RECONNECT_REQUIRED');
  const url = new URL(`https://graph.facebook.com/${metaGraphApiVersion()}/${path}`);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${decryptSecret(account.access_token_encrypted)}` }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok) throw new AppError('Meta catalog request failed. Check catalog access and permissions.', 502, 'META_CATALOG_FAILED');
  return payload;
}

export async function getCommerce(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = new URL(request.url).searchParams;
    const accountId = clean(params.get('accountId'));
    if (params.get('resource') === 'catalogs' || params.get('resource') === 'products') {
      const account = (await query('SELECT * FROM whatsapp_accounts WHERE id=$1 AND business_id=$2', [accountId, session.businessId])).rows[0];
      if (!account) throw new AppError('WhatsApp account not found.', 404, 'NOT_FOUND');
      const catalogId = clean(params.get('catalogId'));
      const catalogs = await graph(`${encodeURIComponent(account.waba_id)}/product_catalogs?fields=id,name&limit=100`, account);
      if (params.get('resource') === 'catalogs') return json({ data: catalogs.data || [] });
      if (!/^\d+$/.test(catalogId) || !catalogs.data?.some((catalog) => catalog.id === catalogId)) throw new AppError('Select a catalog linked to this WABA.', 403, 'CATALOG_ACCESS_DENIED');
      const cursor = clean(params.get('after'));
      if (cursor.length > 2000) throw new AppError('Invalid page cursor.', 400, 'INVALID_CURSOR');
      const products = await graph(`${catalogId}/products?fields=id,name,retailer_id,price,currency,availability,image_url&limit=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, account);
      return json({ data: products.data || [], nextCursor: products.paging?.next ? products.paging?.cursors?.after || null : null });
    }
    const rawPage = Number(params.get('page') || 1);
    const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 100000)) : 1;
    const orders = await query('SELECT o.*,p.whatsapp_account_id FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id WHERE o.business_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 26 OFFSET $2', [session.businessId, (page - 1) * 25]);
    const accounts = await query('SELECT id,name,waba_id FROM whatsapp_accounts WHERE business_id=$1 ORDER BY is_default DESC,created_at', [session.businessId]);
    return json({ orders: orders.rows.slice(0,25), page, hasMore: orders.rows.length > 25, accounts: accounts.rows });
  } catch (error) { return errorJson(error); }
}

export async function updateCommerceOrder(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    assertSubscriptionActive(await subscriptionUsage(session.businessId));
    const body = await readJsonBodyLimited(request, 4096);
    if (Object.keys(body).some((key) => !['orderId', 'status'].includes(key))) throw new AppError('Only fulfillment status can be edited.', 400, 'INVALID_ACTION');
    await transaction(async (client) => {
      const order = (await client.query('SELECT * FROM whatsapp_orders WHERE id=$1 AND business_id=$2 FOR UPDATE', [clean(body.orderId), session.businessId])).rows[0];
      if (!order) throw new AppError('Order not found.', 404, 'NOT_FOUND');
      if (!canTransitionOrder(order.fulfillment_status, clean(body.status), order.payment_status)) throw new AppError('This order transition is not allowed.', 409, 'ORDER_TRANSITION_INVALID');
      await client.query('UPDATE whatsapp_orders SET fulfillment_status=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3', [clean(body.status), order.id, session.businessId]);
      await client.query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [id('a'), session.businessId, session.userId, 'whatsapp_order_fulfillment', JSON.stringify({ orderId: order.id, from: order.fulfillment_status, to: clean(body.status) })]);
    });
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
