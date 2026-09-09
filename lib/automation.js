import { currentAccount, requireSession } from "./auth";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { assertAutomationFlowCapacity, assertMessageCapacity } from "./limits";
import { metaReady, sendInteractiveMessage, sendTemplateMessage, sendTextMessage, templateApiName } from "./meta";

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

export async function listAutomationFlows(businessId) {
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
     LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM automation_jobs j WHERE j.business_id = f.business_id AND j.status IN ('queued', 'retry')) pending_jobs ON TRUE
     LEFT JOIN LATERAL (SELECT MAX(s.updated_at) AS last_at FROM automation_sessions s WHERE s.flow_id = f.id) latest_session ON TRUE
     WHERE f.business_id = $1 AND f.status <> 'archived'
     ORDER BY f.updated_at DESC`,
    [businessId]
  );
  return result.rows.map(mapFlow);
}

export async function getAutomationFlows(request) {
  try {
    const account = await currentAccount(request);
    return json({ flows: await listAutomationFlows(account.business.id) });
  } catch (error) {
    return errorJson(error);
  }
}

export async function saveAutomationFlow(request, context = {}) {
  try {
    const account = await currentAccount(request);
    const params = context?.params ? await context.params : {};
    const body = await request.json();
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
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
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
    const body = await request.json().catch(() => ({}));
    const summary = await runAutomationQueue({ businessId: session.businessId, limit: Number(body.limit) || batchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processAutomationQueueJob(request) {
  try {
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await request.json().catch(() => ({}));
    const summary = await runAutomationQueue({ businessId: clean(body.businessId), limit: Number(body.limit) || batchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function runAutomationQueue({ businessId = "", limit = batchSize() } = {}) {
  const jobs = await claimAutomationJobs({ businessId, limit: Math.max(1, Math.min(Number(limit) || batchSize(), 100)) });
  const summary = { claimed: jobs.length, sent: 0, scheduled: 0, completed: 0, handoff: 0, failed: 0, retried: 0 };

  for (const job of jobs) {
    try {
      await processJob(job, summary);
      await query("UPDATE automation_jobs SET status = 'completed', completed_at = NOW(), error_message = '', updated_at = NOW() WHERE id = $1", [job.job_id]);
    } catch (error) {
      const nextAttempts = Number(job.attempts || 0) + 1;
      const shouldRetry = nextAttempts < Number(job.max_attempts || 3) && isRetryable(error);
      await query(
        `UPDATE automation_jobs
         SET status = $1, attempts = $2, run_at = NOW() + ($3 || ' minutes')::interval,
             locked_at = NULL, error_message = $4, updated_at = NOW()
         WHERE id = $5`,
        [shouldRetry ? "retry" : "failed", nextAttempts, String(Math.min(nextAttempts * 5, 30)), clean(error.message), job.job_id]
      );
      await query("UPDATE automation_sessions SET last_error = $1, status = CASE WHEN $2::boolean THEN status ELSE 'failed' END, updated_at = NOW() WHERE id = $3", [clean(error.message), shouldRetry, job.session_id]);
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
    const result = await client.query(
      `SELECT j.id AS job_id, j.session_id, j.attempts, j.max_attempts, j.input,
              s.current_node_id, s.context, s.contact_id, s.assigned_user_id,
              f.definition, f.name AS flow_name,
              c.name AS contact_name, c.phone, c.last_message_at,
              v.id AS conversation_id, v.automation_paused,
              b.id AS business_id, b.waba_id, b.phone_number_id, b.access_token_encrypted
       FROM automation_jobs j
       JOIN automation_sessions s ON s.id = j.session_id
       JOIN automation_flows f ON f.id = s.flow_id
       JOIN contacts c ON c.id = s.contact_id
       JOIN businesses b ON b.id = j.business_id
       LEFT JOIN conversations v ON v.business_id = j.business_id AND v.contact_id = s.contact_id
       WHERE ((j.status IN ('queued', 'retry') AND j.run_at <= NOW())
          OR (j.status = 'processing' AND j.locked_at < NOW() - INTERVAL '15 minutes'))
         AND s.status = 'active'
         AND f.status = 'active'
         AND COALESCE(v.automation_paused, FALSE) = FALSE
         ${businessFilter}
       ORDER BY j.run_at ASC, j.created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      params
    );
    const ids = result.rows.map((row) => row.job_id);
    if (ids.length) await client.query("UPDATE automation_jobs SET status = 'processing', locked_at = NOW(), updated_at = NOW() WHERE id = ANY($1)", [ids]);
    return result.rows;
  });
}

