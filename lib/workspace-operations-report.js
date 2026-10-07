import { CAMPAIGN_RETRY_POLICY, classifyCampaignRecipientError } from './campaign-retry-policy.js';
import { campaignQueueMetrics } from './campaign-operations.js';
import { campaignSendEventMetrics } from './campaign-send-events.js';
import { inboxSlaSnapshot } from './inbox-sla-snapshot.js';
import { workspaceMmLiteOptimizerReport } from './mm-lite-optimizer.js';
import { buildTemplateFormatMatrix } from './template-format-matrix.js';
import { defaultIntegrationCatalog } from './integration-catalog-data.js';
import { getPlatformSettingValue } from './platform.js';
import { query } from './db.js';

export async function workspaceOperationsReport(businessId) {
  const [queue, sendEvents, sla, templates, account, failedSamples, aiUsage, integrationCatalog, mmLite] = await Promise.all([
    campaignQueueMetrics(),
    campaignSendEventMetrics(businessId),
    inboxSlaSnapshot(businessId),
    query(
      `SELECT id,status,category,meta_template_name,name,component_schema,waba_id
       FROM templates WHERE business_id=$1 ORDER BY updated_at DESC LIMIT 500`,
      [businessId]
    ).then((result) => result.rows),
    query(
      `SELECT capabilities FROM whatsapp_accounts WHERE business_id=$1 AND status='connected' ORDER BY is_default DESC,created_at LIMIT 1`,
      [businessId]
    ).then((result) => result.rows[0] || null),
    query(
      `SELECT cr.error_message FROM campaign_recipients cr
       JOIN campaigns c ON c.id=cr.campaign_id
       WHERE c.business_id=$1 AND cr.status='failed'
       ORDER BY cr.updated_at DESC LIMIT 15`,
      [businessId]
    ).then((result) => result.rows),
    query(
      `SELECT usage_date,requests FROM ai_agent_daily_usage WHERE business_id=$1 AND usage_date>=((NOW() AT TIME ZONE 'UTC')::date - INTERVAL '30 days') ORDER BY usage_date`,
      [businessId]
    ).then((result) => result.rows),
    getPlatformSettingValue('integration_catalog', defaultIntegrationCatalog()),
    workspaceMmLiteOptimizerReport(businessId)
  ]);

  const lagSeconds = Number(await getPlatformSettingValue('campaign_queue_max_lag_seconds', null));
  const queueSlo = {
    maxLagSeconds: Number.isFinite(lagSeconds) && lagSeconds >= 60 ? lagSeconds : Number(queue.maxLagSeconds || 600),
    lagOk: queue.lagOk
  };

  return {
    generatedAt: new Date().toISOString(),
    campaigns: {
      queue: { ...queue, slo: queueSlo },
      sendEvents,
      retryPolicy: CAMPAIGN_RETRY_POLICY,
      failedRecipientSamples: failedSamples.map((row) => ({
        message: row.error_message,
        ...classifyCampaignRecipientError(row.error_message)
      }))
    },
    marketingMessages: mmLite,
    templates: buildTemplateFormatMatrix(templates),
    inbox: sla,
    ai: {
      dailyUsage: aiUsage.map((row) => ({ date: row.usage_date, requests: Number(row.requests || 0) })),
      totalRequests30d: aiUsage.reduce((sum, row) => sum + Number(row.requests || 0), 0)
    },
    integrations: {
      catalog: Array.isArray(integrationCatalog) ? integrationCatalog : defaultIntegrationCatalog()
    }
  };
}
