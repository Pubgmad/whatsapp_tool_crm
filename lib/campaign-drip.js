/* global process */
import { AppError, id, query, transaction, errorJson, json, toIso } from './db.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { requireSession } from './auth.js';
import { readJsonBodyLimited } from './security.js';
import { audienceContactQuery } from './audience-rules.js';

export const CAMPAIGN_DRIP_LIMITS = Object.freeze({
  nameLength: 120,
  maxSteps: 50,
  maxOffsetMinutes: 525600,
  requestBytes: 500_000
});

const clean = (value) => String(value || '').trim();
const enrollmentLimit = () => Math.max(1, Math.min(Number(process.env.CAMPAIGN_DRIP_ENROLLMENT_LIMIT) || 5000, 25000));

export function validateCampaignDripTimezone(value) {
  const timezone = clean(value) || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone;
  } catch {
    throw new AppError('Choose a valid IANA time zone.', 400, 'DRIP_TIMEZONE_INVALID');
  }
}

export function normalizeCampaignDripDefinition(body) {
  const name = clean(body?.name);
  if (!name || name.length > CAMPAIGN_DRIP_LIMITS.nameLength) {
    throw new AppError(`Enter a sequence name of up to ${CAMPAIGN_DRIP_LIMITS.nameLength} characters.`, 400, 'DRIP_NAME_INVALID');
  }
  if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > CAMPAIGN_DRIP_LIMITS.maxSteps) {
    throw new AppError(`Add between 1 and ${CAMPAIGN_DRIP_LIMITS.maxSteps} steps.`, 400, 'DRIP_STEPS_INVALID');
  }
  const steps = body.steps.map((raw, stepOrder) => {
    const templateId = clean(raw?.templateId);
    const offsetMinutes = Number(raw?.offsetMinutes);
    const variables = raw?.variables ?? {};
    if (!templateId || !Number.isSafeInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > CAMPAIGN_DRIP_LIMITS.maxOffsetMinutes) {
      throw new AppError(`Step ${stepOrder + 1} needs an approved template and a valid delay.`, 400, 'DRIP_STEP_INVALID');
    }
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      throw new AppError(`Step ${stepOrder + 1} variables must be an object.`, 400, 'DRIP_VARIABLES_INVALID');
    }
    return { stepOrder, templateId, offsetMinutes, variables };
  });
  return {
    name,
    timezone: validateCampaignDripTimezone(body.timezone),
    segmentId: clean(body.segmentId) || null,
    steps
  };
}

async function validateDefinitionReferences(client, businessId, definition) {
  if (definition.segmentId) {
    const segment = await client.query(
      'SELECT 1 FROM audience_segments WHERE id=$1 AND business_id=$2 AND is_active=TRUE',
      [definition.segmentId, businessId]
    );
    if (!segment.rowCount) throw new AppError('Select an active segment from this workspace.', 400, 'DRIP_SEGMENT_INVALID');
  }
  const templateIds = [...new Set(definition.steps.map((step) => step.templateId))];
  const templates = await client.query(
    "SELECT id FROM templates WHERE business_id=$1 AND id=ANY($2::text[]) AND status='Approved'",
    [businessId, templateIds]
  );
  if (templates.rowCount !== templateIds.length) {
    throw new AppError('Every step must use an approved template from this workspace.', 400, 'DRIP_TEMPLATE_INVALID');
  }
}

async function audit(client, session, action, metadata) {
  await client.query(
    'INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)',
    [id('a'), session.businessId, session.userId, action, JSON.stringify(metadata)]
  );
}

