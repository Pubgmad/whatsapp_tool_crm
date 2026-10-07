import { currentAccount, requireSession } from "./auth";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { assertAutomationFlowCapacity, assertMessageCapacity } from "./limits";
import { decryptSecret, metaReady, sendInteractiveMessage, sendTemplateMessage, sendTextMessage, templateApiName } from "./meta";
import { requireWorkspaceManager } from "./workspace-permissions";
import { readJsonBodyLimited, readOptionalJsonBodyLimited } from "./security";
import { automationMessagingSetup } from "./automation-number";
import { assertAutomationDispatchAllowed } from "./automation-dispatch";
import {validateTemplateParameters} from './template-send-components.js';
import { ADVANCED_NODE_TYPES, normalizeAdvancedNode, executeAdvancedNode } from './automation-node-runtime.js';
import { requestOutboundConnection } from './automation-outbound.js';
import { canTransitionOrder } from './whatsapp-commerce.js';
import { workspaceFeatureFlags } from './feature-controls.js';
import {cancelPendingAiReply} from './ai-auto-replies.js';

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function batchSize() {
  return Math.max(1, Math.min(Number(process.env.AUTOMATION_QUEUE_BATCH_SIZE) || 25, 100));
}

export async function listAutomationFlows(businessId, paging = null) {
  const pageSize = paging ? Math.max(1, Math.min(100, Number.parseInt(paging.pageSize,10) || 25)) : null;
  const page = paging ? Math.max(1, Number.parseInt(paging.page,10) || 1) : null;
  const result = await query(
    `SELECT f.*,
            COALESCE(active_sessions.total, 0)::int AS active_sessions,
            COALESCE(completed_sessions.total, 0)::int AS completed_sessions,
            COALESCE(handoff_sessions.total, 0)::int AS handoff_sessions,
            COALESCE(failed_sessions.total, 0)::int AS failed_sessions,
            COALESCE(pending_jobs.total, 0)::int AS pending_jobs,
            latest_session.last_at
     FROM automation_flows f
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_sessions s WHERE s.flow_id = f.id AND s.status = 'active') active_sessions ON TRUE
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_sessions s WHERE s.flow_id = f.id AND s.status = 'completed') completed_sessions ON TRUE
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_sessions s WHERE s.flow_id = f.id AND s.status = 'handoff') handoff_sessions ON TRUE
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_sessions s WHERE s.flow_id = f.id AND s.status = 'failed') failed_sessions ON TRUE
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_jobs j JOIN automation_sessions s ON s.id = j.session_id WHERE s.flow_id = f.id AND j.status IN ('queued', 'retry')) pending_jobs ON TRUE
     LEFT JOIN LATERAL (SELECT MAX(s.updated_at) AS last_at FROM automation_sessions s WHERE s.flow_id = f.id) latest_session ON TRUE
     WHERE f.business_id = $1 AND f.status <> 'archived'
     ORDER BY f.updated_at DESC,f.id DESC ${paging ? 'LIMIT $2 OFFSET $3' : ''}`,
    paging ? [businessId,pageSize,(page-1)*pageSize] : [businessId]
  );
  return result.rows.map(mapFlow);
}

export async function getAutomationFlows(request) {
  try {
    const account = await currentAccount(request);
    const total=Number((await query("SELECT COUNT(*)::int AS total FROM automation_flows WHERE business_id=$1 AND status<>'archived'",[account.business.id])).rows[0]?.total||0);
    const pageSize=25,pages=Math.max(1,Math.ceil(total/pageSize));
    const requested=Number.parseInt(new URL(request.url).searchParams.get('page'),10);
    const page=Math.min(pages,Math.max(1,requested||1));
    return json({ flows: await listAutomationFlows(account.business.id,{page,pageSize}),pagination:{page,pageSize,total,pages} });
  } catch (error) {
    return errorJson(error);
  }
}