async function processJob(job, summary) {
  if (!metaReady(job)) throw new AppError("Meta WhatsApp credentials are required before automation can send messages.", 400, "META_NOT_CONFIGURED");

  const definition = normalizeDefinition(job.definition);
  const input = job.input || {};
  const currentNode = getNode(definition, input.targetNodeId || job.current_node_id);
  let targetNode = currentNode;
  let context = job.context || {};

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

  if (targetNode.type !== "template" && !insideReplyWindow(job.last_message_at)) {
    throw new AppError("Automation can only send free-form replies inside the 24-hour WhatsApp reply window. Use a template node for delayed follow-ups.", 403, "REPLY_WINDOW_CLOSED");
  }

  await sendNodeMessage({ job, node: targetNode, context });
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
  await query(
    `UPDATE automation_sessions
     SET current_node_id = $1, context = $2, updated_at = NOW()
     WHERE id = $3`,
    [node.id, JSON.stringify(context), job.session_id]
  );
  await query(
    `INSERT INTO automation_jobs (id, business_id, session_id, input, run_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)`,
    [id("aj"), job.business_id, job.session_id, JSON.stringify({ phase: "scheduled", targetNodeId: node.id }), String(Math.max(0, Number(delayMinutes) || 0))]
  );
  await query("INSERT INTO events (id, business_id, type, contact_id, metadata) VALUES ($1, $2, 'automation_step_scheduled', $3, $4)", [id("e"), job.business_id, job.contact_id, JSON.stringify({ flow: job.flow_name, nodeId: node.id, delayMinutes })]);
}

async function sendNodeMessage({ job, node, context }) {
  if (node.type === "template") return sendTemplateNode({ job, node, context });
  const body = renderBody(node.body || "", { name: job.contact_name, ...context });
  if (!body) return;
  await assertMessageCapacity(job.business_id, 1);
  const options = (Array.isArray(node.options) ? node.options : []).map((option) => ({ id: option.id || option.value || option.label, label: option.label || option.title || option.id, description: option.description || "" }));
  const meta = options.length
    ? await sendInteractiveMessage({ setup: job, to: job.phone, body, options, mode: node.inputKind, buttonText: node.buttonText, sectionTitle: node.sectionTitle })
    : await sendTextMessage({ setup: job, to: job.phone, body });
  const conversationId = await findOrCreateConversation(job.business_id, job.contact_id);
  await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, body, meta.status, meta.metaMessageId]);
}

async function sendTemplateNode({ job, node, context }) {
  const template = node.templateId
    ? (await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2 AND status = 'Approved'", [node.templateId, job.business_id])).rows[0]
    : (await query("SELECT * FROM templates WHERE business_id = $1 AND meta_template_name = $2 AND status = 'Approved'", [job.business_id, node.templateName])).rows[0];
  if (!template) throw new AppError("Automation template node requires an approved template.", 400, "TEMPLATE_NOT_FOUND");
  await assertMessageCapacity(job.business_id, 1);
  const values = { name: job.contact_name, ...context };
  const meta = await sendTemplateMessage({
    setup: job,
    to: job.phone,
    templateName: template.meta_template_name || templateApiName(template.name),
    language: template.language,
    variables: (template.variables || []).map((key) => renderBody(values[key] || "", values))
  });
  const body = node.body ? renderBody(node.body, values) : renderBody(template.body, values);
  const conversationId = await findOrCreateConversation(job.business_id, job.contact_id);
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

function normalizeDefinition(definition) {
  const value = definition && typeof definition === "object" ? definition : {};
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeNode).filter(Boolean) : [];
  const ids = new Set(nodes.map((node) => node.id));
  const startNodeId = clean(value.startNodeId || nodes[0]?.id);
  if (!nodes.length) throw new AppError("Flow definition must include at least one node.", 400, "VALIDATION_ERROR");
  if (!startNodeId || !ids.has(startNodeId)) throw new AppError("Flow startNodeId must match one of the node IDs.", 400, "VALIDATION_ERROR");
  for (const node of nodes) {
    if (node.next && !ids.has(node.next)) throw new AppError(`Node ${node.id} points to a missing next node.`, 400, "VALIDATION_ERROR");
    for (const option of node.options) {
      if (option.next && !ids.has(option.next)) throw new AppError(`Option ${option.id} points to a missing next node.`, 400, "VALIDATION_ERROR");
    }
  }
  return { startNodeId, nodes };
}

function normalizeNode(node) {
  const nodeId = clean(node.id);
  if (!nodeId) return null;
  const type = ["question", "message", "template", "handoff", "end"].includes(node.type) ? node.type : "question";
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
    assignedUserId: clean(node.assignedUserId),
    delayMinutes: Math.max(0, Number(node.delayMinutes) || 0)
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
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500;
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
