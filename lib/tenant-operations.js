import { enterSystemContext, query } from './db.js';

const OPT_OUT_PATTERN = /(opt.?out|unsubscrib|consent|permission|blocked)/i;

export async function getTenantOperationsSnapshot(businessId) {
  enterSystemContext();
  const id = String(businessId || '');
  const [
    metaWebhooks,
    campaignJobs,
    automationJobs,
    aiReplies,
    subscription,
    connectors,
    calendarIssues
  ] = await Promise.all([
    query(
      `SELECT COUNT(*) FILTER (WHERE status='failed')::int AS failed,
              COUNT(*) FILTER (WHERE status='queued')::int AS queued
       FROM meta_webhook_queue WHERE business_id=$1`,
      [id]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE j.status IN ('failed','retry'))::int AS backlog,
              COUNT(*) FILTER (WHERE j.status='failed')::int AS failed
       FROM campaign_jobs j
       JOIN campaign_recipients cr ON cr.id=j.campaign_recipient_id
       JOIN campaigns c ON c.id=cr.campaign_id
       WHERE c.business_id=$1`,
      [id]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE j.status IN ('queued','retry'))::int AS pending
       FROM automation_jobs j WHERE j.business_id=$1`,
      [id]
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('queued','processing'))::int AS pending,
              COUNT(*) FILTER (WHERE status='unknown')::int AS needs_review
       FROM ai_auto_reply_jobs WHERE business_id=$1`,
      [id]
    ),
    query(
      `SELECT provider,status,payment_status,current_period_end FROM business_subscriptions WHERE business_id=$1`,
      [id]
    ),
    query(
      `SELECT provider,enabled,expires_at,last_error,last_sync_at,updated_at FROM crm_connections WHERE business_id=$1`,
      [id]
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM availability_fulfillments
       WHERE business_id=$1 AND status IN ('failed','needs_reconnect','pending','processing')`,
      [id]
    ).catch(() => ({ rows: [{ total: 0 }] }))
  ]);

  const failedRecipientRows = (await query(
    `SELECT cr.error_message FROM campaign_recipients cr
     JOIN campaigns c ON c.id=cr.campaign_id
     WHERE c.business_id=$1 AND cr.status='failed'`,
    [id]
  )).rows;
  const failedRecipients = failedRecipientRows.filter(
    (row) => !OPT_OUT_PATTERN.test(String(row.error_message || ''))
  ).length;

  const sub = subscription.rows[0];
  return {
    metaWebhooks: {
      failed: Number(metaWebhooks.rows[0]?.failed || 0),
      queued: Number(metaWebhooks.rows[0]?.queued || 0)
    },
    campaigns: {
      jobBacklog: Number(campaignJobs.rows[0]?.backlog || 0),
      failedJobs: Number(campaignJobs.rows[0]?.failed || 0),
      retryableFailedRecipients: Number(failedRecipients)
    },
    automation: { pendingJobs: Number(automationJobs.rows[0]?.pending || 0) },
    aiAutoReply: {
      pending: Number(aiReplies.rows[0]?.pending || 0),
      needsReview: Number(aiReplies.rows[0]?.needs_review || 0)
    },
    billing: sub ? {
      provider: sub.provider || 'none',
      status: sub.status,
      paymentStatus: sub.payment_status,
      periodEnd: sub.current_period_end
    } : { provider: 'none', status: 'none', paymentStatus: 'none', periodEnd: null },
    crmConnections: connectors.rows.map((row) => ({
      provider: row.provider,
      enabled: Boolean(row.enabled),
      expiresAt: row.expires_at,
      lastError: row.last_error || '',
      lastSyncAt: row.last_sync_at,
      updatedAt: row.updated_at
    })),
    calendarFulfillment: { openItems: Number(calendarIssues.rows[0]?.total || 0) },
    generatedAt: new Date().toISOString()
  };
}