export async function saveAutomationFlow(request, context = {}) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = context?.params ? await context.params : {};
    const body = await readJsonBodyLimited(request, 1_000_000);
    const requestedId = clean(body.id || params.id);
    const isUpdate = Boolean(requestedId);
    await assertAutomationFlowCapacity(account.business.id, isUpdate);
    const flow = normalizeFlowInput(body);
    const flowId = requestedId || id("flow");

    await transaction(async (client) => {
      if (isUpdate) {
        const existing = await client.query("SELECT id FROM automation_flows WHERE id = $1 AND business_id = $2", [flowId, account.business.id]);
        if (!existing.rows[0]) throw new AppError("Automation flow not found.", 404, "FLOW_NOT_FOUND");
        await client.query(
          `UPDATE automation_flows
           SET name = $1, description = $2, status = $3, trigger_mode = $4,
               trigger_keywords = $5, definition = $6, updated_at = NOW()
           WHERE id = $7 AND business_id = $8`,
          [flow.name, flow.description, flow.status, flow.triggerMode, JSON.stringify(flow.triggerKeywords), JSON.stringify(flow.definition), flowId, account.business.id]
        );
      } else {
        await client.query(
          `INSERT INTO automation_flows (id, business_id, name, description, status, trigger_mode, trigger_keywords, definition)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [flowId, account.business.id, flow.name, flow.description, flow.status, flow.triggerMode, JSON.stringify(flow.triggerKeywords), JSON.stringify(flow.definition)]
        );
      }
      await client.query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, $4, $5)", [id("a"), account.business.id, account.user.id, isUpdate ? "automation_flow_updated" : "automation_flow_created", JSON.stringify({ flowId })]);
    });

    return json({ ok: true, flowId }, isUpdate ? 200 : 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function patchAutomationFlow(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const status = normalize(body.status);
    if (!["draft", "active", "paused", "archived"].includes(status)) throw new AppError("Invalid flow status.", 400, "VALIDATION_ERROR");
    const result = await query("UPDATE automation_flows SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3 RETURNING id", [status, params.id, account.business.id]);
    if (!result.rows[0]) throw new AppError("Automation flow not found.", 404, "FLOW_NOT_FOUND");
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'automation_flow_status_updated', $4)", [id("a"), account.business.id, account.user.id, JSON.stringify({ flowId: params.id, status })]);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function deleteAutomationFlow(request, context) {
  try {
    const account = await currentAccount(request);
    requireWorkspaceManager(account);
    const params = await context.params;
    const result = await query("UPDATE automation_flows SET status = 'archived', updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING id", [params.id, account.business.id]);
    if (!result.rows[0]) throw new AppError("Automation flow not found.", 404, "FLOW_NOT_FOUND");
    await query("UPDATE automation_sessions SET status = 'cancelled', ended_at = NOW(), updated_at = NOW() WHERE flow_id = $1 AND business_id = $2 AND status = 'active'", [params.id, account.business.id]);
    await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'automation_flow_archived', $4)", [id("a"), account.business.id, account.user.id, JSON.stringify({ flowId: params.id })]);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

export async function enqueueAutomationForIncoming({ businessId, contactId, conversationId, messageId, input }) {
  if (isOptOut(input?.text || input?.value || input?.title)) return null;

  return transaction(async (client) => {
    const contact = (await client.query(
      "SELECT unsubscribed FROM contacts WHERE id=$1 AND business_id=$2",
      [contactId, businessId]
    )).rows[0];
    if (!contact || contact.unsubscribed) return null;
    const conversation = conversationId
      ? (await client.query("SELECT automation_paused FROM conversations WHERE id = $1 AND business_id = $2", [conversationId, businessId])).rows[0]
      : null;
    if (conversation?.automation_paused) return null;

    let session = (await client.query(
      `SELECT s.* FROM automation_sessions s
       JOIN automation_flows f ON f.id = s.flow_id
       WHERE s.business_id = $1 AND s.contact_id = $2 AND s.status = 'active' AND f.status = 'active'
       ORDER BY s.started_at DESC LIMIT 1`,
      [businessId, contactId]
    )).rows[0];
    let phase = "reply";

    if (!session) {
      const flow = (await client.query("SELECT * FROM automation_flows WHERE business_id = $1 AND status = 'active' ORDER BY updated_at DESC", [businessId])).rows.find((row) => flowMatchesTrigger(row, input));
      if (!flow) return null;
      const definition = normalizeDefinition(flow.definition);
      session = (await client.query(
        `INSERT INTO automation_sessions (id, business_id, contact_id, flow_id, current_node_id, context)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)
         RETURNING *`,
        [id("fs"), businessId, contactId, flow.id, definition.startNodeId]
      )).rows[0];
      phase = "start";
    }

    const jobId = id("aj");
    await client.query(
      `INSERT INTO automation_jobs (id, business_id, session_id, incoming_message_id, input, run_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [jobId, businessId, session.id, messageId || "", JSON.stringify({ ...input, phase, conversationId })]
    );
    return { jobId, sessionId: session.id };
  });
}

