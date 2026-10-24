import { id, query, enterSystemContext } from './db.js';
import { decryptSecret } from './meta.js';
import { metaGraphApiVersion } from './operational-policy.js';
import { readTextBodyLimited } from './security.js';

async function graphUnsubscribe(wabaId, token) {
  const response = await fetch(
    `https://graph.facebook.com/${metaGraphApiVersion()}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000)
    }
  );
  if (!response.ok && response.status !== 404) {
    let payload = {};
    try {
      payload = JSON.parse(await readTextBodyLimited(response, 200_000));
    } catch {
      payload = {};
    }
    const error = new Error(payload.error?.message || 'Remote unsubscribe failed');
    error.status = response.status;
    throw error;
  }
}

export async function enqueueMetaRemoteCleanup({
  businessId,
  wabaId,
  accessTokenEncrypted,
  authorizationSeq = 0,
  integration = 'whatsapp'
}) {
  if (!businessId || !wabaId || !accessTokenEncrypted) return null;
  const jobId = id('mrc');
  await query(
    `INSERT INTO meta_remote_cleanup_jobs
      (id, business_id, integration, waba_id, access_token_encrypted, authorization_seq_at_disconnect, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW()+INTERVAL '7 days')`,
    [jobId, businessId, integration, wabaId, accessTokenEncrypted, Number(authorizationSeq) || 0]
  );
  return jobId;
}

export async function runMetaRemoteCleanupJobs({ limit = 5 } = {}) {
  enterSystemContext();
  const due = (
    await query(
      `SELECT id, business_id, waba_id, access_token_encrypted, authorization_seq_at_disconnect, attempts
         FROM meta_remote_cleanup_jobs
        WHERE status IN ('pending', 'retryable_failure')
          AND expires_at > NOW()
          AND updated_at < NOW() - INTERVAL '30 seconds'
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [Math.max(1, Math.min(20, Number(limit) || 5))]
    )
  ).rows;
  let completed = 0;
  let failed = 0;
  for (const job of due) {
    try {
      const current = (
        await query(
          `SELECT authorization_seq FROM meta_authorizations
            WHERE business_id=$1 AND integration='whatsapp' AND status='active' AND is_current=TRUE
            LIMIT 1`,
          [job.business_id]
        )
      ).rows[0];
      if (current && Number(current.authorization_seq || 0) > Number(job.authorization_seq_at_disconnect || 0)) {
        await query(
          `UPDATE meta_remote_cleanup_jobs SET status='cannot_complete', last_error='superseded_by_reconnect', completed_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [job.id]
        );
        continue;
      }
      const token = decryptSecret(job.access_token_encrypted);
      await graphUnsubscribe(job.waba_id, token);
      await query(
        `UPDATE meta_remote_cleanup_jobs SET status='completed', completed_at=NOW(), last_error='', updated_at=NOW() WHERE id=$1`,
        [job.id]
      );
      completed += 1;
    } catch (error) {
      const attempts = Number(job.attempts || 0) + 1;
      const terminal = attempts >= 5 || Number(error?.status || 0) === 401 || Number(error?.status || 0) === 403;
      await query(
        `UPDATE meta_remote_cleanup_jobs
            SET status=$2, attempts=$3, last_error=$4, updated_at=NOW(),
                completed_at=CASE WHEN $2='cannot_complete' THEN NOW() ELSE completed_at END
          WHERE id=$1`,
        [
          job.id,
          terminal ? 'cannot_complete' : 'retryable_failure',
          attempts,
          String(error?.message || 'cleanup failed').slice(0, 200)
        ]
      );
      failed += 1;
    }
  }
  return { processed: due.length, completed, failed };
}
