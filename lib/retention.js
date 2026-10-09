import { AppError, id, query } from './db';
import { requireSession } from './auth';
import { readJsonBodyLimited } from './security';
import { operationalPolicy } from './operational-policy.js';

async function settings() {
  const keys = ['security_event_retention_days', 'webhook_event_retention_days', 'completed_job_retention_days', 'message_retention_days', 'message_usage_retention_days', 'workspace_deletion_grace_days'];
  const result = await query('SELECT key,value FROM platform_settings WHERE key=ANY($1)', [keys]);
  return Object.fromEntries(result.rows.map((row) => [row.key, Math.floor(Math.max(0, Number(row.value) || 0))]));
}

export async function runRetentionJobs() {
  const values = await settings();
  const policy = operationalPolicy();
  const batchSize = policy.retentionBatchSize;
  const remove = async (table, dateColumn, days, condition = 'TRUE') => {
    if (!days) return 0;
    const result = await query(
      `WITH due AS (
         SELECT id FROM ${table}
         WHERE ${condition} AND ${dateColumn} < NOW() - ($1::integer * INTERVAL '1 day')
         ORDER BY ${dateColumn} ASC LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} target USING due WHERE target.id = due.id`,
      [days, batchSize]
    );
    return result.rowCount;
  };
  const summary = {
    eventsDeleted: await remove('events', 'at', values.webhook_event_retention_days),
    auditLogsDeleted: await remove('audit_logs', 'at', values.security_event_retention_days),
    campaignJobsDeleted: await remove('campaign_jobs', 'updated_at', values.completed_job_retention_days, "status IN ('completed','failed')"),
    automationJobsDeleted: await remove('automation_jobs', 'updated_at', values.completed_job_retention_days, "status IN ('completed','failed')"),
    messagesDeleted: await remove('messages', 'at', values.message_retention_days),
    metaWebhooksDeleted: await remove('meta_webhook_queue', 'received_at', values.webhook_event_retention_days, "status='completed'"),
    usageRecordsDeleted: await remove('message_usage_events', 'sent_at', values.message_usage_retention_days ? Math.max(35, values.message_usage_retention_days) : 0)
  };
  summary.conversionPayloadsCleared = values.webhook_event_retention_days ? (await query(
    "UPDATE whatsapp_conversion_events SET payload='{}'::jsonb WHERE id IN (SELECT id FROM whatsapp_conversion_events WHERE payload <> '{}'::jsonb AND status <> 'processing' AND created_at < NOW()-($1::integer * INTERVAL '1 day') ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)",
    [values.webhook_event_retention_days,batchSize]
  )).rowCount : 0;
  summary.callSessionsCleared=(await query("UPDATE whatsapp_calls SET remote_session='{}'::jsonb WHERE id IN (SELECT id FROM whatsapp_calls WHERE remote_session<>'{}'::jsonb AND (ended_at IS NOT NULL OR updated_at<NOW()-INTERVAL '1 hour') LIMIT $1 FOR UPDATE SKIP LOCKED)",[batchSize])).rowCount;
  summary.callWebhookBuffersDeleted=(await query("DELETE FROM whatsapp_call_webhook_buffer WHERE id IN (SELECT id FROM whatsapp_call_webhook_buffer WHERE created_at<NOW()-INTERVAL '1 hour' LIMIT $1 FOR UPDATE SKIP LOCKED)",[batchSize])).rowCount;
  summary.callHistoryDeleted=await remove('whatsapp_calls','created_at',values.message_retention_days,"status IN ('terminated','rejected','failed')");
  summary.integrationDeliveriesDeleted=await remove('workspace_webhook_deliveries','run_at',values.webhook_event_retention_days,"status IN ('delivered','failed')");
  summary.flowInvitesDeleted=await remove('whatsapp_flow_invites','created_at',values.message_retention_days,"expires_at<NOW() AND status<>'processing'");
  summary.entryAttributionsDeleted=await remove('whatsapp_entry_attributions','created_at',values.webhook_event_retention_days);
  summary.trackedTokensDeleted=(await query("DELETE FROM tracked_link_tokens WHERE id IN (SELECT id FROM tracked_link_tokens WHERE expires_at<NOW() AND (confirmed_at IS NULL OR confirmed_at<NOW()-($1::integer*INTERVAL '1 day')) ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED)",[policy.trackedLinkRetentionDays,batchSize])).rowCount;
  summary.connectorEventsDeleted=await remove('provider_connector_events','received_at',values.webhook_event_retention_days,"status IN ('processed','skipped')");
  summary.availabilityOAuthStatesDeleted=(await query("DELETE FROM availability_oauth_states WHERE state_hash IN (SELECT state_hash FROM availability_oauth_states WHERE expires_at<NOW() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)",[batchSize])).rowCount;
  summary.crmOAuthStatesDeleted=(await query("DELETE FROM crm_oauth_states WHERE state_hash IN (SELECT state_hash FROM crm_oauth_states WHERE expires_at<NOW() ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)",[batchSize])).rowCount;
  summary.connectorRecordsDeleted=values.webhook_event_retention_days ? (await query(
    `DELETE FROM provider_connector_records target USING (
      SELECT connector_id,resource,external_id FROM provider_connector_records
      WHERE occurred_at<NOW()-($1::integer*INTERVAL '1 day')
      ORDER BY occurred_at LIMIT $2 FOR UPDATE SKIP LOCKED
    ) due WHERE target.connector_id=due.connector_id AND target.resource=due.resource AND target.external_id=due.external_id`,
    [values.webhook_event_retention_days,batchSize]
  )).rowCount : 0;
  summary.expiredRateLimitsDeleted = (await query(
    'DELETE FROM rate_limits WHERE id IN (SELECT id FROM rate_limits WHERE reset_at < NOW() - INTERVAL \'1 day\' LIMIT $1)',
    [batchSize]
  )).rowCount;
  summary.workspaceApprovalsDue = (await query('UPDATE workspace_deletion_requests SET status=\'pending_approval\' WHERE status=\'scheduled\' AND execute_after<=NOW() RETURNING id')).rowCount;
  await query('INSERT INTO retention_job_runs (id,summary) VALUES ($1,$2)', [id('rjr'), JSON.stringify(summary)]);
  return summary;
}

