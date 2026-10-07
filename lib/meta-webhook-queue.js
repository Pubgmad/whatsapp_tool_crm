import crypto from 'node:crypto';
import { AppError, errorJson, json, query, transaction } from './db.js';

const maxAttempts = 8;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function enqueueMetaWebhookChanges(body, resolveBusiness) {
  if (body?.object !== 'whatsapp_business_account' || !Array.isArray(body.entry) || body.entry.length > 1000) {
    throw new AppError('Invalid WhatsApp webhook payload.', 400, 'META_WEBHOOK_INVALID');
  }
  const queued = [];
  for (const entry of body.entry) {
    if (!entry || typeof entry.id !== 'string' || !Array.isArray(entry.changes) || entry.changes.length > 1000) {
      throw new AppError('Invalid WhatsApp webhook entry.', 400, 'META_WEBHOOK_INVALID');
    }
    for (const change of entry.changes) {
      if (typeof change?.field !== 'string' || !change.field || !change.value || typeof change.value !== 'object' || Array.isArray(change.value)) {
        throw new AppError('Invalid WhatsApp webhook change.', 400, 'META_WEBHOOK_INVALID');
      }
      const business = await resolveBusiness(change.value.metadata?.phone_number_id, entry.id);
      if (!business) continue;
      const event = { businessId: business.id, wabaId: entry.id, field: change.field, value: change.value };
      queued.push({ ...event, id: `mw_${digest(event)}` });
    }
  }
  await transaction(async client => {
    for (const event of queued) {
      await client.query(
        `INSERT INTO meta_webhook_queue (id,business_id,waba_id,field,payload)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [event.id, event.businessId, event.wabaId, event.field, JSON.stringify(event.value)]
      );
    }
  });
  return queued.length;
}

export async function runMetaWebhookQueue({ limit = 25, businessId = '', processChange } = {}) {
  const processEvent = processChange || (await import('./actions.js')).processMetaWebhookChange;
  const batchSize = Math.min(100, Math.max(1, Number(limit) || 25));
  const summary = { claimed: 0, completed: 0, retried: 0, failed: 0 };
  for (let index = 0; index < batchSize; index++) {
    const event = await transaction(async client => {
      await client.query(
        `UPDATE meta_webhook_queue SET status='queued',run_at=NOW(),locked_at=NULL,lock_token=NULL,error_code='WORKER_INTERRUPTED'
         WHERE status='processing' AND locked_at<NOW()-INTERVAL '5 minutes'`
      );
      const selected = (await client.query(
        `SELECT id,business_id,waba_id,field,payload,attempts FROM meta_webhook_queue
         WHERE status='queued' AND run_at<=NOW() AND ($1='' OR business_id=$1)
         ORDER BY run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`, [businessId]
      )).rows[0];
      if (!selected) return null;
      const lockToken = crypto.randomUUID();
      await client.query(
        `UPDATE meta_webhook_queue SET status='processing',attempts=attempts+1,locked_at=NOW(),lock_token=$2 WHERE id=$1`,
        [selected.id, lockToken]
      );
      return { ...selected, lockToken };
    });
    if (!event) break;
    summary.claimed++;
    try {
      await processEvent(event.business_id, event.waba_id, event.field, event.payload);
      const completed = await query(
        `UPDATE meta_webhook_queue SET status='completed',processed_at=NOW(),locked_at=NULL,lock_token=NULL,error_code=''
         WHERE id=$1 AND status='processing' AND lock_token=$2`, [event.id, event.lockToken]
      );
      if (completed.rowCount) summary.completed++;
    } catch (error) {
      const attempts = Number(event.attempts) + 1;
      const failed = attempts >= maxAttempts;
      const updated = await query(
        `UPDATE meta_webhook_queue SET status=$1,run_at=NOW()+($2::integer*INTERVAL '1 second'),
         locked_at=NULL,lock_token=NULL,error_code=$3 WHERE id=$4 AND status='processing' AND lock_token=$5`,
        [failed ? 'failed' : 'queued', Math.min(3600, 15 * 2 ** attempts), String(error?.code || 'META_WEBHOOK_PROCESSING_FAILED').slice(0, 120), event.id, event.lockToken]
      );
      if (updated.rowCount) summary[failed ? 'failed' : 'retried']++;
      console.error('Meta webhook processing failed', { eventId: event.id, code: error?.code || 'META_WEBHOOK_PROCESSING_FAILED', attempts });
    }
  }
  return summary;
}

export async function manageMetaWebhookQueue(request) {
  try {
    const { requireSuperAdmin } = await import('./super-admin.js');
    const admin = await requireSuperAdmin(request);
    if (request.method === 'GET') {
      const [counts, failures] = await Promise.all([
        query('SELECT status,COUNT(*)::integer AS count FROM meta_webhook_queue GROUP BY status'),
        query(`SELECT q.id,q.business_id,b.name AS company_name,q.field,q.attempts,q.error_code,q.received_at
               FROM meta_webhook_queue q JOIN businesses b ON b.id=q.business_id
               WHERE q.status='failed' ORDER BY q.received_at DESC,q.id LIMIT 50`)
      ]);
      return json({ counts: Object.fromEntries(counts.rows.map(row => [row.status, row.count])), failures: failures.rows });
    }
    const { readJsonBodyLimited } = await import('./security.js');
    const body = await readJsonBodyLimited(request, 2048);
    if (!/^mw_[a-f0-9]{64}$/.test(String(body.id || ''))) throw new AppError('Select a failed webhook event.', 400, 'META_WEBHOOK_ID_INVALID');
    const replayed = await query(
      `UPDATE meta_webhook_queue SET status='queued',attempts=0,run_at=NOW(),locked_at=NULL,error_code=''
       WHERE id=$1 AND status='failed' RETURNING id`, [body.id]
    );
    if (!replayed.rowCount) throw new AppError('Failed event not found.', 404, 'META_WEBHOOK_NOT_FOUND');
    await query(
      `INSERT INTO platform_audit_logs (id,super_admin_id,action,metadata)
       VALUES ($1,$2,'meta_webhook_replayed',$3)`,
      [`pa_${crypto.randomBytes(8).toString('hex')}`, admin.id, JSON.stringify({ eventId: body.id })]
    );
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
