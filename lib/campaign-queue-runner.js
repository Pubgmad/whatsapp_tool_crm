import { operationalPolicy } from './operational-policy.js';
import { validateTemplateParameters } from './template-send-components.js';
import { resolveTrackedParameters } from './click-tracking.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import { campaignDispatchState, updateCampaignCompletion } from './campaign-queue-safety.js';
import { reserveCampaignDelivery } from './campaign-controls.js';
import { metaReady, sendMarketingTemplateMessage, sendTemplateMessage, templateApiName } from './meta.js';
import { assertMessageCapacity } from './limits.js';
import { AppError, id, query, transaction } from './db.js';
import { clean } from './workspace-mappers.js';

export async function runCampaignQueue({ businessId = "", limit = queueBatchSize() } = {}) {
  if ((await workspaceFeatureFlags()).campaigns === false) return { claimed: 0, sent: 0, failed: 0, retried: 0, deferred: 0, disabled: true };
  const { activateDueScheduledCampaigns } = await import('./campaign-operations.js');
  const { refreshDynamicCampaignAudiences } = await import('./campaign-audience-sync.js');
  await activateDueScheduledCampaigns();
  await refreshDynamicCampaignAudiences(businessId);
  const size = Math.max(1, Math.min(Number(limit) || queueBatchSize(), 100));
  const jobs = await claimCampaignJobs({ businessId, limit: size });
  const summary = { claimed: jobs.length, sent: 0, failed: 0, retried: 0, deferred: 0 };

  for (const job of jobs) {
    try {
      if ((await workspaceFeatureFlags(job.business_id)).campaigns === false) {
        await query("UPDATE campaign_jobs SET status='queued',locked_at=NULL,updated_at=NOW() WHERE id=$1", [job.job_id]);
        summary.deferred += 1;
        continue;
      }
      const dispatchState = await campaignDispatchState({
        campaignId: job.campaign_id, businessId: job.business_id, contactId: job.contact_id
      });
      if (dispatchState === "paused") {
        await query("UPDATE campaign_jobs SET status='queued',locked_at=NULL,updated_at=NOW() WHERE id=$1", [job.job_id]);
        summary.deferred += 1;
        continue;
      }
      await assertMessageCapacity(job.business_id, 1, null, job.contact_id);
      if (job.template_status !== 'Approved') throw new AppError('Campaign template is no longer approved.', 409, 'TEMPLATE_NOT_APPROVED');
      if (!metaReady(job) || (job.selected_phone_number_id && (!job.phone_number_id || !job.access_token_encrypted || (job.selected_token_expires_at && new Date(job.selected_token_expires_at)<=new Date())))) {
        throw new AppError('The selected WhatsApp sender must be reconnected.',409,'META_RECONNECT_REQUIRED');
      }
      if ((job.template_waba_id && job.template_waba_id!==job.waba_id) || (!job.template_waba_id && job.waba_id!==job.default_waba_id)) {
        throw new AppError('The campaign template no longer matches the sender WABA.',409,'TEMPLATE_WABA_MISMATCH');
      }
      validateTemplateParameters({ component_schema: job.template_component_schema }, job.template_parameters || {});
      if (job.delivery_method === 'marketing_messages_api') {
        const readiness = (await query('SELECT capabilities FROM whatsapp_accounts WHERE business_id=$1 AND waba_id=$2 AND status=$3', [job.business_id, job.waba_id, 'connected'])).rows[0];
        if (readiness?.capabilities?.marketing_messages_api?.status !== 'ONBOARDED') throw new AppError('Marketing Messages eligibility is no longer confirmed.', 409, 'MARKETING_MESSAGES_NOT_ONBOARDED');
      }
      const variables = job.variables || {};
      const templateVariablesList = Array.isArray(job.template_variables) ? job.template_variables : [];
      const values = templateVariablesList.map((key) => key === "name" ? job.contact_name : variables[key] || "");
      if (job.delivery_method === 'marketing_messages_api' && job.template_category !== 'MARKETING') {
        throw new AppError('Campaign template is no longer a marketing template.', 409, 'MARKETING_TEMPLATE_REQUIRED');
      }
      const eligibleAt = await reserveCampaignDelivery(job);
      if (eligibleAt) {
        await query("UPDATE campaign_jobs SET status='queued',run_at=$1,locked_at=NULL,error_message='Deferred by marketing frequency control',updated_at=NOW() WHERE id=$2",[eligibleAt,job.job_id]);
        summary.deferred += 1;
        continue;
      }
      const sender = job.delivery_method === 'marketing_messages_api'
        ? sendMarketingTemplateMessage
        : sendTemplateMessage;
      const tracked=await resolveTrackedParameters({businessId:job.business_id,contactId:job.contact_id,recipientId:job.campaign_recipient_id,reference:job.campaign_recipient_id,variables:values,parameters:job.template_parameters||{},templateSchema:job.template_component_schema||{}});
      const meta = await sender({
        setup: job,
        to: job.phone,
        templateName: job.meta_template_name || templateApiName(job.template_name),
        language: job.template_language,
        parameters: tracked.parameters,
        variables: tracked.variables
      });
      await recordSuccessfulCampaignSend(job, meta);
      summary.sent += 1;
    } catch (error) {
      const nextAttempts = Number(job.attempts || 0) + 1;
      const shouldRetry = nextAttempts < Number(job.max_attempts || 3) && (await isRetryableError(error));
      await recordCampaignFailure(job, error);
      await transaction(async (client) => {
        await client.query(
          `UPDATE campaign_jobs
           SET status = $1, attempts = $2, run_at = NOW() + ($3 || ' minutes')::interval,
               locked_at = NULL, completed_at = CASE WHEN $1='failed' THEN NOW() ELSE NULL END,
               error_message = $4, updated_at = NOW()
           WHERE id = $5`,
          [shouldRetry ? "retry" : "failed", nextAttempts, String(Math.min(nextAttempts * 5, 30)), clean(error.message), job.job_id]
        );
        await client.query(
          `UPDATE campaign_recipients
           SET status = $1, error_message = $2, updated_at = NOW()
           WHERE id = $3`,
          [shouldRetry ? "queued" : "failed", clean(error.message), job.campaign_recipient_id]
        );
        await updateCampaignCompletion(client, job.campaign_id, job.business_id);
      });
      if (shouldRetry) summary.retried += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

async function recordSuccessfulCampaignSend(job, meta) {
  return transaction(async (client) => {
    await client.query(
      `UPDATE campaign_recipients
       SET status = $1, meta_message_id = $2, error_message = '', sent_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [meta.status, meta.metaMessageId, job.campaign_recipient_id]
    );
    await client.query(
      `UPDATE campaign_jobs
       SET status = 'completed', completed_at = NOW(), error_message = '', updated_at = NOW()
       WHERE id = $1`,
      [job.job_id]
    );

    await client.query(
      `INSERT INTO conversations (id, business_id, contact_id, updated_at, whatsapp_phone_number_id)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (business_id, contact_id) DO UPDATE
         SET updated_at = NOW(), whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id`,
      [id("v"), job.business_id, job.contact_id, job.phone_number_id]
    );
    const conversation = await client.query(
      "SELECT id FROM conversations WHERE business_id = $1 AND contact_id = $2",
      [job.business_id, job.contact_id]
    );
    await client.query(
      `INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, message_type, campaign_recipient_id)
       VALUES ($1, $2, 'outgoing', $3, $4, $5, 'template', $6)
       ON CONFLICT DO NOTHING`,
      [id("m"), conversation.rows[0].id, job.message, meta.status, meta.metaMessageId, job.campaign_recipient_id]
    );

    const definition = job.automation_definition || {};
    const startNodeId = clean(definition.startNodeId || definition.nodes?.[0]?.id);
    if (job.automation_flow_id && startNodeId) {
      const sessionId = id("fs");
      const created = await client.query(
        `INSERT INTO automation_sessions (id, business_id, contact_id, flow_id, current_node_id, campaign_id, context, definition_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
         ON CONFLICT (business_id, contact_id) WHERE status = 'active' DO NOTHING
         RETURNING id`,
        [
          sessionId,
          job.business_id,
          job.contact_id,
          job.automation_flow_id,
          startNodeId,
          job.campaign_id,
          JSON.stringify({ campaignId: job.campaign_id }),
          JSON.stringify(definition)
        ]
      );
      if (created.rows[0]) {
        await client.query(
          `INSERT INTO automation_jobs (id, business_id, session_id, incoming_message_id, input, run_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
          [
            id('aj'),
            job.business_id,
            created.rows[0].id,
            `campaign:${job.campaign_id}:${job.contact_id}`,
            JSON.stringify({ phase: 'start', campaignId: job.campaign_id })
          ]
        );
      }
    }

    await updateCampaignCompletion(client, job.campaign_id, job.business_id);
    if (job.template_category === 'MARKETING') await client.query('UPDATE campaign_delivery_reservations SET reserved_until=NOW() WHERE business_id=$1 AND contact_id=$2 AND campaign_id=$3',[job.business_id,job.contact_id,job.campaign_id]);
  });
}
async function claimCampaignJobs({ businessId = "", limit }) {
  return transaction(async (client) => {
    const params = [limit];
    const businessFilter = businessId ? "AND c.business_id = $2" : "";
    if (businessId) params.push(businessId);
    const stale = await client.query(
      `SELECT j.id, j.campaign_recipient_id, c.id AS campaign_id, c.business_id FROM campaign_jobs j
       JOIN campaign_recipients cr ON cr.id=j.campaign_recipient_id
       JOIN campaigns c ON c.id=cr.campaign_id
       WHERE j.status='processing' AND j.locked_at < NOW() - INTERVAL '15 minutes'
         ${businessFilter}
       ORDER BY j.locked_at LIMIT $1 FOR UPDATE OF j SKIP LOCKED`,
      params
    );
    if (stale.rows.length) {
      await client.query(
        `UPDATE campaign_jobs SET status='failed',locked_at=NULL,completed_at=NOW(),updated_at=NOW(),
           error_message='Delivery unconfirmed after worker interruption. Verify in Meta before retrying.'
         WHERE id=ANY($1)`,
        [stale.rows.map((row) => row.id)]
      );
      await client.query(
        `UPDATE campaign_recipients SET status='failed',updated_at=NOW(),
           error_message='Delivery unconfirmed after worker interruption. Verify in Meta before retrying.'
         WHERE id=ANY($1)`,
        [stale.rows.map((row) => row.campaign_recipient_id)]
      );
      for (const campaign of new Map(stale.rows.map((row) => [row.campaign_id, row.business_id]))) {
        await updateCampaignCompletion(client, campaign[0], campaign[1]);
      }
    }
    const result = await client.query(
      `SELECT j.id AS job_id, j.attempts, j.max_attempts, j.campaign_recipient_id,
              cr.message, c.id AS campaign_id, c.variables, c.business_id, c.automation_flow_id,
              c.delivery_method, c.template_parameters, c.frequency_hours, t.status AS template_status, t.component_schema AS template_component_schema, t.category AS template_category, t.name AS template_name, t.waba_id AS template_waba_id,
              t.variables AS template_variables, t.meta_template_name, t.language AS template_language,
              ct.id AS contact_id, ct.name AS contact_name, ct.phone, af.definition AS automation_definition,
              CASE WHEN c.whatsapp_phone_number_id<>'' THEN a.waba_id ELSE b.waba_id END AS waba_id,
              CASE WHEN c.whatsapp_phone_number_id<>'' THEN p.phone_number_id ELSE b.phone_number_id END AS phone_number_id,
              CASE WHEN c.whatsapp_phone_number_id<>'' THEN a.access_token_encrypted ELSE b.access_token_encrypted END AS access_token_encrypted,
              a.token_expires_at AS selected_token_expires_at, c.whatsapp_phone_number_id AS selected_phone_number_id,
              b.waba_id AS default_waba_id
       FROM campaign_jobs j
       JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
       JOIN campaigns c ON c.id = cr.campaign_id
       JOIN templates t ON t.id = c.template_id
       JOIN contacts ct ON ct.id = cr.contact_id
       LEFT JOIN automation_flows af ON af.id = c.automation_flow_id AND af.business_id = c.business_id AND af.status = 'active'
       JOIN businesses b ON b.id = c.business_id
       LEFT JOIN whatsapp_phone_numbers p ON p.business_id=c.business_id AND p.phone_number_id=c.whatsapp_phone_number_id
       LEFT JOIN whatsapp_accounts a ON a.id=p.whatsapp_account_id AND a.business_id=p.business_id AND a.status='connected'
       LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
       WHERE c.status IN ('queued', 'scheduled', 'processing') AND j.status IN ('queued', 'retry') AND j.run_at <= NOW()
         AND c.approval_status IN ('not_required','approved')
         AND b.account_status <> 'suspended'
         AND b.feature_overrides->>'campaigns' IS DISTINCT FROM 'false'
         AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr
                         WHERE dr.business_id = b.id AND dr.status IN ('scheduled', 'pending_approval'))
         ${process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED !== 'false' ? "AND (b.review_access = TRUE OR (bs.status = 'active' AND (bs.current_period_end IS NULL OR bs.current_period_end > NOW())) OR (bs.status = 'trialing' AND bs.trial_ends_at > NOW()))" : ""}
         ${businessFilter}
       ORDER BY j.created_at ASC
       LIMIT $1
       FOR UPDATE OF j SKIP LOCKED`,
      params
    );
    const jobIds = result.rows.map((row) => row.job_id);
    if (jobIds.length) {
      await client.query("UPDATE campaign_jobs SET status = 'processing', locked_at = NOW(), updated_at = NOW() WHERE id = ANY($1)", [jobIds]);
    }
    return result.rows;
  });
}

export function queueBatchSize() {
  return operationalPolicy().campaignQueueBatchSize;
}

async function recordCampaignFailure(job, error) {
  try {
    const { recordCampaignSendEvent } = await import('./campaign-send-events.js');
    await recordCampaignSendEvent({
      businessId: job.business_id,
      campaignId: job.campaign_id,
      campaignRecipientId: job.campaign_recipient_id,
      jobId: job.job_id,
      httpStatus: Number(error?.status || 0),
      errorCode: String(error?.code || ''),
      errorMessage: String(error?.message || ''),
      eventKind: Number(error?.status || 0) === 429 ? 'rate_limited' : 'failure'
    });
  } catch {
    /* observability must not block queue */
  }
}

async function isRetryableError(error) {
  const { isRetryableCampaignJobError } = await import('./campaign-retry-policy.js');
  return isRetryableCampaignJobError(error);
}