export async function manageWorkspaceDeletion(request) {
  const session = await requireSession(request);
  if (session.role !== 'Owner') throw new AppError('Only the workspace owner can manage deletion.', 403, 'OWNER_REQUIRED');
  if (request.method === 'DELETE') {
    await query('UPDATE workspace_deletion_requests SET status=\'cancelled\' WHERE business_id=$1 AND status IN (\'scheduled\',\'pending_approval\')', [session.businessId]);
    return { ok: true, scheduled: false };
  }
  const body = await readJsonBodyLimited(request, 16384);
  if (String(body.confirmation || '').trim() !== 'DELETE') throw new AppError('Type DELETE to schedule workspace deletion.', 400, 'CONFIRMATION_REQUIRED');
  const days = (await settings()).workspace_deletion_grace_days ?? 30;
  const row = (await query(`INSERT INTO workspace_deletion_requests (id,business_id,requested_by,status,execute_after)
    VALUES ($1,$2,$3,CASE WHEN $4::integer=0 THEN 'pending_approval' ELSE 'scheduled' END,NOW()+($4 || ' days')::interval)
    ON CONFLICT (business_id) DO UPDATE SET requested_by=EXCLUDED.requested_by,status=EXCLUDED.status,
      execute_after=EXCLUDED.execute_after,requested_at=NOW(),completed_at=NULL
    RETURNING execute_after`, [id('wdr'), session.businessId, session.userId, String(days)])).rows[0];
  return { ok: true, scheduled: true, executeAfter: row.execute_after };
}
