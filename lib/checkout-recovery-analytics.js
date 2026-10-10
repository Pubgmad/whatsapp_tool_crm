import { query } from './db.js';

/**
 * Tenant-scoped checkout recovery analytics.
 * Recovered revenue only counts events explicitly marked recovered after a verified order/checkout closure.
 */
export async function checkoutRecoveryAnalytics(businessId, { days = 30 } = {}) {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 30));
  const [totals, reasons, recovered] = await Promise.all([
    query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type='detected')::int AS detected,
         COUNT(*) FILTER (WHERE event_type='queued')::int AS queued,
         COUNT(*) FILTER (WHERE event_type='skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE event_type='suppressed_purchase')::int AS suppressed_purchase,
         COUNT(*) FILTER (WHERE event_type='recovered')::int AS recovered
       FROM checkout_recovery_events
       WHERE business_id=$1 AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    ).catch(() => ({ rows: [{}] })),
    query(
      `SELECT reason, COUNT(*)::int AS count
       FROM checkout_recovery_events
       WHERE business_id=$1 AND event_type IN ('skipped','suppressed_purchase') AND created_at>=NOW()-($2::int * INTERVAL '1 day')
       GROUP BY reason ORDER BY count DESC LIMIT 12`,
      [businessId, windowDays]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT COALESCE(SUM(amount),0)::text AS recovered_revenue, COALESCE(MAX(currency),'') AS currency
       FROM checkout_recovery_events
       WHERE business_id=$1 AND event_type='recovered' AND amount IS NOT NULL
         AND created_at>=NOW()-($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    ).catch(() => ({ rows: [{ recovered_revenue: '0', currency: '' }] }))
  ]);

  const openPending = (
    await query(
      `SELECT COUNT(*)::int AS open_pending
       FROM provider_connector_records r
       JOIN provider_connectors c ON c.id=r.connector_id AND c.business_id=r.business_id
       WHERE r.business_id=$1 AND r.resource='checkout' AND r.recovery_status='pending'
         AND r.data->>'terminal'='false' AND c.recovery_enabled`,
      [businessId]
    ).catch(() => ({ rows: [{ open_pending: 0 }] }))
  ).rows[0];

  const t = totals.rows[0] || {};
  const detected = Number(t.detected || 0);
  const recoveredCount = Number(t.recovered || 0);
  return {
    days: windowDays,
    detected,
    queued: Number(t.queued || 0),
    skipped: Number(t.skipped || 0),
    suppressedPurchase: Number(t.suppressed_purchase || 0),
    recovered: recoveredCount,
    openPending: Number(openPending?.open_pending || 0),
    conversionRate: detected ? Number(((recoveredCount / detected) * 100).toFixed(2)) : 0,
    recoveredRevenue: recovered.rows[0]?.recovered_revenue || '0',
    recoveredCurrency: recovered.rows[0]?.currency || '',
    skipReasons: reasons.rows,
    attributionNote:
      'Recovered revenue counts only checkout_recovery_events with event_type=recovered after a verified order/checkout closure — not clicks alone.'
  };
}
