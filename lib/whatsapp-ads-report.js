import { query } from './db.js';

export async function whatsappAdsReadiness(businessId) {
  const connection = (await query('SELECT ad_account_id,page_id,phone_number_id,currency FROM whatsapp_ads_connections WHERE business_id=$1', [businessId])).rows[0];
  const ops = (
    await query(
      `SELECT state, COUNT(*)::int AS count FROM whatsapp_ads_operations WHERE business_id=$1 GROUP BY state`,
      [businessId]
    )
  ).rows;
  const experiments = (
    await query(
      `SELECT status, COUNT(*)::int AS count FROM whatsapp_ad_experiments WHERE business_id=$1 GROUP BY status`,
      [businessId]
    )
  ).rows;
  const blockers = [];
  if (!connection?.ad_account_id) blockers.push('Connect a Meta ad account in Ads settings.');
  if (!connection?.page_id) blockers.push('Link a Facebook Page for CTWA creatives.');
  if (!connection?.phone_number_id) blockers.push('Select the WhatsApp number used in click-to-WhatsApp ads.');
  const active = ops.find((row) => row.state === 'active')?.count || 0;
  const partial = ops.find((row) => row.state === 'partial')?.count || 0;
  if (partial) blockers.push(`${partial} campaign operation(s) need reconciliation in Meta.`);
  return {
    connected: Boolean(connection?.ad_account_id && connection?.page_id),
    connection,
    operationsByState: Object.fromEntries(ops.map((row) => [row.state, row.count])),
    activeCampaigns: active,
    experimentsByStatus: Object.fromEntries(experiments.map((row) => [row.status, row.count])),
    readyToLaunch: blockers.length === 0,
    blockers
  };
}

export async function whatsappAdsPerformanceSummary(businessId, { days = 30 } = {}) {
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
  const operations = (
    await query(
      `SELECT id,name,state,stage,campaign_id,adset_id,creative_id,created_at,updated_at
       FROM whatsapp_ads_operations WHERE business_id=$1 AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY updated_at DESC LIMIT 100`,
      [businessId, windowDays]
    )
  ).rows;
  const referrals = (
    await query(
      `SELECT COUNT(DISTINCT c.id)::int AS conversations
       FROM conversations c
       WHERE c.business_id=$1 AND c.first_referral_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND c.first_referral IS NOT NULL`,
      [businessId, windowDays]
    )
  ).rows[0];
  const experiments = (
    await query(
      `SELECT id,name,meta_campaign_id,hypothesis,status,started_at,ended_at
       FROM whatsapp_ad_experiments WHERE business_id=$1 ORDER BY started_at DESC LIMIT 25`,
      [businessId]
    )
  ).rows;
  return { windowDays, operations, whatsappEntryConversations: referrals?.conversations || 0, experiments };
}
