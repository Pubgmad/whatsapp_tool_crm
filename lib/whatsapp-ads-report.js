import { query } from './db.js';

export async function whatsappAdsReadiness(businessId) {
  const connection = (
    await query(
      `SELECT ad_account_id,page_id,phone_number_id,currency,connection_method,leadgen_subscribed,
              permissions_checked_at,token_expires_at,last_permission_report
       FROM whatsapp_ads_connections WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0];
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
  if (connection && connection.leadgen_subscribed === false) {
    blockers.push('Subscribe the Facebook Page to leadgen webhooks (Continue with Facebook or Subscribe leadgen).');
  }
  const permissionReport = connection?.last_permission_report || {};
  if (permissionReport.complete === false && Array.isArray(permissionReport.missing) && permissionReport.missing.length) {
    blockers.push(`Missing Meta permissions: ${permissionReport.missing.join(', ')}`);
  }
  if (connection?.token_expires_at && new Date(connection.token_expires_at).getTime() < Date.now()) {
    blockers.push('Advertising access token expired. Reauthorize with Continue with Facebook.');
  }
  const active = ops.find((row) => row.state === 'active')?.count || 0;
  const partial = ops.find((row) => row.state === 'partial')?.count || 0;
  if (partial) blockers.push(`${partial} campaign operation(s) need reconciliation in Meta.`);
  const oauthConfigured = Boolean(
    process.env.META_APP_ID &&
      process.env.META_APP_SECRET &&
      (process.env.NODE_ENV !== 'production' || (process.env.APP_URL && String(process.env.APP_URL).startsWith('https:')))
  );
  const workerConfigured = Boolean(
    process.env.JOB_RUNNER_SECRET &&
      !String(process.env.JOB_RUNNER_SECRET).startsWith('replace-with') &&
      (process.env.JOB_RUNNER_URL || process.env.APP_URL)
  );
  const awaitingLiveVerification = [
    !oauthConfigured ? 'Configure META_APP_ID, META_APP_SECRET, and HTTPS APP_URL for Facebook Login ads OAuth.' : null,
    !workerConfigured ? 'Configure JOB_RUNNER_SECRET and APP_URL/JOB_RUNNER_URL; keep the worker process running for insight refresh.' : null,
    'Meta App Review is required for production ads_management / leads_retrieval beyond development assets.',
    'Live publish, rejection, delivery, and leadgen webhook traffic must be confirmed against a real Meta ad account.',
    'Ad spend is billed by Meta on the connected ad account — this CRM does not sell AiSensy-style ad credits.'
  ].filter(Boolean);
  return {
    connected: Boolean(connection?.ad_account_id && connection?.page_id),
    connection,
    operationsByState: Object.fromEntries(ops.map((row) => [row.state, row.count])),
    activeCampaigns: active,
    experimentsByStatus: Object.fromEntries(experiments.map((row) => [row.status, row.count])),
    readyToLaunch: blockers.length === 0,
    blockers,
    oauthConfigured,
    workerConfigured,
    awaitingLiveVerification,
    billingModel:
      'Meta bills advertising spend on the connected ad account. Subscription plans may limit how many CRM ad campaigns can exist; they do not prepaid Meta media credits.'
  };
}

/** CRM-side acquisition → conversation → lead → order funnel (not Meta impressions). */
export async function whatsappAdsJourneyFunnel(businessId, { days = 30 } = {}) {
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
  const adConversations = (
    await query(
      `SELECT COUNT(*)::int AS count FROM conversations
       WHERE business_id=$1 AND first_referral_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND first_referral->>'sourceType'='AD'`,
      [businessId, windowDays]
    )
  ).rows[0]?.count || 0;
  const leadSubmissions = (
    await query(
      `SELECT COUNT(*)::int AS count FROM meta_leadgen_submissions
       WHERE business_id=$1 AND ingested_at >= NOW() - ($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    )
  ).rows[0]?.count || 0;
  const ordersWithReferral = (
    await query(
      `SELECT COUNT(*)::int AS count FROM whatsapp_orders o
       JOIN contacts ct ON ct.business_id=o.business_id AND ct.phone=o.customer_phone
       JOIN conversations cv ON cv.business_id=o.business_id AND cv.contact_id=ct.id
       WHERE o.business_id=$1 AND o.created_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND cv.first_referral->>'sourceType'='AD'`,
      [businessId, windowDays]
    )
  ).rows[0]?.count || 0;
  const cachedInsights = (
    await query(
      `SELECT COALESCE(SUM(impressions),0)::text AS impressions,
              COALESCE(SUM(clicks),0)::text AS clicks,
              COALESCE(SUM(spend),0)::text AS spend
       FROM whatsapp_ads_insight_snapshots
       WHERE business_id=$1 AND synced_at >= NOW() - ($2::int * INTERVAL '1 day')`,
      [businessId, windowDays]
    )
  ).rows[0];
  return {
    windowDays,
    stages: [
      {
        id: 'meta_impressions_cached',
        label: 'Cached Meta impressions (synced snapshots)',
        count: Number(cachedInsights?.impressions || 0),
        provenance: 'meta_cached',
        available: Boolean(cachedInsights?.impressions)
      },
      {
        id: 'meta_clicks_cached',
        label: 'Cached Meta clicks (synced snapshots)',
        count: Number(cachedInsights?.clicks || 0),
        provenance: 'meta_cached',
        available: Boolean(cachedInsights?.clicks)
      },
      {
        id: 'ad_conversations',
        label: 'WhatsApp conversations with AD referral',
        count: adConversations,
        provenance: 'crm_referral',
        available: true
      },
      {
        id: 'lead_forms',
        label: 'Meta lead form submissions ingested',
        count: leadSubmissions,
        provenance: 'crm_leadgen',
        available: true
      },
      {
        id: 'orders_with_ad_referral',
        label: 'Orders linked to contacts with AD referral',
        count: ordersWithReferral,
        provenance: 'crm_attribution',
        available: true
      }
    ],
    notes: [
      'Impressions and clicks here are only from CRM-synced Meta insight snapshots, not live Meta totals.',
      'Ad referral conversations require CTWA referral metadata on the inbound WhatsApp webhook.',
      'Lead form submissions require page leadgen webhooks plus ads.reads / leads_retrieval permissions (Awaiting Live Verification).',
      'Order stages use evidence-qualified CRM links; they are not claimed as Meta-modeled conversions.'
    ],
    cachedSpend: cachedInsights?.spend || '0'
  };
}

export async function whatsappAdsPerformanceSummary(businessId, { days = 30 } = {}) {
  const windowDays = Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30;
  const operations = (
    await query(
      `SELECT id, COALESCE(payload->'campaign'->>'name','') AS name, state, stage, campaign_id, adset_id, creative_id,
              COALESCE(objective_kind, payload->>'objectiveKind', 'MESSAGES') AS objective_kind,
              created_at, updated_at
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
  const journeyFunnel = await whatsappAdsJourneyFunnel(businessId, { days: windowDays });
  return {
    windowDays,
    operations,
    whatsappEntryConversations: referrals?.conversations || 0,
    experiments,
    journeyFunnel,
    metricDefinitions: {
      meta: ['impressions', 'reach', 'clicks', 'spend', 'actions'],
      crm: ['whatsappEntryConversations', 'journeyFunnel.ad_conversations', 'journeyFunnel.lead_forms', 'journeyFunnel.orders_with_ad_referral'],
      notFabricated: ['roas', 'modeled_conversions', 'meta_pixel_only_events_without_capi']
    }
  };
}
