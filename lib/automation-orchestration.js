import crypto from 'node:crypto';
import { AppError, id, query, transaction } from './db.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Resume an automation session after a native Flow or hosted-form completion.
 * Schedules the configured resume node (or current next) without re-triggering inbound matching.
 */
export async function resumeAutomationAfterInteractive({
  businessId,
  contactId,
  sessionId = null,
  resumeNodeId = '',
  contextPatch = {},
  source = 'interactive'
}) {
  return transaction(async (client) => {
    const session = (await client.query(
      `SELECT s.*, f.status AS flow_status, f.definition,
              COALESCE(s.definition_snapshot, f.definition) AS effective_definition
       FROM automation_sessions s
       JOIN automation_flows f ON f.id = s.flow_id AND f.business_id = s.business_id
       WHERE s.business_id = $1
         AND ($2 = '' OR s.id = $2)
         AND s.contact_id = $3
         AND s.status = 'active'
       ORDER BY s.updated_at DESC
       LIMIT 1
       FOR UPDATE OF s`,
      [businessId, sessionId || '', contactId]
    )).rows[0];
    if (!session) return { resumed: false, reason: 'no_active_session' };
    if (session.flow_status !== 'active') return { resumed: false, reason: 'flow_inactive' };

    const definition = session.effective_definition || session.definition || {};
    const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
    const targetId = String(resumeNodeId || '').trim()
      || nodes.find((node) => node.id === session.current_node_id)?.next
      || '';
    if (!targetId || !nodes.some((node) => node.id === targetId)) {
      return { resumed: false, reason: 'resume_node_missing' };
    }

    const context = { ...(session.context || {}), ...contextPatch, lastInteractiveSource: source };
    const jobId = id('aj');
    await client.query(
      `UPDATE automation_sessions
       SET current_node_id = $1, context = $2::jsonb, last_error = '', updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [targetId, JSON.stringify(context), session.id, businessId]
    );
    const resumeKey = `resume:${source}:${session.id}:${targetId}:${hash(JSON.stringify(contextPatch)).slice(0, 16)}`;
    const existing = (await client.query(
      `SELECT id FROM automation_jobs WHERE business_id=$1 AND incoming_message_id=$2 LIMIT 1`,
      [businessId, resumeKey]
    )).rows[0];
    if (existing) return { resumed: true, sessionId: session.id, jobId: existing.id, targetId, duplicate: true };
    await client.query(
      `INSERT INTO automation_jobs (id, business_id, session_id, incoming_message_id, input, run_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
      [
        jobId,
        businessId,
        session.id,
        resumeKey,
        JSON.stringify({ phase: 'scheduled', targetNodeId: targetId, source })
      ]
    );
    await client.query(
      `INSERT INTO events (id, business_id, type, contact_id, metadata)
       VALUES ($1, $2, 'automation_resumed', $3, $4::jsonb)`,
      [id('e'), businessId, contactId, JSON.stringify({ sessionId: session.id, targetId, source })]
    );
    return { resumed: true, sessionId: session.id, jobId, targetId };
  });
}

export async function sendAutomationNativeFlow({ job, node, context }) {
  const { sendNativeFlowInvite } = await import('./whatsapp-experiences.js');
  const flow = (await query(
    `SELECT * FROM whatsapp_native_flows
     WHERE business_id = $1 AND id = $2 AND status = 'published'`,
    [job.business_id, node.nativeFlowId]
  )).rows[0];
  if (!flow) throw new AppError('Published native Flow not found for this automation node.', 404, 'AUTOMATION_FLOW_MISSING');

  const phone = (await query(
    `SELECT p.id FROM whatsapp_phone_numbers p
     JOIN conversations c ON c.whatsapp_phone_number_id = p.phone_number_id AND c.business_id = p.business_id
     WHERE p.business_id = $1 AND c.contact_id = $2
     LIMIT 1`,
    [job.business_id, job.contact_id]
  )).rows[0];
  if (!phone) throw new AppError('Conversation phone is required to send a native Flow.', 409, 'AUTOMATION_FLOW_PHONE');

  const requestId = `auto_${job.session_id}_${node.id}_${Date.now()}`.slice(0, 100);
  const session = { businessId: job.business_id, userId: null };
  const result = await sendNativeFlowInvite(session, {
    requestId,
    contactId: job.contact_id,
    phoneId: phone.id,
    text: String(node.body || 'Please complete this form').slice(0, 1024),
    cta: String(node.ctaLabel || 'Open').slice(0, 20),
    expiresHours: Math.min(168, Math.max(1, Number(node.expiresHours) || 24))
  }, flow);

  await query(
    `UPDATE whatsapp_flow_invites
     SET automation_session_id = $1, resume_node_id = $2
     WHERE business_id = $3 AND request_id = $4`,
    [job.session_id, node.next || '', job.business_id, requestId]
  );
  await query(
    `UPDATE automation_sessions
     SET current_node_id = $1,
         context = jsonb_set(COALESCE(context,'{}'::jsonb), '{waitingForNativeFlow}', $2::jsonb, true),
         updated_at = NOW()
     WHERE id = $3 AND business_id = $4`,
    [node.id, JSON.stringify({ inviteRequestId: requestId, resumeNodeId: node.next || '' }), job.session_id, job.business_id]
  );
  return { ...result, waiting: true, context: { ...context, waitingForNativeFlow: true, nativeFlowRequestId: requestId } };
}

export async function sendAutomationWebviewCta({ job, node, context }) {
  const { sendHostedWebviewInChat, sendTransactionalWebview } = await import('./whatsapp-webview-transactions.js');
  const view = (await query(
    `SELECT id, flow_id, enabled FROM whatsapp_webviews WHERE business_id = $1 AND id = $2`,
    [job.business_id, node.webviewId]
  )).rows[0];
  if (!view?.enabled) throw new AppError('Enabled hosted page not found for this automation node.', 404, 'AUTOMATION_WEBVIEW_MISSING');

  const operationId = `auto_wv_${job.session_id}_${node.id}_${Date.now()}`.slice(0, 100);
  const payload = {
    businessId: job.business_id,
    userId: null,
    viewId: view.id,
    contactId: job.contact_id,
    operationId
  };
  const result = view.flow_id
    ? await sendTransactionalWebview(payload)
    : await sendHostedWebviewInChat(payload);

  const wait = node.waitForCompletion === true && Boolean(view.flow_id);
  await query(
    `UPDATE automation_sessions
     SET current_node_id = $1,
         context = context || $2::jsonb,
         updated_at = NOW()
     WHERE id = $3 AND business_id = $4`,
    [
      node.id,
      JSON.stringify({
        waitingForWebview: wait,
        webviewId: view.id,
        webviewOperationId: operationId,
        resumeNodeId: node.next || ''
      }),
      job.session_id,
      job.business_id
    ]
  );
  return { ...result, waiting: wait, context: { ...context, webviewId: view.id } };
}

export async function startManualAutomationSession(client, {
  businessId,
  contactId,
  flowId,
  conversationId = null,
  context = {},
  messageId = ''
}) {
  const flow = (await client.query(
    `SELECT * FROM automation_flows
     WHERE business_id = $1 AND id = $2 AND status = 'active' AND trigger_mode = 'manual'
     FOR SHARE`,
    [businessId, flowId]
  )).rows[0];
  if (!flow?.definition?.startNodeId) throw new AppError('Active manual automation flow not found.', 404, 'AUTOMATION_FLOW_NOT_FOUND');
  const active = (await client.query(
    `SELECT id FROM automation_sessions
     WHERE business_id = $1 AND contact_id = $2 AND status IN ('active', 'handoff')
     LIMIT 1`,
    [businessId, contactId]
  )).rows[0];
  if (active) throw new AppError('Contact already has an active automation session.', 409, 'AUTOMATION_ACTIVE');

  const sessionId = id('fs');
  const jobId = id('aj');
  await client.query(
    `INSERT INTO automation_sessions (id, business_id, contact_id, flow_id, current_node_id, context, definition_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      sessionId,
      businessId,
      contactId,
      flow.id,
      flow.definition.startNodeId,
      JSON.stringify(context),
      JSON.stringify(flow.definition)
    ]
  );
  await client.query(
    `INSERT INTO automation_jobs (id, business_id, session_id, incoming_message_id, input, run_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
    [
      jobId,
      businessId,
      sessionId,
      messageId || `manual:${sessionId}`,
      JSON.stringify({ phase: 'start', conversationId: conversationId || null, ...context })
    ]
  );
  return { sessionId, jobId, flowId: flow.id };
}
