import { query } from './db.js';
import { normalizeCampaignSourceKind } from './campaign-source.js';

/** True when campaign-source-taxonomy.sql has been applied. */
export async function campaignSourceColumnsReady() {
  const row = (
    await query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='campaigns' AND column_name='source_kind'
       ) AS ready`
    )
  ).rows[0];
  return Boolean(row?.ready);
}

/** Fallback when campaign-source-taxonomy migration has not been applied yet. */
async function campaignTotalsWithoutTaxonomy(businessId) {
  const row = (
    await query(
      `SELECT
         COUNT(DISTINCT c.id)::int AS campaigns,
         COUNT(cr.id)::int AS recipients,
         COUNT(cr.id) FILTER (WHERE cr.status IN ('delivered','read'))::int AS delivered,
         COUNT(cr.id) FILTER (WHERE cr.status='read')::int AS read,
         COUNT(cr.id) FILTER (WHERE cr.status='failed')::int AS failed
       FROM campaigns c
       LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
       WHERE c.business_id=$1`,
      [businessId]
    )
  ).rows[0];
  if (!Number(row?.campaigns || 0)) return [];
  return [
    {
      sourceKind: 'unknown',
      sourceId: null,
      campaigns: Number(row.campaigns || 0),
      recipients: Number(row.recipients || 0),
      delivered: Number(row.delivered || 0),
      read: Number(row.read || 0),
      failed: Number(row.failed || 0)
    }
  ];
}

export async function campaignSourceAnalytics(businessId, { sourceKind = '', sourceId = '' } = {}) {
  if (!(await campaignSourceColumnsReady())) {
    return campaignTotalsWithoutTaxonomy(businessId);
  }
  const kind = sourceKind ? normalizeCampaignSourceKind(sourceKind, '') : '';
  const originId = String(sourceId || '').trim().slice(0, 255);
  try {
    const rows = (
      await query(
        `SELECT c.source_kind,c.source_id,
           COUNT(DISTINCT c.id)::int AS campaigns,
           COUNT(cr.id)::int AS recipients,
           COUNT(cr.id) FILTER (WHERE cr.status IN ('delivered','read'))::int AS delivered,
           COUNT(cr.id) FILTER (WHERE cr.status='read')::int AS read,
           COUNT(cr.id) FILTER (WHERE cr.status='failed')::int AS failed
         FROM campaigns c
         LEFT JOIN campaign_recipients cr ON cr.campaign_id=c.id
         WHERE c.business_id=$1
           AND ($2='' OR c.source_kind=$2)
           AND ($3='' OR c.source_id=$3)
         GROUP BY c.source_kind,c.source_id
         ORDER BY campaigns DESC,c.source_kind,c.source_id NULLS FIRST`,
        [businessId, kind, originId]
      )
    ).rows;
    return rows.map((row) => ({
      sourceKind: row.source_kind || 'unknown',
      sourceId: row.source_id || null,
      campaigns: Number(row.campaigns || 0),
      recipients: Number(row.recipients || 0),
      delivered: Number(row.delivered || 0),
      read: Number(row.read || 0),
      failed: Number(row.failed || 0)
    }));
  } catch (error) {
    // Undefined column / migration race — degrade to totals instead of failing Campaign Insights.
    if (error?.code === '42703') return campaignTotalsWithoutTaxonomy(businessId);
    throw error;
  }
}
