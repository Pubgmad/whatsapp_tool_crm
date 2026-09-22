import { AppError, id, query } from './db';
import { requireSession } from './auth';

async function settings() {
  const keys = ['security_event_retention_days', 'webhook_event_retention_days', 'completed_job_retention_days', 'message_retention_days', 'workspace_deletion_grace_days'];
  const result = await query('SELECT key,value FROM platform_settings WHERE key=ANY($1)', [keys]);
  return Object.fromEntries(result.rows.map((row) => [row.key, Math.max(0, Number(row.value) || 0)]));
}

export async function runRetentionJobs() {
  const values = await settings();
  const count = async (sql, days) => days ? Number((await query(sql, [String(days)])).rows[0]?.total || 0) : 0;
  const summary = {
    eventsDue: await count('SELECT COUNT(*)::int total FROM events WHERE at<NOW()-($1 || \' days\')::interval', values.webhook_event_retention_days),
    auditLogsDue: await count('SELECT COUNT(*)::int total FROM audit_logs WHERE at<NOW()-($1 || \' days\')::interval', values.security_event_retention_days),
    completedJobsDue: await count('SELECT COUNT(*)::int total FROM campaign_jobs WHERE status IN (\'completed\',\'failed\') AND updated_at<NOW()-($1 || \' days\')::interval', values.completed_job_retention_days),
    messagesDue: await count('SELECT COUNT(*)::int total FROM messages WHERE at<NOW()-($1 || \' days\')::interval', values.message_retention_days)
  };
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