async function saveSequence(session, body, editing) {
  const definition = normalizeCampaignDripDefinition(body);
  const sequenceId = editing ? clean(body.id) : id('drip');
  if (editing && !sequenceId) throw new AppError('Sequence id is required.', 400, 'DRIP_ID_REQUIRED');
  await transaction(async (client) => {
    await validateDefinitionReferences(client, session.businessId, definition);
    if (editing) {
      const current = (await client.query(
        'SELECT status FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2 FOR UPDATE',
        [sequenceId, session.businessId]
      )).rows[0];
      if (!current) throw new AppError('Drip sequence not found.', 404, 'DRIP_NOT_FOUND');
      if (!['draft', 'paused'].includes(current.status)) {
        throw new AppError('Pause an active sequence before editing it.', 409, 'DRIP_EDIT_FORBIDDEN');
      }
      await client.query(
        `UPDATE campaign_drip_sequences
         SET name=$1,audience_segment_id=$2,timezone=$3,updated_at=NOW()
         WHERE id=$4 AND business_id=$5`,
        [definition.name, definition.segmentId, definition.timezone, sequenceId, session.businessId]
      );
      await client.query('DELETE FROM campaign_drip_steps WHERE sequence_id=$1 AND business_id=$2', [sequenceId, session.businessId]);
    } else {
      await client.query(
        `INSERT INTO campaign_drip_sequences (id,business_id,name,status,audience_segment_id,timezone,created_by)
         VALUES ($1,$2,$3,'draft',$4,$5,$6)`,
        [sequenceId, session.businessId, definition.name, definition.segmentId, definition.timezone, session.userId]
      );
    }
    for (const step of definition.steps) {
      await client.query(
        `INSERT INTO campaign_drip_steps (id,sequence_id,business_id,step_order,offset_minutes,template_id,variables)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [id('ds'), sequenceId, session.businessId, step.stepOrder, step.offsetMinutes, step.templateId, JSON.stringify(step.variables)]
      );
    }
    await audit(client, session, editing ? 'campaign_drip_updated' : 'campaign_drip_created', {
      sequenceId, steps: definition.steps.length, segmentId: definition.segmentId, timezone: definition.timezone
    });
  });
  return sequenceId;
}

async function loadSequenceDefinition(client, businessId, sequenceId, lock = false) {
  const sequence = (await client.query(
    `SELECT * FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [sequenceId, businessId]
  )).rows[0];
  if (!sequence) throw new AppError('Drip sequence not found.', 404, 'DRIP_NOT_FOUND');
  const steps = (await client.query(
    'SELECT step_order,offset_minutes,template_id,variables FROM campaign_drip_steps WHERE sequence_id=$1 AND business_id=$2 ORDER BY step_order',
    [sequenceId, businessId]
  )).rows.map((step) => ({
    stepOrder: Number(step.step_order),
    offsetMinutes: Number(step.offset_minutes),
    templateId: step.template_id,
    variables: step.variables || {}
  }));
  return {
    sequence,
    definition: {
      name: sequence.name,
      timezone: validateCampaignDripTimezone(sequence.timezone),
      segmentId: sequence.audience_segment_id,
      steps
    }
  };
}

async function changeLifecycle(session, body) {
  const sequenceId = clean(body.id || body.sequenceId);
  if (!sequenceId) throw new AppError('Sequence id is required.', 400, 'DRIP_ID_REQUIRED');
  return transaction(async (client) => {
    const { sequence, definition } = await loadSequenceDefinition(client, session.businessId, sequenceId, true);
    const action = clean(body.action);
    const allowed = {
      activate: ['draft', 'paused'],
      pause: ['active'],
      resume: ['paused'],
      archive: ['draft', 'paused', 'active']
    };
    if (!allowed[action]?.includes(sequence.status)) {
      throw new AppError(`Cannot ${action} a ${sequence.status} sequence.`, 409, 'DRIP_STATUS_INVALID');
    }
    if (['activate', 'resume'].includes(action)) {
      if (!definition.steps.length) throw new AppError('Add at least one step before activation.', 409, 'DRIP_STEPS_INVALID');
      await validateDefinitionReferences(client, session.businessId, definition);
    }
    const status = action === 'pause' ? 'paused' : action === 'archive' ? 'archived' : 'active';
    await client.query(
      'UPDATE campaign_drip_sequences SET status=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3',
      [status, sequenceId, session.businessId]
    );
    let cancelled = 0;
    if (action === 'archive') {
      const result = await client.query(
        "UPDATE campaign_drip_enrollments SET status='cancelled',updated_at=NOW() WHERE sequence_id=$1 AND business_id=$2 AND status='active'",
        [sequenceId, session.businessId]
      );
      cancelled = result.rowCount;
    }
    await audit(client, session, `campaign_drip_${action}d`, { sequenceId, from: sequence.status, to: status, cancelled });
    return { status, cancelled };
  });
}

async function segmentContactIds(client, businessId, segmentId) {
  const segment = (await client.query(
    'SELECT rules FROM audience_segments WHERE id=$1 AND business_id=$2 AND is_active=TRUE',
    [segmentId, businessId]
  )).rows[0];
  if (!segment) throw new AppError('The enrollment segment is no longer active.', 409, 'DRIP_SEGMENT_INVALID');
  const statement = audienceContactQuery(businessId, segment.rules);
  return (await client.query(statement.text, statement.params)).rows.map((row) => row.id);
}

async function enrollSequence(session, body) {
  const sequenceId = clean(body.sequenceId || body.id);
  if (!sequenceId) throw new AppError('Sequence id is required.', 400, 'DRIP_ID_REQUIRED');
  return transaction(async (client) => {
    const sequence = (await client.query(
      "SELECT * FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2 AND status='active' FOR UPDATE",
      [sequenceId, session.businessId]
    )).rows[0];
    if (!sequence) throw new AppError('Active drip sequence not found.', 404, 'DRIP_NOT_ACTIVE');
    const firstStep = (await client.query(
      'SELECT offset_minutes FROM campaign_drip_steps WHERE sequence_id=$1 AND business_id=$2 AND step_order=0',
      [sequenceId, session.businessId]
    )).rows[0];
    if (!firstStep) throw new AppError('The sequence has no steps.', 409, 'DRIP_STEPS_INVALID');
    const requested = Array.isArray(body.contactIds) ? body.contactIds.map(clean).filter(Boolean) : [];
    const useSegment = body.useSegment === true || (!requested.length && Boolean(sequence.audience_segment_id));
    const fromSegment = useSegment
      ? await segmentContactIds(client, session.businessId, clean(body.segmentId) || sequence.audience_segment_id)
      : [];
    const contactIds = [...new Set([...requested, ...fromSegment])];
    const cap = enrollmentLimit();
    if (!contactIds.length) throw new AppError('Choose contacts or attach an active segment before enrolling.', 400, 'DRIP_AUDIENCE_EMPTY');
    if (contactIds.length > cap) {
      throw new AppError(`This enrollment exceeds the configured limit of ${cap} contacts.`, 413, 'DRIP_ENROLLMENT_LIMIT');
    }
    const eligible = (await client.query(
      `SELECT id FROM contacts
       WHERE business_id=$1 AND id=ANY($2::text[]) AND marketing_permission=TRUE AND unsubscribed=FALSE`,
      [session.businessId, contactIds]
    )).rows;
    for (const contact of eligible) {
      await client.query(
        `INSERT INTO campaign_drip_enrollments (id,business_id,sequence_id,contact_id,current_step,next_run_at,status)
         VALUES ($1,$2,$3,$4,0,NOW()+($5::int*INTERVAL '1 minute'),'active')
         ON CONFLICT (business_id,sequence_id,contact_id) DO UPDATE
         SET status='active',current_step=0,next_run_at=NOW()+($5::int*INTERVAL '1 minute'),last_campaign_id=NULL,updated_at=NOW()`,
        [id('de'), session.businessId, sequenceId, contact.id, Number(firstStep.offset_minutes)]
      );
    }
    const counts = { requested: contactIds.length, eligible: eligible.length, enrolled: eligible.length, skipped: contactIds.length - eligible.length };
    await audit(client, session, 'campaign_drip_enrolled', { sequenceId, source: useSegment ? 'segment' : 'contacts', ...counts });
    return counts;
  });
}

async function cancelEnrollments(session, body) {
  const sequenceId = clean(body.sequenceId || body.id);
  if (!sequenceId) throw new AppError('Sequence id is required.', 400, 'DRIP_ID_REQUIRED');
  const enrollmentId = clean(body.enrollmentId);
  const contactId = clean(body.contactId);
  if (!body.all && !enrollmentId && !contactId) {
    throw new AppError('Choose an enrollment or explicitly cancel all active enrollments.', 400, 'DRIP_CANCEL_SCOPE_REQUIRED');
  }
  return transaction(async (client) => {
    const exists = await client.query('SELECT 1 FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2', [sequenceId, session.businessId]);
    if (!exists.rowCount) throw new AppError('Drip sequence not found.', 404, 'DRIP_NOT_FOUND');
    const result = await client.query(
      `UPDATE campaign_drip_enrollments SET status='cancelled',updated_at=NOW()
       WHERE sequence_id=$1 AND business_id=$2 AND status='active'
         AND ($3='' OR id=$3) AND ($4='' OR contact_id=$4)`,
      [sequenceId, session.businessId, enrollmentId, contactId]
    );
    await audit(client, session, 'campaign_drip_cancelled', { sequenceId, enrollmentId: enrollmentId || null, contactId: contactId || null, cancelled: result.rowCount });
    return { cancelled: result.rowCount };
  });
}

function mapSequence(row, steps, counts) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    segmentId: row.audience_segment_id || null,
    timezone: row.timezone,
    steps,
    counts: { active: 0, completed: 0, cancelled: 0, failed: 0, total: 0, ...(counts || {}) },
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function listSequences(businessId) {
  const sequences = (await query(
    'SELECT * FROM campaign_drip_sequences WHERE business_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100',
    [businessId]
  )).rows;
  if (!sequences.length) return [];
  const sequenceIds = sequences.map((row) => row.id);
  const [stepsResult, countsResult] = await Promise.all([
    query(
      `SELECT st.step_order,st.offset_minutes,st.template_id,st.variables,st.sequence_id,
              t.name AS template_name,t.status AS template_status
       FROM campaign_drip_steps st
       LEFT JOIN templates t ON t.id=st.template_id AND t.business_id=st.business_id
       WHERE st.business_id=$1 AND st.sequence_id=ANY($2::text[])
       ORDER BY st.sequence_id,st.step_order`,
      [businessId, sequenceIds]
    ),
    query(
      `SELECT sequence_id,status,COUNT(*)::int AS count
       FROM campaign_drip_enrollments
       WHERE business_id=$1 AND sequence_id=ANY($2::text[])
       GROUP BY sequence_id,status`,
      [businessId, sequenceIds]
    )
  ]);
  const steps = new Map();
  for (const row of stepsResult.rows) {
    if (!steps.has(row.sequence_id)) steps.set(row.sequence_id, []);
    steps.get(row.sequence_id).push({
      stepOrder: Number(row.step_order), offsetMinutes: Number(row.offset_minutes), templateId: row.template_id,
      templateName: row.template_name || 'Unavailable template', templateStatus: row.template_status || 'Unavailable', variables: row.variables || {}
    });
  }
  const counts = new Map();
  for (const row of countsResult.rows) {
    const current = counts.get(row.sequence_id) || { total: 0 };
    current[row.status] = Number(row.count);
    current.total += Number(row.count);
    counts.set(row.sequence_id, current);
  }
  return sequences.map((row) => mapSequence(row, steps.get(row.id) || [], counts.get(row.id)));
}

export async function runCampaignDripQueue({ limit = 25 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 25, 1), 100);
  return transaction(async (client) => {
    const due = (await client.query(
      `SELECT e.*,s.timezone,s.name AS sequence_name,s.created_by
       FROM campaign_drip_enrollments e
       JOIN campaign_drip_sequences s ON s.id=e.sequence_id AND s.business_id=e.business_id
       WHERE e.status='active' AND s.status='active' AND e.next_run_at<=NOW()
       ORDER BY e.next_run_at,e.id
       LIMIT $1
       FOR UPDATE OF e SKIP LOCKED`,
      [capped]
    )).rows;
    let spawned = 0;
    let cancelled = 0;
    let failed = 0;
    for (const row of due) {
      const step = (await client.query(
        `SELECT st.*,t.body,t.status AS template_status
         FROM campaign_drip_steps st
         LEFT JOIN templates t ON t.id=st.template_id AND t.business_id=st.business_id
         WHERE st.sequence_id=$1 AND st.business_id=$2 AND st.step_order=$3`,
        [row.sequence_id, row.business_id, row.current_step]
      )).rows[0];
      if (!step) {
        await client.query("UPDATE campaign_drip_enrollments SET status='completed',updated_at=NOW() WHERE id=$1 AND business_id=$2", [row.id, row.business_id]);
        continue;
      }
      if (step.template_status !== 'Approved') {
        await client.query("UPDATE campaign_drip_enrollments SET status='failed',updated_at=NOW() WHERE id=$1 AND business_id=$2", [row.id, row.business_id]);
        failed++;
        continue;
      }
      const contact = (await client.query(
        'SELECT id FROM contacts WHERE id=$1 AND business_id=$2 AND marketing_permission=TRUE AND unsubscribed=FALSE',
        [row.contact_id, row.business_id]
      )).rows[0];
      if (!contact) {
        await client.query("UPDATE campaign_drip_enrollments SET status='cancelled',updated_at=NOW() WHERE id=$1 AND business_id=$2", [row.id, row.business_id]);
        cancelled++;
        continue;
      }
      const campaignId = id('camp');
      const recipientId = id('cr');
      await client.query(
        `INSERT INTO campaigns (id,business_id,name,template_id,mode,status,scheduled_at,timezone,delivery_method,variables,approval_status,created_by)
         VALUES ($1,$2,$3,$4,'Live Meta','queued',NOW(),$5,'cloud_api',$6::jsonb,'not_required',$7)`,
        [campaignId, row.business_id, `${row.sequence_name} · step ${Number(row.current_step) + 1}`, step.template_id, row.timezone, JSON.stringify(step.variables || {}), row.created_by]
      );
      await client.query(
        `INSERT INTO campaign_recipients (id,campaign_id,contact_id,message,status) VALUES ($1,$2,$3,$4,'queued')`,
        [recipientId, campaignId, row.contact_id, step.body || '']
      );
      await client.query(
        "INSERT INTO campaign_jobs (id,campaign_recipient_id,status,run_at) VALUES ($1,$2,'queued',NOW())",
        [id('j'), recipientId]
      );
      const nextStep = Number(row.current_step) + 1;
      const next = (await client.query(
        'SELECT offset_minutes FROM campaign_drip_steps WHERE sequence_id=$1 AND business_id=$2 AND step_order=$3',
        [row.sequence_id, row.business_id, nextStep]
      )).rows[0];
      if (next) {
        await client.query(
          `UPDATE campaign_drip_enrollments
           SET current_step=$1,last_campaign_id=$2,next_run_at=NOW()+($3::int*INTERVAL '1 minute'),updated_at=NOW()
           WHERE id=$4 AND business_id=$5`,
          [nextStep, campaignId, Number(next.offset_minutes), row.id, row.business_id]
        );
      } else {
        await client.query(
          "UPDATE campaign_drip_enrollments SET status='completed',last_campaign_id=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3",
          [campaignId, row.id, row.business_id]
        );
      }
      spawned++;
    }
    return { due: due.length, spawned, cancelled, failed };
  });
}

export async function campaignDripRequest(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    if (request.method === 'GET') return json({ sequences: await listSequences(session.businessId) });
    const body = await readJsonBodyLimited(request, CAMPAIGN_DRIP_LIMITS.requestBytes);
    if (body.action === 'create') return json({ ok: true, id: await saveSequence(session, body, false) }, 201);
    if (body.action === 'edit') return json({ ok: true, id: await saveSequence(session, body, true) });
    if (['activate', 'pause', 'resume', 'archive'].includes(body.action)) {
      return json({ ok: true, ...(await changeLifecycle(session, body)) });
    }
    if (body.action === 'enroll') return json({ ok: true, ...(await enrollSequence(session, body)) });
    if (body.action === 'cancel') return json({ ok: true, ...(await cancelEnrollments(session, body)) });
    throw new AppError('Invalid drip action.', 400, 'VALIDATION_ERROR');
  } catch (error) {
    return errorJson(error);
  }
}