export async function processAutomationQueue(request) {
  try {
    const session = await requireSession(request);
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const summary = await runAutomationQueue({ businessId: session.businessId, limit: Number(body.limit) || batchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processAutomationQueueJob(request) {
  try {
    const { enterSystemContext } = await import('./db');
    enterSystemContext();
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await readOptionalJsonBodyLimited(request, 65536);
    const summary = await runAutomationQueue({ businessId: clean(body.businessId), limit: Number(body.limit) || batchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function runAutomationQueue({ businessId = "", limit = batchSize() } = {}) {
  if ((await workspaceFeatureFlags()).automation === false) return { claimed: 0, sent: 0, scheduled: 0, completed: 0, handoff: 0, failed: 0, retried: 0, disabled: true };
  const jobs = await claimAutomationJobs({ businessId, limit: Math.max(1, Math.min(Number(limit) || batchSize(), 100)) });
  const summary = { claimed: jobs.length, sent: 0, scheduled: 0, completed: 0, handoff: 0, failed: 0, retried: 0 };

  for (const job of jobs) {
    try {
      if ((await workspaceFeatureFlags(job.business_id)).automation === false) {
        await query("UPDATE automation_jobs SET status='queued',locked_at=NULL,updated_at=NOW() WHERE id=$1", [job.job_id]);
        continue;
      }
      await processJob(job, summary);
      await query("UPDATE automation_jobs SET status = 'completed', completed_at = NOW(), error_message = '', updated_at = NOW() WHERE id = $1", [job.job_id]);
    } catch (error) {
      const nextAttempts = Number(job.attempts || 0) + 1;
      const shouldRetry = !job.noRetry && nextAttempts < Number(job.max_attempts || 3) && isRetryable(error);
      await query(
        `UPDATE automation_jobs
         SET status = $1, attempts = $2, run_at = NOW() + ($3 || ' minutes')::interval,
             locked_at = NULL, error_message = $4, updated_at = NOW()
         WHERE id = $5`,
        [shouldRetry ? "retry" : "failed", nextAttempts, String(Math.min(nextAttempts * 5, 30)), clean(error.message), job.job_id]
      );
      await query(
        `UPDATE automation_sessions
         SET last_error=$1,
             status=CASE WHEN $4='AUTOMATION_OPTED_OUT' THEN 'completed'
                         WHEN $4='AUTOMATION_SUPERSEDED' OR $2::boolean THEN status
                         ELSE 'failed' END,
             updated_at=NOW()
         WHERE id=$3 AND status='active'`,
        [clean(error.message), shouldRetry, job.session_id, error.code || ""]
      );
      if (shouldRetry) summary.retried += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

async function claimAutomationJobs({ businessId = "", limit }) {
  return transaction(async (client) => {
    const params = [limit];
    const businessFilter = businessId ? "AND j.business_id = $2" : "";
    if (businessId) params.push(businessId);
    const stale = await client.query(
      `SELECT j.id,j.session_id FROM automation_jobs j
       WHERE j.status='processing' AND j.locked_at < NOW() - INTERVAL '15 minutes'
         ${businessFilter}
       ORDER BY j.locked_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      params
    );
    if (stale.rows.length) {
      const warning = 'Delivery unconfirmed after worker interruption. Verify in Meta before retrying.';
      await client.query(
        "UPDATE automation_jobs SET status='failed',locked_at=NULL,completed_at=NOW(),updated_at=NOW(),error_message=$2 WHERE id=ANY($1)",
        [stale.rows.map((row) => row.id), warning]
      );
      await client.query(
        "UPDATE automation_sessions SET status='failed',last_error=$2,updated_at=NOW() WHERE id=ANY($1) AND status='active'",
        [stale.rows.map((row) => row.session_id), warning]
      );
    }
    const result = await client.query(
      `SELECT j.id AS job_id, j.session_id, j.attempts, j.max_attempts, j.input,
              s.current_node_id, s.context, s.contact_id, s.assigned_user_id,
              f.definition, f.name AS flow_name,
              c.name AS contact_name, c.phone, c.last_message_at,
              v.id AS conversation_id, v.automation_paused,
              v.whatsapp_phone_number_id AS conversation_phone_number_id,
              p.phone_number_id AS source_phone_number_id,
              a.waba_id AS source_waba_id, a.access_token_encrypted AS source_access_token_encrypted,
              b.id AS business_id, b.waba_id, b.waba_id AS default_waba_id, b.phone_number_id, b.access_token_encrypted
       FROM automation_jobs j
       JOIN automation_sessions s ON s.id = j.session_id
       JOIN automation_flows f ON f.id = s.flow_id
       JOIN contacts c ON c.id = s.contact_id
       JOIN businesses b ON b.id = j.business_id
       LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
       LEFT JOIN conversations v ON v.business_id = j.business_id AND v.contact_id = s.contact_id
       LEFT JOIN whatsapp_phone_numbers p ON p.business_id = b.id AND p.phone_number_id = v.whatsapp_phone_number_id
       LEFT JOIN whatsapp_accounts a ON a.id = p.whatsapp_account_id AND a.business_id = b.id
       WHERE j.status IN ('queued', 'retry') AND j.run_at <= NOW()
         AND b.account_status <> 'suspended'
         AND b.feature_overrides->>'automation' IS DISTINCT FROM 'false'
         AND NOT EXISTS (SELECT 1 FROM workspace_deletion_requests dr
                         WHERE dr.business_id = b.id AND dr.status IN ('scheduled', 'pending_approval'))
         AND s.status = 'active'
         AND f.status = 'active'
         AND COALESCE(v.automation_paused, FALSE) = FALSE
         ${process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED !== 'false' ? "AND (b.review_access = TRUE OR (bs.status = 'active' AND (bs.current_period_end IS NULL OR bs.current_period_end > NOW())) OR (bs.status = 'trialing' AND bs.trial_ends_at > NOW()))" : ""}
         ${businessFilter}
       ORDER BY j.run_at ASC, j.created_at ASC
       LIMIT $1
       FOR UPDATE OF j SKIP LOCKED`,
      params
    );
    const ids = result.rows.map((row) => row.job_id);
    if (ids.length) await client.query("UPDATE automation_jobs SET status = 'processing', locked_at = NOW(), updated_at = NOW() WHERE id = ANY($1)", [ids]);
    return result.rows;
  });
}

async function processJob(job, summary) {
  await assertAutomationDispatchAllowed({
    businessId: job.business_id, contactId: job.contact_id, sessionId: job.session_id
  });
  const sendJob = automationMessagingSetup(job);

  const definition = normalizeDefinition(job.definition);
  const input = job.input || {};
  const currentNode = getNode(definition, input.targetNodeId || job.current_node_id);
  let targetNode = currentNode;
  let context = job.context || {};
  if(context.commerceOrderId){
    const order=(await query('SELECT payment_status,fulfillment_status FROM whatsapp_orders WHERE id=$1 AND business_id=$2',[context.commerceOrderId,job.business_id])).rows[0];
    if(!order||(order.fulfillment_status==='cancelled'&&context.commerceFulfillmentStatus!=='cancelled')||(context.commerceFulfillmentStatus&&order.fulfillment_status!==context.commerceFulfillmentStatus)||(context.commerceUnpaidOnly&&['captured','partially_refunded','refunded'].includes(order.payment_status)))throw new AppError('Commerce follow-up is no longer applicable.',409,'COMMERCE_FOLLOWUP_STOPPED');
  }

  if (input.phase !== "start" && input.phase !== "scheduled") {
    const decision = chooseNextNode(currentNode, input, definition);
    if (!decision.nextNode && decision.repeat) {
      targetNode = { ...currentNode, body: currentNode.fallback || currentNode.body };
    } else if (decision.nextNode) {
      targetNode = decision.nextNode;
      context = { ...context, ...decision.context };
    }
  }

  if (targetNode.delayMinutes > 0 && input.phase !== "scheduled") {
    await scheduleNode({ job, node: targetNode, context, delayMinutes: targetNode.delayMinutes });
    summary.scheduled += 1;
    return;
  }

  if (ADVANCED_NODE_TYPES.includes(targetNode.type)) {
    job.noRetry = true;
    const guard = () => assertAutomationDispatchAllowed({ businessId: job.business_id, contactId: job.contact_id, sessionId: job.session_id });
    const orderQuery = `SELECT o.* FROM whatsapp_orders o JOIN whatsapp_phone_numbers p ON p.id=o.phone_id AND p.business_id=o.business_id
      WHERE o.id=$1 AND o.business_id=$2 AND o.customer_phone=$3 AND p.phone_number_id=$4`;
    const orderParams = orderId => [orderId, job.business_id, job.phone, sendJob.phone_number_id];
    const outcome = await executeAdvancedNode({ node: targetNode, context, effects: {
      guard,
      attributes: async () => (await query('SELECT custom_attributes FROM contacts WHERE id=$1 AND business_id=$2', [job.contact_id, job.business_id])).rows[0]?.custom_attributes || {},
      setAttribute: async (key, value) => {
        await guard();
        const changed = await query(`UPDATE contacts SET custom_attributes=jsonb_set(custom_attributes,ARRAY[$1]::text[],$2::jsonb,true),updated_at=NOW()
          WHERE id=$3 AND business_id=$4 AND octet_length((custom_attributes || jsonb_build_object($1::text,$2::jsonb))::text)<=16384 RETURNING id`, [key, JSON.stringify(value), job.contact_id, job.business_id]);
        if (!changed.rowCount) throw new AppError('Contact attribute update unavailable or too large.', 400, 'AUTOMATION_ATTRIBUTE_LIMIT');
      },
      request: (connectionId, fields) => requestOutboundConnection({ businessId: job.business_id, connectionId, fields, guard }),
      order: async orderId => {
        const order = (await query(orderQuery, orderParams(orderId))).rows[0];
        if (!order) throw new AppError('Order unavailable for this customer and number.', 404, 'AUTOMATION_ORDER_NOT_FOUND');
        return { id: order.id, currency: order.currency, total_amount: String(order.total_amount), payment_status: order.payment_status, fulfillment_status: order.fulfillment_status };
      },
      setOrderStatus: async (orderId, status) => {
        await guard();
        await transaction(async client => {
          const order = (await client.query(orderQuery + ' FOR UPDATE OF o', orderParams(orderId))).rows[0];
          if (!order) throw new AppError('Order unavailable.', 404, 'AUTOMATION_ORDER_NOT_FOUND');
          if (!canTransitionOrder(order.fulfillment_status, status, order.payment_status)) throw new AppError('Invalid order transition.', 400, 'AUTOMATION_ORDER_TRANSITION_INVALID');
          await client.query('UPDATE whatsapp_orders SET fulfillment_status=$1,updated_at=NOW() WHERE id=$2 AND business_id=$3', [status, order.id, job.business_id]);
          await client.query("INSERT INTO audit_logs (id,business_id,action,metadata) VALUES ($1,$2,'automation_order_fulfillment',$3)", [id('a'), job.business_id, JSON.stringify({ orderId, from: order.fulfillment_status, to: status, sessionId: job.session_id })]);
        });
      }
    } });
    await guard();
    const nextNode = getNode(definition, outcome.next);
    await scheduleNode({ job, node: nextNode, context: outcome.context, delayMinutes: nextNode.delayMinutes || 0 });
    summary.scheduled += 1;
    return;
  }

  if (targetNode.type !== "template" && targetNode.body && !insideReplyWindow(job.last_message_at)) {
    throw new AppError("Automation can only send free-form replies inside the 24-hour WhatsApp reply window. Use a template node for delayed follow-ups.", 403, "REPLY_WINDOW_CLOSED");
  }

  await sendNodeMessage({ job: sendJob, node: targetNode, context });
  const status = targetNode.type === "handoff" ? "handoff" : targetNode.type === "end" ? "completed" : "active";
  await query(
    `UPDATE automation_sessions
     SET current_node_id = $1, context = $2, status = $3, human_takeover = $4,
         assigned_user_id = COALESCE($5, assigned_user_id), last_input = $6, last_error = '', updated_at = NOW(),
         ended_at = CASE WHEN $3 IN ('handoff', 'completed') THEN NOW() ELSE ended_at END
     WHERE id = $7`,
    [targetNode.id, JSON.stringify(context), status, status === "handoff", targetNode.assignedUserId || null, clean(input.text || input.value || input.title), job.session_id]
  );
  if (status === "handoff") {
    await query("UPDATE conversations SET automation_paused = TRUE, assigned_user_id = COALESCE($1, assigned_user_id), updated_at = NOW() WHERE business_id = $2 AND contact_id = $3", [targetNode.assignedUserId || job.assigned_user_id || null, job.business_id, job.contact_id]);
  }
  await query("INSERT INTO events (id, business_id, type, contact_id, metadata) VALUES ($1, $2, 'automation_step_sent', $3, $4)", [id("e"), job.business_id, job.contact_id, JSON.stringify({ flow: job.flow_name, nodeId: targetNode.id, status })]);
  summary.sent += 1;
  if (status === "completed") summary.completed += 1;
  if (status === "handoff") summary.handoff += 1;

  if (status === "active" && targetNode.inputKind === "none" && targetNode.next) {
    const nextNode = getNode(definition, targetNode.next);
    await scheduleNode({ job, node: nextNode, context, delayMinutes: nextNode.delayMinutes || 0 });
    summary.scheduled += 1;
  }
}

function chooseNextNode(node, input, definition) {
  const options = Array.isArray(node.options) ? node.options : [];
  const value = normalize(input.value || input.buttonId || input.listId || input.text || input.title);
  const title = normalize(input.title || input.text);
  const matched = options.find((option, index) => {
    const candidates = [option.id, option.value, option.label, option.title, String(index + 1), ...(Array.isArray(option.match) ? option.match : [])].map(normalize).filter(Boolean);
    return candidates.includes(value) || candidates.includes(title);
  });
  if (matched?.next) {
    return {
      nextNode: getNode(definition, matched.next),
      context: { [node.captureAs || `${node.id}Selection`]: matched.value || matched.id || matched.label || matched.title || input.text || "" }
    };
  }
  if (node.inputKind === "text" && node.next) {
    return {
      nextNode: getNode(definition, node.next),
      context: { [node.captureAs || `${node.id}Text`]: input.text || input.value || "" }
    };
  }
  return { nextNode: null, repeat: true, context: {} };
}

async function scheduleNode({ job, node, context, delayMinutes = 0 }) {
  await transaction(async client => {
  await client.query(
    `UPDATE automation_sessions
     SET current_node_id = $1, context = $2, updated_at = NOW()
     WHERE id = $3`,
    [node.id, JSON.stringify(context), job.session_id]
  );
  await client.query(
    `INSERT INTO automation_jobs (id, business_id, session_id, input, run_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
    [id("aj"), job.business_id, job.session_id, JSON.stringify({ phase: "scheduled", targetNodeId: node.id }), String(Math.max(0, Number(delayMinutes) || 0))]
  );
  await client.query("INSERT INTO events (id, business_id, type, contact_id, metadata) VALUES ($1, $2, 'automation_step_scheduled', $3, $4)", [id("e"), job.business_id, job.contact_id, JSON.stringify({ flow: job.flow_name, nodeId: node.id, delayMinutes })]);
  });
}

async function sendNodeMessage({ job, node, context }) {
  if (node.type === "template") return sendTemplateNode({ job, node, context });
  const body = renderBody(node.body || "", { name: job.contact_name, ...context });
  if (!body) return;
  if (!metaReady(job)) throw new AppError('Meta WhatsApp credentials are required.', 400, 'META_NOT_CONFIGURED');
  await assertMessageCapacity(job.business_id, 1, null, job.contact_id);
  const options = (Array.isArray(node.options) ? node.options : []).map((option) => ({ id: option.id || option.value || option.label, label: option.label || option.title || option.id, description: option.description || "" }));
  await assertNodeDispatch(job, true);
  const conversationId = await findOrCreateConversation(job.business_id, job.contact_id);
  await cancelPendingAiReply(job.business_id,conversationId);
  const meta = options.length
    ? await sendInteractiveMessage({ setup: job, to: job.phone, body, options, mode: node.inputKind, buttonText: node.buttonText, sectionTitle: node.sectionTitle })
    : await sendTextMessage({ setup: job, to: job.phone, body });
  await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, body, meta.status, meta.metaMessageId]);
}

async function sendTemplateNode({ job, node, context }) {
  const template = node.templateId
    ? (await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2 AND status = 'Approved'", [node.templateId, job.business_id])).rows[0]
    : (await query("SELECT * FROM templates WHERE business_id = $1 AND meta_template_name = $2 AND status = 'Approved' AND (waba_id=$3 OR (waba_id='' AND $3=$4)) ORDER BY created_at DESC,id DESC LIMIT 1", [job.business_id, node.templateName, job.waba_id, job.default_waba_id])).rows[0];
  if (!template) throw new AppError("Automation template node requires an approved template.", 400, "TEMPLATE_NOT_FOUND");
  if ((template.waba_id && template.waba_id !== job.waba_id) || (!template.waba_id && job.waba_id !== job.default_waba_id)) throw new AppError('Automation template belongs to another WhatsApp account.',409,'TEMPLATE_WABA_MISMATCH');
  const contact=(await query('SELECT marketing_permission,unsubscribed FROM contacts WHERE id=$1 AND business_id=$2',[job.contact_id,job.business_id])).rows[0];
  if(!contact||contact.unsubscribed||(template.category==='MARKETING'&&!contact.marketing_permission))throw new AppError('Contact has not consented to this automated message.',403,'AUTOMATION_CONSENT_REQUIRED');
  validateTemplateParameters(template,node.templateParameters||{});
  await assertMessageCapacity(job.business_id, 1, null, job.contact_id);
  const checkout = context.providerCheckoutId ? (await query(`SELECT data->>'checkoutUrlEncrypted' AS encrypted_url FROM provider_connector_records
    WHERE business_id=$1 AND connector_id=$2 AND resource='checkout' AND external_id=$3`,
    [job.business_id,context.providerConnectorId,context.providerCheckoutId])).rows[0] : null;
  const values = { name: job.contact_name, ...context, ...(checkout?.encrypted_url ? { checkoutUrl: decryptSecret(checkout.encrypted_url) } : {}) };
  const variables=(template.variables||[]).map(key=>renderBody(String(node.templateValues?.[key]??values[key]??''),values));
  if(variables.some(value=>!value.trim()))throw new AppError('Provide values for every template variable.',400,'TEMPLATE_VARIABLE_REQUIRED');
  await assertNodeDispatch(job, false, template.category);
  const conversationId = await findOrCreateConversation(job.business_id, job.contact_id);
  await cancelPendingAiReply(job.business_id,conversationId);
  const meta = await sendTemplateMessage({
    setup: job,
    to: job.phone,
    templateName: template.meta_template_name || templateApiName(template.name),
    language: template.language,
    parameters: node.templateParameters||{},
    variables
  });
  const body = node.body ? renderBody(node.body, values) : renderBody(template.body, values);
  await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, body, meta.status, meta.metaMessageId]);
}

function flowMatchesTrigger(flow, input) {
  if (flow.trigger_mode === "manual") return false;
  if (flow.trigger_mode === "any_inbound") return true;
  const keywords = Array.isArray(flow.trigger_keywords) ? flow.trigger_keywords : [];
  const text = normalize(input?.text || input?.value || input?.title);
  return keywords.map(normalize).filter(Boolean).some((keyword) => text === keyword || text.includes(keyword));
}

function normalizeFlowInput(body) {
  const name = clean(body.name);
  if (!name) throw new AppError("Flow name is required.", 400, "VALIDATION_ERROR");
  const triggerMode = ["keywords", "any_inbound", "manual"].includes(body.triggerMode) ? body.triggerMode : "keywords";
  const status = ["draft", "active", "paused"].includes(body.status) ? body.status : "draft";
  const triggerKeywords = Array.isArray(body.triggerKeywords) ? body.triggerKeywords.map(clean).filter(Boolean) : splitKeywords(body.triggerKeywords);
  const definition = normalizeDefinition(parseDefinitionInput(body.definition));
  if (triggerMode === "keywords" && !triggerKeywords.length) throw new AppError("Add at least one trigger keyword or choose a different trigger mode.", 400, "VALIDATION_ERROR");
  return { name, description: clean(body.description), status, triggerMode, triggerKeywords, definition };
}

function parseDefinitionInput(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new AppError("Flow definition must be valid JSON.", 400, "VALIDATION_ERROR");
  }
}

export function normalizeDefinition(definition) {
  const value = definition && typeof definition === "object" ? definition : {};
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeNode).filter(Boolean) : [];
  const ids = new Set(nodes.map((node) => node.id));
  const startNodeId = clean(value.startNodeId || nodes[0]?.id);
  if (!nodes.length) throw new AppError("Flow definition must include at least one node.", 400, "VALIDATION_ERROR");
  if (nodes.length > 200 || ids.size !== nodes.length) throw new AppError('Flows require unique node IDs and at most 200 nodes.', 400, 'VALIDATION_ERROR');
  if (!startNodeId || !ids.has(startNodeId)) throw new AppError("Flow startNodeId must match one of the node IDs.", 400, "VALIDATION_ERROR");
  for (const node of nodes) {
    for (const branch of [node.errorNext, node.falseNext]) {
      if (branch && !ids.has(branch)) throw new AppError(`Node ${node.id} points to a missing branch.`, 400, 'VALIDATION_ERROR');
    }
    if (node.next && !ids.has(node.next)) throw new AppError(`Node ${node.id} points to a missing next node.`, 400, "VALIDATION_ERROR");
    for (const option of node.options) {
      if (option.next && !ids.has(option.next)) throw new AppError(`Option ${option.id} points to a missing next node.`, 400, "VALIDATION_ERROR");
    }
  }
  const visiting = new Set(), visited = new Set();
  const visit = nodeId => {
    if (visiting.has(nodeId)) throw new AppError('Automatic node cycles are not allowed.', 400, 'VALIDATION_ERROR');
    if (visited.has(nodeId)) return;
    const node = nodes.find(item => item.id === nodeId);
    visiting.add(nodeId);
    if (ADVANCED_NODE_TYPES.includes(node.type)) for (const branch of new Set([node.next, node.falseNext, node.errorNext].filter(Boolean))) visit(branch);
    else if (node.inputKind === 'none' && !['end', 'handoff'].includes(node.type) && node.next) visit(node.next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id);
  return { startNodeId, nodes };
}

function normalizeNode(node) {
  const nodeId = clean(node.id);
  if (!nodeId) return null;
  const type = ["question", "message", "template", "handoff", "end", ...ADVANCED_NODE_TYPES].includes(node.type) ? node.type : "question";
  const inputKind = ["buttons", "list", "text", "none"].includes(node.inputKind || node.input) ? (node.inputKind || node.input) : "text";
  const options = Array.isArray(node.options) ? node.options.map((option, index) => normalizeOption(option, index)).filter(Boolean) : [];
  return {
    id: nodeId,
    type,
    body: clean(node.body || node.message),
    inputKind,
    options,
    next: clean(node.next),
    fallback: clean(node.fallback),
    captureAs: clean(node.captureAs),
    buttonText: clean(node.buttonText),
    sectionTitle: clean(node.sectionTitle),
    templateId: clean(node.templateId),
    templateName: clean(node.templateName),
    templateParameters: node.templateParameters&&typeof node.templateParameters==='object'&&!Array.isArray(node.templateParameters)?node.templateParameters:{},
    templateValues: node.templateValues&&typeof node.templateValues==='object'&&!Array.isArray(node.templateValues)?node.templateValues:{},
    assignedUserId: clean(node.assignedUserId),
    delayMinutes: Math.max(0, Number(node.delayMinutes) || 0),
    ...normalizeAdvancedNode(node)
  };
}

function normalizeOption(option, index) {
  const optionId = clean(option.id || option.value || `option_${index + 1}`);
  const label = clean(option.label || option.title || optionId);
  if (!optionId || !label) return null;
  return {
    id: optionId,
    label,
    value: clean(option.value || optionId),
    description: clean(option.description),
    match: Array.isArray(option.match) ? option.match.map(clean).filter(Boolean) : [],
    next: clean(option.next)
  };
}

function getNode(definition, nodeId) {
  const node = definition.nodes.find((item) => item.id === nodeId);
  if (!node) throw new AppError("Automation flow node was not found.", 400, "FLOW_NODE_NOT_FOUND");
  return node;
}

function splitKeywords(value) {
  return String(value || "").split(/[,\n]/).map(clean).filter(Boolean);
}

function renderBody(body, values) {
  return String(body || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => clean(values[key]) || "");
}

function insideReplyWindow(value) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= REPLY_WINDOW_MS;
}

function isOptOut(value) {
  return /^(stop|unsubscribe|opt out)$/i.test(clean(value));
}

async function findOrCreateConversation(businessId, contactId) {
  const existing = await query("SELECT id FROM conversations WHERE business_id = $1 AND contact_id = $2", [businessId, contactId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const conversationId = id("v");
  await query("INSERT INTO conversations (id, business_id, contact_id) VALUES ($1, $2, $3)", [conversationId, businessId, contactId]);
  return conversationId;
}

function isRetryable(error) {
  if (error?.noRetry) return false;
  const status = Number(error?.status || 0);
  return status === 429;
}

async function assertNodeDispatch(job, freeForm, category) {
  await assertAutomationDispatchAllowed({ businessId: job.business_id, contactId: job.contact_id, sessionId: job.session_id,
    messageType: freeForm ? 'freeform' : 'template', category });
}

function mapFlow(row) {
  const definition = normalizeDefinition(row.definition);
  const completed = row.completed_sessions || 0;
  const handoff = row.handoff_sessions || 0;
  const failed = row.failed_sessions || 0;
  const totalClosed = completed + handoff + failed;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    status: row.status,
    triggerMode: row.trigger_mode,
    triggerKeywords: row.trigger_keywords || [],
    definition,
    nodeCount: definition.nodes.length,
    activeSessions: row.active_sessions || 0,
    completedSessions: completed,
    handoffSessions: handoff,
    failedSessions: failed,
    pendingJobs: row.pending_jobs || 0,
    completionRate: totalClosed ? Math.round((completed / totalClosed) * 100) : 0,
    lastActivityAt: toIso(row.last_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
