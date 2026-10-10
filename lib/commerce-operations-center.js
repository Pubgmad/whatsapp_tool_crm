import { query } from './db.js';
import { checkoutRecoveryAnalytics } from './checkout-recovery-analytics.js';

export async function commerceOperationsCenter(businessId) {
  const [orders, checkouts, native, recovery, storeOrders, connectors] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE fulfillment_status IN ('pending','processing'))::int AS open,
        COUNT(*) FILTER (WHERE payment_status='captured')::int AS paid
       FROM whatsapp_orders WHERE business_id=$1`,
      [businessId]
    ),
    query(
      `SELECT COUNT(*)::int AS open FROM merchant_checkouts WHERE business_id=$1 AND status IN ('pending','processing')`,
      [businessId]
    ),
    query(
      `SELECT COUNT(*)::int AS open FROM whatsapp_native_checkouts WHERE business_id=$1 AND status IN ('pending','processing')`,
      [businessId]
    ),
    query(
      `SELECT COUNT(*)::int AS queued FROM provider_connector_records WHERE business_id=$1 AND recovery_status='pending'`,
      [businessId]
    ).catch(() => ({ rows: [{ queued: 0 }] })),
    query(
      `SELECT provider, COUNT(*)::int AS total
       FROM commerce_store_orders WHERE business_id=$1
       GROUP BY provider ORDER BY total DESC`,
      [businessId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT provider, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE enabled)::int AS enabled,
              COUNT(*) FILTER (WHERE recovery_enabled)::int AS recovery_enabled
       FROM provider_connectors WHERE business_id=$1 GROUP BY provider`,
      [businessId]
    ).catch(() => ({ rows: [] }))
  ]);
  const analytics = await checkoutRecoveryAnalytics(businessId).catch(() => null);
  return {
    orders: orders.rows[0],
    merchantCheckoutsOpen: checkouts.rows[0]?.open || 0,
    nativeCheckoutsOpen: native.rows[0]?.open || 0,
    recoveryQueued: recovery.rows[0]?.queued || 0,
    storeOrdersByProvider: storeOrders.rows,
    connectorsByProvider: connectors.rows,
    checkoutRecovery: analytics,
    awaitingLiveVerification: [
      'Shopify OAuth app scopes + live checkout webhooks (CHECKOUTS_CREATE/UPDATE)',
      'WooCommerce checkout.abandoned extension or middleware posting signed webhooks',
      'Razorpay live keys + dashboard webhook URL registration',
      'Native WhatsApp payments: Meta India eligibility + Razorpay WABA payment configuration'
    ]
  };
}
