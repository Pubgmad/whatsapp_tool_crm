import { query } from './db.js';
import { workspaceProductionCertification } from './production-certification.js';
import { workspaceOperationsReport } from './workspace-operations-report.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { aiSafetyDashboard } from './ai-safety-events.js';
import { flowScreenDropOffForBusiness } from './flow-screen-analytics.js';
import { inboxSlaSnapshot } from './inbox-sla-snapshot.js';
import { openSupportQueueCounts } from './support-queue-metrics.js';
import { campaignSendEventMetrics } from './campaign-send-events.js';
import { integrationLiveStatus } from './integration-live-status.js';
import { workspaceMmLiteOptimizerReport } from './mm-lite-optimizer.js';
import { honestLimitsPayload } from './honest-product-limits.js';
import { workspaceProductionPending } from './production-pending-report.js';
import { managedFlowRuntimeUrl } from './flow-runtime-url.js';

async function supportQueueSnapshot(businessId) {
  const counts = await openSupportQueueCounts(businessId);
  return {
    waitingNow: counts.waitingNow,
    breachedNow: counts.breachedNow,
    openAssigned: counts.openAssigned
  };
}

async function campaignsGrowthSnapshot(businessId) {
  const row = (
    await query(
      `SELECT
        COUNT(*) FILTER (WHERE status IN ('queued','processing','scheduled'))::int AS active,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed_campaigns,
        (SELECT COUNT(*)::int FROM campaign_recipients cr JOIN campaigns c ON c.id=cr.campaign_id WHERE c.business_id=$1 AND cr.status='failed') AS failed_recipients
       FROM campaigns WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0];
  const sendEvents = await campaignSendEventMetrics(businessId);
  return {
    activeCampaigns: Number(row?.active || 0),
    failedCampaigns: Number(row?.failed_campaigns || 0),
    failedRecipients: Number(row?.failed_recipients || 0),
    sendEvents
  };
}

async function commerceSnapshot(businessId) {
  const orders = (
    await query(
      `SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE fulfillment_status IN ('pending','processing'))::int AS open_orders,
        COUNT(*) FILTER (WHERE payment_status='captured')::int AS paid
       FROM whatsapp_orders WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0];
  return {
    ordersTotal: Number(orders?.total || 0),
    openOrders: Number(orders?.open_orders || 0),
    paidOrders: Number(orders?.paid || 0)
  };
}

async function adsSnapshot(businessId) {
  const connection = (await query('SELECT ad_account_id,phone_number_id,currency,updated_at FROM whatsapp_ads_connections WHERE business_id=$1', [businessId])).rows[0];
  const operations = (await query('SELECT COUNT(*)::int AS total FROM whatsapp_ads_operations WHERE business_id=$1', [businessId])).rows[0];
  const experiments = (await query("SELECT COUNT(*)::int AS active FROM whatsapp_ad_experiments WHERE business_id=$1 AND status='active'", [businessId])).rows[0];
  return {
    connected: Boolean(connection),
    adAccountId: connection?.ad_account_id || '',
    operationsTotal: Number(operations?.total || 0),
    activeExperiments: Number(experiments?.active || 0)
  };
}

async function metaProductsSnapshot(businessId) {
  const account = (
    await query(
      `SELECT capabilities,health_status,waba_id FROM whatsapp_accounts WHERE business_id=$1 AND status='connected' ORDER BY is_default DESC LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  const phones = (
    await query(
      `SELECT COUNT(*)::int AS registered FROM whatsapp_phone_numbers WHERE business_id=$1 AND registration_state='registered'`,
      [businessId]
    )
  ).rows[0];
  const groups = (
    await query('SELECT COUNT(*)::int AS synced FROM whatsapp_groups WHERE business_id=$1', [businessId])
  ).rows[0];
  return {
    healthStatus: account?.health_status || 'unknown',
    capabilities: account?.capabilities || {},
    registeredNumbers: Number(phones?.registered || 0),
    syncedGroups: Number(groups?.synced || 0)
  };
}

async function platformSaasSnapshot(businessId) {
  const { platformA11yCertificationStatus } = await import('./a11y-certification.js');
  const a11y = await platformA11yCertificationStatus();
  const subscription = (await query('SELECT status,current_period_end FROM business_subscriptions WHERE business_id=$1', [businessId])).rows[0];
  return {
    a11y,
    subscriptionStatus: subscription?.status || 'none',
    currentPeriodEnd: subscription?.current_period_end || null
  };
}

export async function workspaceProductionHub(businessId) {
  const [
    certification,
    operations,
    featureFlags,
    aiSafety,
    flowDropOff,
    inboxSla,
    supportQueue,
    campaigns,
    commerce,
    ads,
    metaProducts,
    integrations,
    mmLite,
    platformSaas
  ] = await Promise.all([
    workspaceProductionCertification(businessId),
    workspaceOperationsReport(businessId),
    workspaceFeatureFlags(businessId),
    aiSafetyDashboard(businessId),
    flowScreenDropOffForBusiness(businessId),
    inboxSlaSnapshot(businessId),
    supportQueueSnapshot(businessId),
    campaignsGrowthSnapshot(businessId),
    commerceSnapshot(businessId),
    adsSnapshot(businessId),
    metaProductsSnapshot(businessId),
    integrationLiveStatus(businessId),
    workspaceMmLiteOptimizerReport(businessId),
    platformSaasSnapshot(businessId)
  ]);

  const productionPending = await workspaceProductionPending(businessId);
  const honestLimits = honestLimitsPayload();
  const flowRuntime = managedFlowRuntimeUrl();

  return {
    generatedAt: new Date().toISOString(),
    certification,
    featureFlags,
    sections: {
      coreCrm: {
        certificationChecks: certification.checks.filter((c) =>
          ['workspace_status', 'whatsapp_meta', 'whatsapp_number', 'worker'].includes(c.id)
        ),
        inbox: { ...inboxSla, ...supportQueue },
        contactsNote: 'Contacts and inbox use server pagination via /api/workspace/contacts and /api/workspace/inbox.'
      },
      campaignsGrowth: {
        campaigns,
        operations: operations.campaigns,
        templates: operations.templates,
        marketingMessages: mmLite
      },
      flowsAutomation: {
        flowDropOff: flowDropOff.slice(0, 12),
        managedRuntimeUrl: flowRuntime.url,
        runtimeUrlReady: flowRuntime.ok,
        automationFlows: (
          await query("SELECT COUNT(*)::int AS total FROM automation_flows WHERE business_id=$1 AND status<>'archived'", [businessId])
        ).rows[0]?.total
      },
      aiBots: {
        safety: aiSafety,
        aiUsage: operations.ai,
        autonomousEnabled: featureFlags.ai_auto_reply && featureFlags.ai_agent
      },
      adsAttribution: {
        ads,
        note: 'Lead and website objectives create paused Meta campaigns; insights require live ad account.'
      },
      commercePayments: {
        commerce,
        billingReady: certification.checks.find((c) => c.id === 'billing')?.pass
      },
      integrations: integrations,
      metaWhatsapp: {
        ...metaProducts,
        mmLite
      },
      platformSaas: {
        ...platformSaas,
        productionPending: productionPending.summary,
        productionPendingItems: productionPending.items.slice(0, 25)
      },
      productBoundaries: honestLimits
    }
  };
}
