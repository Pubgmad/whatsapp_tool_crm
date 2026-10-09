import { currentAccount } from './auth.js';
import { AppError, errorJson, id, json, query, transaction } from './db.js';
import { audienceContactQuery } from './audience-rules.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { readOptionalJsonBodyLimited } from './security.js';

const JOB_SELECT = `SELECT id,segment_id,operation,tags,status,total_contacts,processed_contacts,attempts,max_attempts,error_message,created_at,started_at,completed_at
  FROM audience_tag_jobs WHERE id=$1 AND business_id=$2`;

function normalizeTags(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) {
    throw new AppError('Choose between 1 and 20 tags.', 400, 'BULK_TAGS_INVALID');
  }
  const tags = [...new Set(value.map(tag => {
    if (typeof tag !== 'string') throw new AppError('Tags must be text.', 400, 'BULK_TAGS_INVALID');
    return tag.trim().toLowerCase();
  }).filter(Boolean))].sort();
  if (!tags.length || tags.some(tag => tag.length > 100)) throw new AppError('Tags are invalid.', 400, 'BULK_TAGS_INVALID');
  return tags;
}

function idempotencyKey(request, body) {
  const value = String(request.headers.get('Idempotency-Key') || body.idempotencyKey || '').trim();
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(value)) {
    throw new AppError('Provide a valid Idempotency-Key.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  return value;
}

function shiftParameters(text, amount) {
  return text.replace(/\$(\d+)/g, (_, number) => '$' + (Number(number) + amount));
}

function mapJob(row) {
  return {
    id: row.id,
    segmentId: row.segment_id,
    operation: row.operation,
    tags: row.tags,
    status: row.status,
    totalContacts: Number(row.total_contacts),
    processedContacts: Number(row.processed_contacts),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error_message || '',
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function bulkTagUpdateStatement(businessId, jobId, operation, tags) {
  const expression = operation === 'add'
    ? `COALESCE((SELECT jsonb_agg(DISTINCT value) FROM (
         SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(ct.tags)='array' THEN ct.tags ELSE '[]'::jsonb END) AS value
         UNION ALL SELECT unnest($3::text[]) AS value
       ) merged), '[]'::jsonb)`
    : `COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(ct.tags)='array' THEN ct.tags ELSE '[]'::jsonb END
       ) AS existing(value) WHERE value <> ALL($3::text[])), '[]'::jsonb)`;
  return {
    text: `UPDATE contacts ct SET tags=${expression},updated_at=NOW()
      WHERE ct.business_id=$1
        AND EXISTS (SELECT 1 FROM audience_tag_job_contacts snap
          WHERE snap.job_id=$2 AND snap.business_id=$1 AND snap.contact_id=ct.id)`,
    params: [businessId, jobId, tags]
  };
}

export async function processAudienceTagJob(businessId, userId, jobId) {
  try {
    return await transaction(async client => {
      const row = (await client.query(`${JOB_SELECT} FOR UPDATE`, [jobId, businessId])).rows[0];
      if (!row) throw new AppError('Bulk tag job not found.', 404, 'BULK_TAG_JOB_NOT_FOUND');
      if (row.status === 'completed') return mapJob(row);
      if (row.attempts >= row.max_attempts) throw new AppError('Bulk tag job exhausted its retries.', 409, 'BULK_TAG_RETRIES_EXHAUSTED');
      await client.query(`UPDATE audience_tag_jobs SET status='running',attempts=attempts+1,started_at=COALESCE(started_at,NOW()),error_message='',updated_at=NOW() WHERE id=$1 AND business_id=$2`, [jobId, businessId]);
      const statement = bulkTagUpdateStatement(businessId, jobId, row.operation, row.tags);
      const updated = await client.query(statement.text, statement.params);
      const completed = (await client.query(
        `UPDATE audience_tag_jobs SET status='completed',processed_contacts=$1,completed_at=NOW(),updated_at=NOW()
         WHERE id=$2 AND business_id=$3 RETURNING *`,
        [updated.rowCount, jobId, businessId]
      )).rows[0];
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
        id('a'), businessId, userId, 'audience_bulk_tags_completed',
        JSON.stringify({ jobId, segmentId: row.segment_id, operation: row.operation, tags: row.tags, contactCount: updated.rowCount })
      ]);
      return mapJob(completed);
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    await query(
      `UPDATE audience_tag_jobs SET status='failed',attempts=attempts+1,error_message=$1,updated_at=NOW()
       WHERE id=$2 AND business_id=$3 AND status<>'completed'`,
      [String(error?.message || 'Bulk tag update failed.').slice(0, 2000), jobId, businessId]
    ).catch(() => {});
    throw error;
  }
}

export async function createAudienceTagJob(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 16384);
    const operation = String(body.operation || '');
    if (!['add', 'remove'].includes(operation)) throw new AppError('Choose add or remove.', 400, 'BULK_TAG_OPERATION_INVALID');
    const tags = normalizeTags(body.tags);
    const key = idempotencyKey(request, body);
    const jobId = id('atj');
    const created = await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${account.business.id}:${key}`]);
      const existing = (await client.query(
        'SELECT * FROM audience_tag_jobs WHERE business_id=$1 AND idempotency_key=$2 FOR UPDATE',
        [account.business.id, key]
      )).rows[0];
      if (existing) {
        if (existing.segment_id !== params.id || existing.operation !== operation || JSON.stringify(existing.tags) !== JSON.stringify(tags)) {
          throw new AppError('Idempotency-Key was already used for a different request.', 409, 'IDEMPOTENCY_KEY_REUSED');
        }
        return { job: mapJob(existing), existing: true };
      }
      const segment = (await client.query(
        'SELECT rules FROM audience_segments WHERE id=$1 AND business_id=$2 AND is_active=TRUE FOR SHARE',
        [params.id, account.business.id]
      )).rows[0];
      if (!segment) throw new AppError('Active audience segment not found.', 404, 'SEGMENT_NOT_FOUND');
      await client.query(
        `INSERT INTO audience_tag_jobs(id,business_id,segment_id,user_id,idempotency_key,operation,tags,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,'queued')`,
        [jobId, account.business.id, params.id, account.user.id, key, operation, tags]
      );
      const audience = audienceContactQuery(account.business.id, segment.rules);
      await client.query(
        `INSERT INTO audience_tag_job_contacts(job_id,business_id,contact_id)
         SELECT $1,$2,frozen.id FROM (${shiftParameters(audience.text, 2)}) frozen`,
        [jobId, account.business.id, ...audience.params]
      );
      const job = (await client.query(
        `UPDATE audience_tag_jobs SET total_contacts=(
           SELECT COUNT(*) FROM audience_tag_job_contacts WHERE job_id=$1 AND business_id=$2
         ),updated_at=NOW() WHERE id=$1 AND business_id=$2 RETURNING *`,
        [jobId, account.business.id]
      )).rows[0];
      await client.query('INSERT INTO audit_logs(id,business_id,user_id,action,metadata) VALUES($1,$2,$3,$4,$5)', [
        id('a'), account.business.id, account.user.id, 'audience_bulk_tags_created',
        JSON.stringify({ jobId, segmentId: params.id, operation, tags, contactCount: Number(job.total_contacts) })
      ]);
      return { job: mapJob(job), existing: false };
    });
    if (created.existing && !['queued', 'failed'].includes(created.job.status)) return json({ job: created.job }, 200);
    // Small segments process inline; larger ones stay queued for the worker to avoid request timeouts.
    if (Number(created.job.totalContacts) <= 250) {
      const job = await processAudienceTagJob(account.business.id, account.user.id, created.job.id);
      return json({ job }, created.existing ? 200 : 201);
    }
    return json({ job: created.job, queued: true }, created.existing ? 200 : 202);
  } catch (error) {
    return errorJson(error);
  }
}

export async function runDueAudienceTagJobs({ limit } = {}) {
  const { operationalPolicy } = await import('./operational-policy.js');
  const batch = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : operationalPolicy().audienceTagJobBatchSize;
  let processed = 0;
  for (let i = 0; i < batch; i += 1) {
    const due = (await query(
      `SELECT id, business_id, user_id FROM audience_tag_jobs
       WHERE status IN ('queued','failed') AND attempts < max_attempts
       ORDER BY created_at ASC, id ASC LIMIT 1`
    )).rows[0];
    if (!due) break;
    const claimed = (await query(
      `UPDATE audience_tag_jobs SET status='queued', updated_at=NOW()
       WHERE id=$1 AND business_id=$2 AND status IN ('queued','failed') AND attempts < max_attempts
       RETURNING id, business_id, user_id`,
      [due.id, due.business_id]
    )).rows[0];
    if (!claimed) continue;
    try {
      await processAudienceTagJob(claimed.business_id, claimed.user_id, claimed.id);
      processed += 1;
    } catch {
      // Failures are recorded on the job row inside processAudienceTagJob.
    }
  }
  return { attempted: processed };
}

export async function getAudienceTagJob(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const row = (await query(JOB_SELECT, [params.id, account.business.id])).rows[0];
    if (!row) throw new AppError('Bulk tag job not found.', 404, 'BULK_TAG_JOB_NOT_FOUND');
    return json({ job: mapJob(row) });
  } catch (error) {
    return errorJson(error);
  }
}

export async function retryAudienceTagJob(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    return json({ job: await processAudienceTagJob(account.business.id, account.user.id, params.id) });
  } catch (error) {
    return errorJson(error);
  }
}
