import { AppError, id, query, transaction, errorJson, json } from './db.js';
import { requireWorkspaceManager } from './workspace-permissions.js';
import { requireSession } from './auth.js';
import { readJsonBodyLimited } from './security.js';

export async function runCampaignDripQueue({ limit = 25 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const due = (
    await query(
      `SELECT e.*, s.timezone, s.audience_segment_id
       FROM campaign_drip_enrollments e
       JOIN campaign_drip_sequences s ON s.id=e.sequence_id AND s.business_id=e.business_id
       WHERE e.status='active' AND s.status='active' AND e.next_run_at<=NOW()
       ORDER BY e.next_run_at
       LIMIT $1`,
      [capped]
    )
  ).rows;
  let spawned = 0;
  for (const row of due) {
    const step = (
      await query(
        `SELECT * FROM campaign_drip_steps WHERE sequence_id=$1 AND business_id=$2 AND step_order=$3`,
        [row.sequence_id, row.business_id, row.current_step]
      )
    ).rows[0];
    if (!step) {
      await query("UPDATE campaign_drip_enrollments SET status='completed', updated_at=NOW() WHERE id=$1", [row.id]);
      continue;
    }
    const contact = (await query('SELECT id FROM contacts WHERE id=$1 AND business_id=$2 AND unsubscribed=FALSE', [row.contact_id, row.business_id])).rows[0];
    if (!contact) {
      await query("UPDATE campaign_drip_enrollments SET status='cancelled', updated_at=NOW() WHERE id=$1", [row.id]);
      continue;
    }
    const campaignId = id('camp');
    const scheduledAt = new Date();
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO campaigns (id, business_id, name, template_id, mode, status, scheduled_at, timezone, delivery_method, variables, approval_status, created_by)
         VALUES ($1,$2,$3,$4,'Live Meta','scheduled',$5,$6,'cloud_api',$7::jsonb,'not_required',NULL)`,
        [
          campaignId,
          row.business_id,
          `Drip ${row.sequence_id} step ${row.current_step}`,
          step.template_id,
          scheduledAt,
          row.timezone || 'UTC',
          JSON.stringify(step.variables || {})
        ]
      );
      await client.query(
        `INSERT INTO campaign_recipients (id, campaign_id, contact_id, message, status) VALUES ($1,$2,$3,'', 'queued')`,
        [id('cr'), campaignId, row.contact_id]
      );
      const nextStep = row.current_step + 1;
      const nextStepRow = (
        await client.query('SELECT offset_minutes FROM campaign_drip_steps WHERE sequence_id=$1 AND step_order=$2', [row.sequence_id, nextStep])
      ).rows[0];
      if (!nextStepRow) {
        await client.query(
          "UPDATE campaign_drip_enrollments SET status='completed', last_campaign_id=$1, updated_at=NOW() WHERE id=$2",
          [campaignId, row.id]
        );
      } else {
        const minutesUntilNext = Number(nextStepRow.offset_minutes) || 0;
        await client.query(
          `UPDATE campaign_drip_enrollments SET current_step=$1, last_campaign_id=$2, next_run_at=NOW()+($3::int*INTERVAL '1 minute'), updated_at=NOW() WHERE id=$4`,
          [nextStep, campaignId, minutesUntilNext, row.id]
        );
      }
    });
    spawned++;
  }
  return { due: due.length, spawned };
}

export async function campaignDripRequest(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    if (request.method === 'GET') {
      const sequences = await query(
        `SELECT s.*, (SELECT COUNT(*)::int FROM campaign_drip_steps st WHERE st.sequence_id=s.id) AS steps,
         (SELECT COUNT(*)::int FROM campaign_drip_enrollments e WHERE e.sequence_id=s.id AND e.status='active') AS active_enrollments
         FROM campaign_drip_sequences s WHERE s.business_id=$1 ORDER BY s.updated_at DESC LIMIT 50`,
        [session.businessId]
      );
      return json({ sequences: sequences.rows });
    }
    const body = await readJsonBodyLimited(request, 500_000);
    if (body.action === 'create') {
      const sequenceId = id('drip');
      await transaction(async (client) => {
        await client.query(
          `INSERT INTO campaign_drip_sequences (id, business_id, name, status, audience_segment_id, timezone, created_by)
           VALUES ($1,$2,$3,'draft',$4,$5,$6)`,
          [sequenceId, session.businessId, String(body.name || '').slice(0, 120), body.segmentId || null, body.timezone || 'UTC', session.userId]
        );
        const steps = Array.isArray(body.steps) ? body.steps : [];
        for (let i = 0; i < Math.min(steps.length, 20); i++) {
          const step = steps[i];
          await client.query(
            `INSERT INTO campaign_drip_steps (id, sequence_id, business_id, step_order, offset_minutes, template_id, variables)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [id('ds'), sequenceId, session.businessId, i, Number(step.offsetMinutes) || 0, step.templateId, JSON.stringify(step.variables || {})]
          );
        }
      });
      return json({ ok: true, id: sequenceId }, 201);
    }
    if (body.action === 'activate' && body.id) {
      await query("UPDATE campaign_drip_sequences SET status='active', updated_at=NOW() WHERE id=$1 AND business_id=$2", [body.id, session.businessId]);
      return json({ ok: true });
    }
    if (body.action === 'enroll' && body.sequenceId) {
      const sequence = (
        await query("SELECT * FROM campaign_drip_sequences WHERE id=$1 AND business_id=$2 AND status='active'", [body.sequenceId, session.businessId])
      ).rows[0];
      if (!sequence) throw new AppError('Active drip sequence not found.', 404, 'NOT_FOUND');
      const firstStep = (
        await query('SELECT offset_minutes FROM campaign_drip_steps WHERE sequence_id=$1 AND step_order=0', [body.sequenceId])
      ).rows[0];
      const delay = Number(firstStep?.offset_minutes) || 0;
      const contactIds = Array.isArray(body.contactIds) ? body.contactIds.slice(0, 500) : [];
      let enrolled = 0;
      for (const contactId of contactIds) {
        const contact = (await query('SELECT id FROM contacts WHERE id=$1 AND business_id=$2 AND unsubscribed=FALSE', [contactId, session.businessId])).rows[0];
        if (!contact) continue;
        await query(
          `INSERT INTO campaign_drip_enrollments (id, business_id, sequence_id, contact_id, current_step, next_run_at, status)
           VALUES ($1,$2,$3,$4,0,NOW()+($5::int*INTERVAL '1 minute'),'active')
           ON CONFLICT (business_id, sequence_id, contact_id) DO UPDATE SET status='active', current_step=0, next_run_at=NOW()+($5::int*INTERVAL '1 minute'), updated_at=NOW()`,
          [id('de'), session.businessId, body.sequenceId, contactId, delay]
        );
        enrolled++;
      }
      return json({ ok: true, enrolled });
    }
    throw new AppError('Invalid drip action.', 400, 'VALIDATION_ERROR');
  } catch (error) {
    return errorJson(error);
  }
}
