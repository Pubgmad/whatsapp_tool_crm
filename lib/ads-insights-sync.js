import { id, query } from './db.js';
import { decryptSecret } from './meta.js';
import { metaGraphApiVersion } from './operational-policy.js';
import { readTextBodyLimited } from './security.js';

async function graphGet(token, path) {
  const response = await fetch(`https://graph.facebook.com/${metaGraphApiVersion()}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const result = JSON.parse(await readTextBodyLimited(response, 2_000_000));
  if (!response.ok) {
    const err = new Error(result.error?.message || 'Meta insights request failed.');
    err.code = response.status >= 500 ? 'ADS_UNCONFIRMED' : 'ADS_REJECTED';
    throw err;
  }
  return result;
}

export function isoDateUtc(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export async function upsertAdsInsightSnapshot(businessId, operation, { since, until, currency, rows }) {
  const row = Array.isArray(rows) && rows.length ? rows[0] : {};
  const snapshotId = id('ais');
  await query(
    `INSERT INTO whatsapp_ads_insight_snapshots
      (id, business_id, operation_id, campaign_id, since_date, until_date, currency, impressions, reach, clicks, spend, actions, raw)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)
     ON CONFLICT (operation_id, since_date, until_date) DO UPDATE SET
       currency=EXCLUDED.currency,
       impressions=EXCLUDED.impressions,
       reach=EXCLUDED.reach,
       clicks=EXCLUDED.clicks,
       spend=EXCLUDED.spend,
       actions=EXCLUDED.actions,
       raw=EXCLUDED.raw,
       synced_at=NOW()`,
    [
      snapshotId,
      businessId,
      operation.id,
      operation.campaign_id,
      since,
      until,
      currency || '',
      row.impressions ?? null,
      row.reach ?? null,
      row.clicks ?? null,
      row.spend ?? null,
      JSON.stringify(row.actions || []),
      JSON.stringify(row)
    ]
  );
}

/** Background refresh of Meta campaign insights for connected workspaces (last 7 days). */
export async function runAdsInsightsSync({ limit = 10 } = {}) {
  const capped = Number.isInteger(limit) && limit >= 1 && limit <= 50 ? limit : 10;
  const since = isoDateUtc(7);
  const until = isoDateUtc(0);
  const operations = (
    await query(
      `SELECT o.id, o.business_id, o.campaign_id, o.ad_account_id, c.access_token_encrypted, c.currency
       FROM whatsapp_ads_operations o
       JOIN whatsapp_ads_connections c ON c.business_id=o.business_id
       WHERE o.campaign_id <> '' AND o.state IN ('active','paused')
         AND NOT EXISTS (
           SELECT 1 FROM whatsapp_ads_insight_snapshots s
           WHERE s.operation_id=o.id AND s.since_date=$1::date AND s.until_date=$2::date
             AND s.synced_at > NOW() - INTERVAL '6 hours'
         )
       ORDER BY o.updated_at DESC
       LIMIT $3`,
      [since, until, capped]
    )
  ).rows;

  let synced = 0;
  let failed = 0;
  for (const operation of operations) {
    try {
      const token = decryptSecret(operation.access_token_encrypted);
      const result = await graphGet(
        token,
        `${operation.campaign_id}/insights?fields=campaign_id,campaign_name,impressions,reach,clicks,spend,actions&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=25`
      );
      await upsertAdsInsightSnapshot(operation.business_id, operation, {
        since,
        until,
        currency: operation.currency,
        rows: result.data || []
      });
      const spend = result.data?.[0]?.spend;
      if (spend !== undefined && spend !== null && spend !== '') {
        try {
          const { metaSpendToMinor, settleAdCreditSpend } = await import('./ad-credits.js');
          await settleAdCreditSpend(
            operation.business_id,
            operation.id,
            metaSpendToMinor(spend, operation.currency || 'INR')
          );
        } catch {
          /* spend settle is best-effort; reservation remains until pause/archive */
        }
      }
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: operations.length, synced, failed, since, until };
}
