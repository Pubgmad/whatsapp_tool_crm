import { query } from './db.js';

export async function commerceOperationsCenter(businessId) {
  const [orders, checkouts, native, recovery] = await Promise.all([
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
    ).catch(() => ({ rows: [{ queued: 0 }] }))
  ]);
  return {
    orders: orders.rows[0],
    merchantCheckoutsOpen: checkouts.rows[0]?.open || 0,
    nativeCheckoutsOpen: native.rows[0]?.open || 0,
    recoveryQueued: recovery.rows[0]?.queued || 0
  };
}
