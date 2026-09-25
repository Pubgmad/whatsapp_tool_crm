import { AppError, id, query } from './db';
import { requireSession } from './auth';

async function settings() {
  const keys = ['security_event_retention_days', 'webhook_event_retention_days', 'completed_job_retention_days', 'message_retention_days', 'message_usage_retention_days', 'workspace_deletion_grace_days'];
  const result = await query('SELECT key,value FROM platform_settings WHERE key=ANY($1)', [keys]);
  return Object.fromEntries(result.rows.map((row) => [row.key, Math.floor(Math.max(0, Number(row.value) || 0))]));
}

export async function runRetentionJobs() {
  const values = await settings();
  const batchSize = Math.max(1, Math.min(Number(process.env.RETENTION_BATCH_SIZE) || 500, 5000));
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
    usageRecordsDeleted: await remove('message_usage_events', 'sent_at', values.message_usage_retention_days ? Math.max(35, values.message_usage_retention_days) : 0)
  };
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
  const body = await request.json();
  if (String(body.confirmation || '').trim() !== 'DELETE') throw new AppError('Type DELETE to schedule workspace deletion.', 400, 'CONFIRMATION_REQUIRED');
  const days = (await settings()).workspace_deletion_grace_days || 30;
  const row = (await query('INSERT INTO workspace_deletion_requests (id,business_id,requested_by,execute_after) VALUES ($1,$2,$3,NOW()+($4 || \' days\')::interval) ON CONFLICT (business_id) DO UPDATE SET requested_by=EXCLUDED.requested_by,status=\'scheduled\',execute_after=EXCLUDED.execute_after,requested_at=NOW(),completed_at=NULL RETURNING execute_after', [id('wdr'), session.businessId, session.userId, String(days)])).rows[0];
  return { ok: true, scheduled: true, executeAfter: row.execute_after };
}
