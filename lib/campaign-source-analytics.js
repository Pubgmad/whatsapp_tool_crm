import { query } from './db.js';
import { normalizeCampaignSourceKind } from './campaign-source.js';

export async function campaignSourceAnalytics(businessId, { sourceKind = '', sourceId = '' } = {}) {
  const kind = sourceKind ? normalizeCampaignSourceKind(sourceKind, '') : '';
  const originId = String(sourceId || '').trim().slice(0, 255);
  const rows = (await query(
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
  )).rows;
  return rows.map((row) => ({
    sourceKind: row.source_kind || 'unknown',
    sourceId: row.source_id || null,
    campaigns: Number(row.campaigns || 0),
    recipients: Number(row.recipients || 0),
    delivered: Number(row.delivered || 0),
    read: Number(row.read || 0),
    failed: Number(row.failed || 0)
  }));
}
