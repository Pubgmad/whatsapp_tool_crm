import { query } from './db.js';
import { reconcileMerchantCheckout } from './merchant-payments.js';
import { reconcileNativeCheckout } from './whatsapp-native-payments.js';

/**
 * Background reconcile for stale merchant / native checkouts.
 * Never marks success from client redirects — only Razorpay/Meta APIs via existing reconcile helpers.
 */
export async function runPaymentReconcileJobs({ limit = 20 } = {}) {
  const batch = Math.min(50, Math.max(1, Number(limit) || 20));
  const summary = { merchant: 0, native: 0, errors: 0 };

  const merchantRows = (
    await query(
      `SELECT id, business_id FROM merchant_checkouts
       WHERE status IN ('pending','processing','unconfirmed')
         AND created_at < NOW() - INTERVAL '2 minutes'
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at LIMIT $1`,
      [batch]
    ).catch(() => ({ rows: [] }))
  ).rows;

  for (const row of merchantRows) {
    try {
      await reconcileMerchantCheckout(row.business_id, row.id);
      summary.merchant += 1;
    } catch {
      summary.errors += 1;
    }
  }

  const nativeRows = (
    await query(
      `SELECT id, business_id FROM whatsapp_native_checkouts
       WHERE status IN ('pending','processing','unconfirmed')
         AND created_at < NOW() - INTERVAL '2 minutes'
         AND created_at > NOW() - INTERVAL '7 days'
       ORDER BY created_at LIMIT $1`,
      [batch]
    ).catch(() => ({ rows: [] }))
  ).rows;

  for (const row of nativeRows) {
    try {
      await reconcileNativeCheckout(row.business_id, row.id);
      summary.native += 1;
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}
