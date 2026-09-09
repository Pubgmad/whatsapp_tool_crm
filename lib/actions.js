import crypto from "crypto";
import { currentAccount, requireSession } from "./auth";
import { enqueueAutomationForIncoming, listAutomationFlows, runAutomationQueue } from "./automation";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { assertCampaignCapacity, assertContactCapacity, assertMessageCapacity, subscriptionUsage } from "./limits";
import { createWhatsAppTemplate, encryptSecret, fetchWhatsAppMedia, listWhatsAppTemplates, metaReady, sendTemplateMessage, sendTextMessage, templateApiName } from "./meta";
import { getPublicPlatformConfig } from "./platform";
import { listAudienceSegments, resolveSegmentContactIds } from "./segments";

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function getState(request) {
  try {
    const account = await currentAccount(request);
    return json(await loadState(account));
  } catch (error) {
    return errorJson(error);
  }
}

export async function getMe(request) {
  try {
    return json(await currentAccount(request));
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateSetup(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const mode = "Live Meta";
    const phoneNumberId = clean(body.phoneNumberId);
    const wabaId = clean(body.wabaId);
    const accessToken = clean(body.accessToken);

    const current = await query("SELECT access_token_encrypted FROM businesses WHERE id = $1", [session.businessId]);
    const storedToken = current.rows[0]?.access_token_encrypted || "";
    const nextToken = accessToken && accessToken !== "saved-token-hidden" ? encryptSecret(accessToken) : storedToken;
    const status = phoneNumberId && wabaId && nextToken ? "Connected" : "Needs setup";

    await query(
      `UPDATE businesses
       SET name = $1, whatsapp_number = $2, waba_id = $3, phone_number_id = $4,
           access_token_encrypted = $5, webhook_url = $6, mode = $7, status = $8, updated_at = NOW()
       WHERE id = $9`,
      [clean(body.businessName), clean(body.whatsappNumber), wabaId, phoneNumberId, nextToken, clean(body.webhookUrl), mode, status, session.businessId]
    );
    await audit(session, "setup_updated", { mode, status });
    return json(await loadState(await currentAccount(request)));
  } catch (error) {
    return errorJson(error);
  }
}

export async function createContact(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const name = clean(body.name);
    const phone = cleanPhone(body.phone);
    const marketingPermission = Boolean(body.marketingPermission);
    const tags = normalizeTags(body.tags);
    const optInSource = clean(body.optInSource) || "Manual";
    if (!name || !phone) throw new AppError("Name and phone are required.", 400, "VALIDATION_ERROR");

    const existing = await query("SELECT id FROM contacts WHERE business_id = $1 AND phone = $2", [session.businessId, phone]);
    if (!existing.rows[0]) await assertContactCapacity(session.businessId, 1);

    await query(
      `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source, tags, opt_in_at, opt_in_source)
       VALUES ($1, $2, $3, $4, $5, $6, 'Manual', $7, $8, $9)
       ON CONFLICT (business_id, phone) DO UPDATE
       SET name = EXCLUDED.name, marketing_permission = EXCLUDED.marketing_permission,
           unsubscribed = EXCLUDED.unsubscribed, tags = EXCLUDED.tags, opt_in_at = EXCLUDED.opt_in_at,
           opt_in_source = EXCLUDED.opt_in_source, updated_at = NOW()`,
      [id("c"), session.businessId, name, phone, marketingPermission, !marketingPermission, JSON.stringify(tags), marketingPermission ? new Date() : null, optInSource]
    );
    await audit(session, "contact_saved", { phone });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function importContacts(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const rows = parseCsvRows(body.csv || "");
    const validRows = [];
    let skipped = 0;

    for (const cells of rows) {
      const [first = "", second = "", third = "", fourth = ""] = cells.map((cell) => clean(cell));
      if (isHeaderRow(first, second, third)) continue;
      const rawName = first;
      const phone = cleanPhone(second);
      if (!rawName || !phone) {
        skipped += 1;
        continue;
      }
      validRows.push({ name: rawName, phone, allowed: permissionFromCell(third || "yes"), tags: normalizeTags(fourth) });
    }

    if (!validRows.length) throw new AppError("No valid contacts found. Use columns: name, phone, permission.", 400, "CSV_EMPTY");

    const existing = await query("SELECT phone FROM contacts WHERE business_id = $1 AND phone = ANY($2)", [session.businessId, validRows.map((row) => row.phone)]);
    const existingPhones = new Set(existing.rows.map((row) => row.phone));
    const newPhones = new Set(validRows.map((row) => row.phone).filter((phone) => !existingPhones.has(phone)));
    await assertContactCapacity(session.businessId, newPhones.size);

    for (const row of validRows) {
      await query(
        `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source, tags, opt_in_at, opt_in_source)
         VALUES ($1, $2, $3, $4, $5, $6, 'CSV import', $7, $8, 'CSV import')
         ON CONFLICT (business_id, phone) DO UPDATE
         SET name = EXCLUDED.name, marketing_permission = EXCLUDED.marketing_permission,
             unsubscribed = EXCLUDED.unsubscribed, source = 'CSV import', tags = EXCLUDED.tags,
             opt_in_at = EXCLUDED.opt_in_at, opt_in_source = 'CSV import', updated_at = NOW()`,
        [id("c"), session.businessId, row.name, row.phone, row.allowed, !row.allowed, JSON.stringify(row.tags), row.allowed ? new Date() : null]
      );
    }

    await audit(session, "contacts_imported", { imported: validRows.length, skipped });
    const nextState = await loadState(await currentAccount(request));
    return json({ ...nextState, importSummary: { imported: validRows.length, skipped } }, 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function patchContact(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const existing = await query("SELECT id FROM contacts WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    if (!existing.rows[0]) throw new AppError("Contact not found.", 404, "NOT_FOUND");

    const name = body.name === undefined ? null : clean(body.name);
    const phone = body.phone === undefined ? null : cleanPhone(body.phone);
    if (name === "" || phone === "") throw new AppError("Name and phone cannot be empty.", 400, "VALIDATION_ERROR");
    const marketingPermission = typeof body.marketingPermission === "boolean" ? body.marketingPermission : null;
    const unsubscribed = typeof body.unsubscribed === "boolean" ? body.unsubscribed : null;
    const tags = body.tags === undefined ? null : JSON.stringify(normalizeTags(body.tags));
    const customAttributes = body.customAttributes === undefined ? null : JSON.stringify(normalizeAttributes(body.customAttributes));
    const optInSource = body.optInSource === undefined ? null : clean(body.optInSource);

    await query(
      `UPDATE contacts
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           marketing_permission = COALESCE($3, marketing_permission),
           unsubscribed = COALESCE($4, unsubscribed),
           tags = COALESCE($5::jsonb, tags),
           custom_attributes = COALESCE($6::jsonb, custom_attributes),
           opt_in_source = COALESCE(NULLIF($7, ''), opt_in_source),
           opt_in_at = CASE WHEN $3 IS TRUE THEN COALESCE(opt_in_at, NOW()) WHEN $3 IS FALSE THEN NULL ELSE opt_in_at END,
           updated_at = NOW()
       WHERE id = $8 AND business_id = $9`,
      [name, phone, marketingPermission, unsubscribed, tags, customAttributes, optInSource, params.id, session.businessId]
    );
    await audit(session, "contact_updated", { contactId: params.id });
    return json(await loadState(await currentAccount(request)));
  } catch (error) {
    return errorJson(error);
  }
}

export async function exportContacts(request) {
  try {
    const session = await requireSession(request);
    const result = await query(
      "SELECT name, phone, marketing_permission, unsubscribed, tags, custom_attributes, source, opt_in_source, opt_in_at, created_at FROM contacts WHERE business_id = $1 ORDER BY created_at DESC",
      [session.businessId]
    );
    const header = ["name", "phone", "marketing_permission", "unsubscribed", "tags", "custom_attributes", "source", "opt_in_source", "opt_in_at", "created_at"]
      .map(csvCell).join(",");
    const rows = result.rows.map((row) => [
      row.name, row.phone, row.marketing_permission, row.unsubscribed,
      (row.tags || []).join("|"), JSON.stringify(row.custom_attributes || {}), row.source, row.opt_in_source,
      toIso(row.opt_in_at), toIso(row.created_at)
    ].map(csvCell).join(","));
    return new Response([header, ...rows].join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function deleteContact(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    await query("DELETE FROM contacts WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    await audit(session, "contact_deleted", { contactId: params.id });
    return json(await loadState(await currentAccount(request)));
  } catch (error) {
    return errorJson(error);
  }
}

export async function createTemplate(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const name = clean(body.name);
    const templateBody = clean(body.body);
    const headerText = clean(body.headerText).slice(0, 60);
    const footerText = clean(body.footerText).slice(0, 60);
    const buttons = normalizeTemplateButtons(body.buttons);
    const category = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(clean(body.category).toUpperCase()) ? clean(body.category).toUpperCase() : "MARKETING";
    const language = clean(body.language) || "en_US";
    if (!name || !templateBody) throw new AppError("Template name and body are required.", 400, "VALIDATION_ERROR");
    if (/{{/.test(headerText)) throw new AppError("Dynamic variables are supported in the template body, not the text header.", 400, "VALIDATION_ERROR");
    const submitToMeta = Boolean(body.submitToMeta);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const metaTemplate = submitToMeta
      ? await createWhatsAppTemplate({ setup: business, name, body: templateBody, category, language, headerText, footerText, buttons })
      : { id: "", name: templateApiName(name), status: "DRAFT" };
    await query(
      `INSERT INTO templates (id, business_id, name, category, language, header_text, body, footer_text, buttons, variables, status, meta_template_id, meta_template_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [id("t"), session.businessId, name, category, language, headerText, templateBody, footerText, JSON.stringify(buttons), JSON.stringify(templateVariables(templateBody)), submitToMeta ? normalizeTemplateStatus(metaTemplate.status) : "Draft", metaTemplate.id, metaTemplate.name, submitToMeta ? "Meta submission" : "Manual draft"]
    );
    await audit(session, "template_created", { name, submitToMeta });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) { return errorJson(error); }
}

export async function syncTemplatesFromMeta(request) {
  try {
    const session = await requireSession(request);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const templates = await listWhatsAppTemplates({ setup: business });
    let synced = 0;
    for (const item of templates) {
      const name = clean(item.name);
      if (!name) continue;
      const components = templateComponentsFromMeta(item.components);
      const status = normalizeTemplateStatus(item.status);
      await query(
        `INSERT INTO templates (id, business_id, name, category, language, header_text, body, footer_text, buttons, variables, status, meta_template_id, meta_template_name, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Meta sync')
         ON CONFLICT (business_id, name) DO UPDATE SET category = EXCLUDED.category, language = EXCLUDED.language,
           header_text = EXCLUDED.header_text, body = EXCLUDED.body, footer_text = EXCLUDED.footer_text, buttons = EXCLUDED.buttons,
           variables = EXCLUDED.variables, status = EXCLUDED.status, meta_template_id = EXCLUDED.meta_template_id,
           meta_template_name = EXCLUDED.meta_template_name, source = 'Meta sync', updated_at = NOW()`,
        [id("t"), session.businessId, name, clean(item.category) || "MARKETING", clean(item.language) || "en_US", components.headerText, components.body, components.footerText, JSON.stringify(components.buttons), JSON.stringify(templateVariables(components.body)), status, clean(item.id), name]
      );
      synced += 1;
    }
    await audit(session, "templates_synced", { synced });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) { return errorJson(error); }
}
export async function createCampaign(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const variables = body.variables || {};
    const requestedContactIds = Array.isArray(body.contactIds) ? body.contactIds.map(clean).filter(Boolean) : [];
    const segmentId = clean(body.segmentId);
    let segmentContactIds = [];
    if (segmentId) {
      const segment = (await query("SELECT rules FROM audience_segments WHERE id = $1 AND business_id = $2 AND is_active = TRUE", [segmentId, session.businessId])).rows[0];
      if (!segment) throw new AppError("Select an active audience segment.", 400, "SEGMENT_NOT_FOUND");
      segmentContactIds = await resolveSegmentContactIds(session.businessId, segment.rules);
    }
    const contactIds = [...new Set([...requestedContactIds, ...segmentContactIds])];
    const automationFlowId = clean(body.automationFlowId);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) throw new AppError("Choose a valid campaign schedule.", 400, "VALIDATION_ERROR");
    const runAt = scheduledAt && scheduledAt.getTime() > Date.now() ? scheduledAt : new Date();
    const campaignStatus = runAt.getTime() > Date.now() ? "scheduled" : "queued";
    const timezone = clean(body.timezone) || "UTC";
    const templateResult = await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2", [body.templateId, session.businessId]);
    const template = templateResult.rows[0];
    if (!template || template.status !== "Approved") throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");

    const contactResult = await query(
      `SELECT * FROM contacts
       WHERE business_id = $1 AND id = ANY($2) AND marketing_permission = TRUE AND unsubscribed = FALSE`,
      [session.businessId, contactIds]
    );
    if (!contactResult.rows.length) throw new AppError("No opted-in contacts selected.", 400, "VALIDATION_ERROR");
    await assertCampaignCapacity(session.businessId, contactResult.rows.length);

    let linkedFlow = null;
    if (automationFlowId) {
      linkedFlow = (await query("SELECT * FROM automation_flows WHERE id = $1 AND business_id = $2 AND status = 'active'", [automationFlowId, session.businessId])).rows[0];
      if (!linkedFlow) throw new AppError("Select an active automation flow or leave follow-up automation empty.", 400, "FLOW_NOT_FOUND");
    }

    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    if (!metaReady(business)) throw new AppError("Meta WhatsApp credentials are required before queuing campaigns.", 400, "META_NOT_CONFIGURED");

    await transaction(async (client) => {
      const campaignId = id("k");
      await client.query(
        "INSERT INTO campaigns (id, business_id, name, template_id, automation_flow_id, variables, mode, status, scheduled_at, timezone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [campaignId, session.businessId, clean(body.name) || "Untitled Campaign", template.id, linkedFlow?.id || null, JSON.stringify(variables), business.mode, campaignStatus, scheduledAt, timezone]
      );
      for (const contact of contactResult.rows) {
        const recipientId = id("r");
        const message = renderTemplate(template.body, mapContact(contact), variables);
        await client.query(
          `INSERT INTO campaign_recipients (id, campaign_id, contact_id, message, status)
           VALUES ($1, $2, $3, $4, 'queued')`,
          [recipientId, campaignId, contact.id, message]
        );
        await client.query(
          `INSERT INTO campaign_jobs (id, campaign_recipient_id, status, run_at)
           VALUES ($1, $2, 'queued', $3)`,
          [id("j"), recipientId, runAt]
        );
      }
      await client.query("INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'campaign_queued', $3)", [id("e"), session.businessId, JSON.stringify({ recipients: contactResult.rows.length, automationFlowId: linkedFlow?.id || "" })]);
    });
    await audit(session, "campaign_queued", { contacts: contactResult.rows.length, automationFlowId: linkedFlow?.id || "" });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateCampaignLifecycle(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action).toLowerCase();
    if (!["pause", "resume", "cancel"].includes(action)) throw new AppError("Unsupported campaign action.", 400, "VALIDATION_ERROR");

    const campaign = (await query("SELECT * FROM campaigns WHERE id = $1 AND business_id = $2", [params.id, session.businessId])).rows[0];
    if (!campaign) throw new AppError("Campaign not found.", 404, "CAMPAIGN_NOT_FOUND");
    if (action === "cancel" && ["completed", "cancelled"].includes(campaign.status)) throw new AppError("This campaign can no longer be cancelled.", 409, "CAMPAIGN_FINALIZED");
    if (action === "pause" && !["queued", "scheduled", "processing"].includes(campaign.status)) throw new AppError("Only queued, scheduled, or processing campaigns can be paused.", 409, "CAMPAIGN_NOT_ACTIVE");
    if (action === "resume" && campaign.status !== "paused") throw new AppError("Only paused campaigns can be resumed.", 409, "CAMPAIGN_NOT_PAUSED");

    await transaction(async (client) => {
      if (action === "pause") {
        await client.query("UPDATE campaigns SET status = 'paused' WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      } else if (action === "resume") {
        await client.query("UPDATE campaigns SET status = CASE WHEN scheduled_at > NOW() THEN 'scheduled' ELSE 'queued' END WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      } else {
        await client.query("UPDATE campaigns SET status = 'cancelled' WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
        await client.query(
          `UPDATE campaign_jobs j SET status = 'failed', completed_at = NOW(), error_message = 'Campaign cancelled', updated_at = NOW()
           FROM campaign_recipients cr WHERE j.campaign_recipient_id = cr.id AND cr.campaign_id = $1 AND j.status IN ('queued', 'retry')`,
          [params.id]
        );
        await client.query("UPDATE campaign_recipients SET status = 'failed', error_message = 'Campaign cancelled', updated_at = NOW() WHERE campaign_id = $1 AND status = 'queued'", [params.id]);
      }
    });
    await audit(session, `campaign_${action}`, { campaignId: params.id });
    return json(await loadState(await currentAccount(request)));
  } catch (error) {
    return errorJson(error);
  }
}

export async function processCampaignQueue(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json().catch(() => ({}));
    const summary = await runCampaignQueue({ businessId: session.businessId, limit: Number(body.limit) || queueBatchSize() });
    await audit(session, "campaign_queue_processed", summary);
    const nextState = await loadState(await currentAccount(request));
    return json({ ...nextState, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function processCampaignQueueJob(request) {
  try {
    const expected = clean(process.env.JOB_RUNNER_SECRET);
    const header = clean(request.headers.get("authorization")).replace(/^Bearer\s+/i, "");
    if (!expected || expected.startsWith("replace-with")) throw new AppError("JOB_RUNNER_SECRET is not configured.", 503, "JOB_SECRET_NOT_CONFIGURED");
    if (header !== expected) throw new AppError("Invalid job runner secret.", 401, "JOB_UNAUTHORIZED");
    const body = await request.json().catch(() => ({}));
    const summary = await runCampaignQueue({ businessId: clean(body.businessId), limit: Number(body.limit) || queueBatchSize() });
    return json({ ok: true, queueSummary: summary });
  } catch (error) {
    return errorJson(error);
  }
}

export async function runCampaignQueue({ businessId = "", limit = queueBatchSize() } = {}) {
  const size = Math.max(1, Math.min(Number(limit) || queueBatchSize(), 100));
  const jobs = await claimCampaignJobs({ businessId, limit: size });
  const summary = { claimed: jobs.length, sent: 0, failed: 0, retried: 0 };

  for (const job of jobs) {
    try {
      const variables = job.variables || {};
      const templateVariablesList = Array.isArray(job.template_variables) ? job.template_variables : [];
      const values = templateVariablesList.map((key) => key === "name" ? job.contact_name : variables[key] || "");
      const meta = await sendTemplateMessage({
        setup: job,
        to: job.phone,
        templateName: job.meta_template_name || templateApiName(job.template_name),
        language: job.template_language,
        variables: values
      });
      await recordSuccessfulCampaignSend(job, meta);
      summary.sent += 1;
    } catch (error) {
      const nextAttempts = Number(job.attempts || 0) + 1;
      const shouldRetry = nextAttempts < Number(job.max_attempts || 3) && isRetryableError(error);
      await query(
        `UPDATE campaign_jobs
         SET status = $1, attempts = $2, run_at = NOW() + ($3 || ' minutes')::interval,
             locked_at = NULL, error_message = $4, updated_at = NOW()
         WHERE id = $5`,
        [shouldRetry ? "retry" : "failed", nextAttempts, String(Math.min(nextAttempts * 5, 30)), clean(error.message), job.job_id]
      );
      await query(
        `UPDATE campaign_recipients
         SET status = $1, error_message = $2, updated_at = NOW()
         WHERE id = $3`,
        [shouldRetry ? "queued" : "failed", clean(error.message), job.campaign_recipient_id]
      );
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
      `INSERT INTO conversations (id, business_id, contact_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (business_id, contact_id) DO UPDATE SET updated_at = NOW()`,
      [id("v"), job.business_id, job.contact_id]
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
      await client.query(
        `INSERT INTO automation_sessions (id, business_id, contact_id, flow_id, current_node_id, campaign_id, context)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (business_id, contact_id) WHERE status = 'active' DO NOTHING`,
        [id("fs"), job.business_id, job.contact_id, job.automation_flow_id, startNodeId, job.campaign_id, JSON.stringify({ campaignId: job.campaign_id })]
      );
    }

    await client.query(
      `UPDATE campaigns c
       SET status = CASE WHEN EXISTS (
         SELECT 1 FROM campaign_recipients cr
         JOIN campaign_jobs j ON j.campaign_recipient_id = cr.id
         WHERE cr.campaign_id = c.id AND j.status IN ('queued', 'retry', 'processing')
       ) THEN 'processing' ELSE 'completed' END
       WHERE c.id = $1 AND c.business_id = $2`,
      [job.campaign_id, job.business_id]
    );
  });
}
async function claimCampaignJobs({ businessId = "", limit }) {
  return transaction(async (client) => {
    const params = [limit];
    const businessFilter = businessId ? "AND c.business_id = $2" : "";
    if (businessId) params.push(businessId);
    const result = await client.query(
      `SELECT j.id AS job_id, j.attempts, j.max_attempts, j.campaign_recipient_id,
              cr.message, c.id AS campaign_id, c.variables, c.business_id, c.automation_flow_id, t.name AS template_name,
              t.variables AS template_variables, t.meta_template_name, t.language AS template_language,
              ct.id AS contact_id, ct.name AS contact_name, ct.phone, af.definition AS automation_definition,
              b.waba_id, b.phone_number_id, b.access_token_encrypted
       FROM campaign_jobs j
       JOIN campaign_recipients cr ON cr.id = j.campaign_recipient_id
       JOIN campaigns c ON c.id = cr.campaign_id
       JOIN templates t ON t.id = c.template_id
       JOIN contacts ct ON ct.id = cr.contact_id
       LEFT JOIN automation_flows af ON af.id = c.automation_flow_id AND af.business_id = c.business_id AND af.status = 'active'
       JOIN businesses b ON b.id = c.business_id
       WHERE c.status NOT IN ('paused', 'cancelled') AND ((j.status IN ('queued', 'retry') AND j.run_at <= NOW())
          OR (j.status = 'processing' AND j.locked_at < NOW() - INTERVAL '15 minutes'))
         ${businessFilter}
       ORDER BY j.created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      params
    );
    const jobIds = result.rows.map((row) => row.job_id);
    if (jobIds.length) {
      await client.query("UPDATE campaign_jobs SET status = 'processing', locked_at = NOW(), updated_at = NOW() WHERE id = ANY($1)", [jobIds]);
    }
    return result.rows;
  });
}

function queueBatchSize() {
  return Math.max(1, Math.min(Number(process.env.CAMPAIGN_QUEUE_BATCH_SIZE) || 25, 100));
}

function isRetryableError(error) {
  const status = Number(error?.status || 0);
  return status === 429 || status >= 500;
}
export async function getMessageMedia(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const message = (await query(
      `SELECT m.media_id, m.mime_type, m.metadata, b.*
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN businesses b ON b.id = c.business_id
       WHERE m.id = $1 AND c.business_id = $2 AND m.media_id <> ''`,
      [params.id, session.businessId]
    )).rows[0];
    if (!message) throw new AppError("Media message not found.", 404, "MEDIA_NOT_FOUND");
    const media = await fetchWhatsAppMedia({ setup: message, mediaId: message.media_id });
    const filename = clean(message.metadata?.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    return new Response(media.bytes, {
      status: 200,
      headers: {
        "Content-Type": media.contentType || message.mime_type || "application/octet-stream",
        "Content-Disposition": `${filename ? "attachment" : "inline"}; filename="${filename || `whatsapp-media-${params.id}`}"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return errorJson(error);
  }
}

export async function sendReply(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const contact = await findContact(session.businessId, body.contactId);
    if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
    await assertConversationOwnership(session, contact.id);
    if (!okToReply(contact)) throw new AppError("Normal reply period expired. Select an approved template to contact this customer.", 403, "REPLY_WINDOW_CLOSED");
    await assertMessageCapacity(session.businessId, 1);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const messageBody = clean(body.body);
    const meta = await sendTextMessage({ setup: business, to: contact.phone, body: messageBody });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
    await query("UPDATE conversations SET updated_at = NOW(), version = version + 1 WHERE id = $1", [conversationId]);
    await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, messageBody, meta.status, meta.metaMessageId]);
    await audit(session, "message_sent", { contactId: contact.id });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function sendTemplateReply(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const contact = await findContact(session.businessId, body.contactId);
    if (!contact) throw new AppError("Contact not found.", 404, "NOT_FOUND");
    await assertConversationOwnership(session, contact.id);
    const template = (await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2 AND status = 'Approved'", [body.templateId, session.businessId])).rows[0];
    if (!template) throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");
    await assertMessageCapacity(session.businessId, 1);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const message = renderTemplate(template.body, mapContact(contact), body.variables || {});
    const meta = await sendTemplateMessage({
      setup: business,
      to: contact.phone,
      templateName: template.meta_template_name || templateApiName(template.name),
      language: template.language,
      variables: (template.variables || []).map((key) => key === "name" ? contact.name : (body.variables || {})[key] || "")
    });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
    await query("UPDATE conversations SET updated_at = NOW(), version = version + 1 WHERE id = $1", [conversationId]);
    await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, message, meta.status, meta.metaMessageId]);
    await audit(session, "template_reply_sent", { contactId: contact.id, templateId: template.id });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function updateConversationWorkflow(request, context) {
  try {
    const session = await requireSession(request);
    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action).toLowerCase();
    const conversation = (await query("SELECT * FROM conversations WHERE id = $1 AND business_id = $2", [params.id, session.businessId])).rows[0];
    if (!conversation) throw new AppError("Conversation not found.", 404, "CONVERSATION_NOT_FOUND");

    const manager = ["Owner", "Manager"].includes(session.role);
    const assignedUserId = clean(body.assignedUserId);
    if (assignedUserId) {
      const member = (await query("SELECT user_id FROM memberships WHERE user_id = $1 AND business_id = $2", [assignedUserId, session.businessId])).rows[0];
      if (!member) throw new AppError("Assigned user must belong to this company.", 400, "INVALID_ASSIGNEE");
    }

    if (action === "assign") {
      if (!manager && assignedUserId !== session.userId) throw new AppError("Only workspace owners and managers can assign other agents.", 403, "ASSIGNMENT_FORBIDDEN");
      await query("UPDATE conversations SET assigned_user_id = $1, updated_at = NOW(), version = version + 1 WHERE id = $2 AND business_id = $3", [assignedUserId || null, params.id, session.businessId]);
      await audit(session, "conversation_assigned", { conversationId: params.id, assignedUserId });
    } else if (action === "takeover") {
      const targetUserId = assignedUserId || session.userId;
      const claimed = await query(
        `UPDATE conversations
         SET automation_paused = TRUE, assigned_user_id = $1, status = 'open', updated_at = NOW(), version = version + 1
         WHERE id = $2 AND business_id = $3 AND ($4::boolean OR assigned_user_id IS NULL OR assigned_user_id = $1)
         RETURNING id`,
        [targetUserId, params.id, session.businessId, manager]
      );
      if (!claimed.rows[0]) throw new AppError("This conversation is already owned by another agent.", 409, "CONVERSATION_ALREADY_ASSIGNED");
      await query(
        `UPDATE automation_sessions
         SET status = 'handoff', human_takeover = TRUE, assigned_user_id = $1, ended_at = NOW(), updated_at = NOW()
         WHERE business_id = $2 AND contact_id = $3 AND status = 'active'`,
        [targetUserId, session.businessId, conversation.contact_id]
      );
      await audit(session, "conversation_takeover", { conversationId: params.id, assignedUserId: targetUserId });
    } else if (action === "resume") {
      if (!manager && conversation.assigned_user_id && conversation.assigned_user_id !== session.userId) throw new AppError("Only the assigned agent can resume this conversation.", 403, "CONVERSATION_FORBIDDEN");
      await query("UPDATE conversations SET automation_paused = FALSE, updated_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
      await audit(session, "conversation_automation_resumed", { conversationId: params.id });
    } else if (action === "mark_read") {
      await query("UPDATE conversations SET unread_count = 0, last_read_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    } else if (action === "close" || action === "reopen") {
      if (!manager && conversation.assigned_user_id && conversation.assigned_user_id !== session.userId) throw new AppError("Only the assigned agent can update this conversation.", 403, "CONVERSATION_FORBIDDEN");
      const nextStatus = action === "close" ? "closed" : "open";
      await query("UPDATE conversations SET status = $1, unread_count = CASE WHEN $1 = 'closed' THEN 0 ELSE unread_count END, updated_at = NOW(), version = version + 1 WHERE id = $2 AND business_id = $3", [nextStatus, params.id, session.businessId]);
      await audit(session, `conversation_${action}`, { conversationId: params.id });
    } else if (action === "note") {
      const note = clean(body.note);
      if (!note) throw new AppError("Enter a note.", 400, "VALIDATION_ERROR");
      await query("INSERT INTO conversation_notes (id, business_id, conversation_id, user_id, body) VALUES ($1, $2, $3, $4, $5)", [id("n"), session.businessId, params.id, session.userId, note]);
      await audit(session, "conversation_note_added", { conversationId: params.id });
    } else {
      throw new AppError("Unsupported conversation action.", 400, "VALIDATION_ERROR");
    }

    return json(await loadState(await currentAccount(request)));
  } catch (error) {
    return errorJson(error);
  }
}
export function verifyMetaWebhook(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && token && expected && token === expected) return new Response(challenge || "ok", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function receiveMetaWebhook(request) {
  try {
    const rawBody = await request.text();
    verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"));
    const body = rawBody ? JSON.parse(rawBody) : {};
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const business = await businessForWebhook(value.metadata?.phone_number_id, entry.id);
        if (!business) continue;
        for (const message of value.messages || []) {
          const at = new Date(Number(message.timestamp || Date.now() / 1000) * 1000);
          const input = webhookInputFromMessage(message);
          const incoming = await ingestIncoming(business.id, message.from, input, at, message.id || "");
          if (incoming.duplicate) continue;
          await enqueueAutomationForIncoming({ businessId: business.id, ...incoming, input });
        }
        for (const statusUpdate of value.statuses || []) {
          await updateDeliveryStatus(business.id, statusUpdate);
        }
        await updateTemplateStatus(business.id, value);
        await query("INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'meta_webhook', $3)", [id("e"), business.id, JSON.stringify({ field: change.field })]);
      }
    }
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}

function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = clean(process.env.META_APP_SECRET);
  const required = process.env.META_WEBHOOK_SIGNATURE_REQUIRED === "true" || Boolean(secret && !secret.startsWith("replace-with"));
  if (!required) return;
  if (!secret || secret.startsWith("replace-with")) throw new AppError("META_APP_SECRET is required for secure webhook verification.", 503, "META_APP_SECRET_REQUIRED");
  if (!signatureHeader || !String(signatureHeader).startsWith("sha256=")) throw new AppError("Invalid Meta webhook signature.", 401, "WEBHOOK_SIGNATURE_INVALID");

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(String(signatureHeader), "utf8");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new AppError("Invalid Meta webhook signature.", 401, "WEBHOOK_SIGNATURE_INVALID");
  }
}

async function loadState(account) {
  const businessId = account.business.id;
  const [business, contacts, audienceSegments, templates, campaigns, recipients, conversations, messages, notes, events, automationFlows, teamMembers, subscription, platformConfig] = await Promise.all([
    query("SELECT * FROM businesses WHERE id = $1", [businessId]),
    query("SELECT * FROM contacts WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    listAudienceSegments(businessId),
    query("SELECT * FROM templates WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    query("SELECT * FROM campaigns WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    query(`SELECT cr.*, EXISTS (SELECT 1 FROM messages m WHERE m.campaign_recipient_id = cr.id AND m.direction = 'incoming') AS replied FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id WHERE c.business_id = $1 ORDER BY cr.sent_at DESC NULLS LAST`, [businessId]),
    query("SELECT * FROM conversations WHERE business_id = $1 ORDER BY updated_at DESC", [businessId]),
    query(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.business_id = $1 ORDER BY m.at ASC`, [businessId]),
    query(`SELECT n.*, u.name AS user_name, u.email AS user_email FROM conversation_notes n JOIN conversations c ON c.id = n.conversation_id JOIN users u ON u.id = n.user_id WHERE c.business_id = $1 ORDER BY n.created_at ASC`, [businessId]),
    query("SELECT * FROM events WHERE business_id = $1 ORDER BY at DESC LIMIT 50", [businessId]),
    listAutomationFlows(businessId),
    query(`SELECT u.id, u.name, u.email, m.role, m.availability FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 ORDER BY m.created_at ASC`, [businessId]),
    subscriptionUsage(businessId),
    getPublicPlatformConfig()
  ]);
  const setup = business.rows[0];
  const campaignRows = campaigns.rows.map((campaign) => {
    const campaignRecipients = recipients.rows.filter((recipient) => recipient.campaign_id === campaign.id).map(mapRecipient);
    const stats = campaignStats(campaignRecipients);
    const mapped = mapCampaign(campaign);
    const status = ["paused", "cancelled"].includes(mapped.status) ? mapped.status : mapped.scheduledAt && new Date(mapped.scheduledAt).getTime() > Date.now() ? "scheduled" : stats.queued ? "processing" : stats.failed === stats.total && stats.total ? "failed" : stats.total ? "completed" : mapped.status;
    return { ...mapped, status, recipients: campaignRecipients, stats };
  });
  const conversationRows = conversations.rows.map((conversation) => {
    const contact = contacts.rows.find((item) => item.id === conversation.contact_id);
    return {
      id: conversation.id,
      contactId: conversation.contact_id,
      createdAt: toIso(conversation.created_at),
      updatedAt: toIso(conversation.updated_at),
      canReply: okToReply(contact),
      assignedUserId: conversation.assigned_user_id || "",
      automationPaused: Boolean(conversation.automation_paused),
      status: conversation.status || "open",
      unreadCount: Number(conversation.unread_count || 0),
      lastReadAt: toIso(conversation.last_read_at),
      version: Number(conversation.version || 0),
      notes: notes.rows.filter((note) => note.conversation_id === conversation.id).map((note) => ({ id: note.id, body: note.body, userId: note.user_id, author: note.user_name || note.user_email, createdAt: toIso(note.created_at) })),
      messages: messages.rows.filter((message) => message.conversation_id === conversation.id).map(mapMessage)
    };
  });
  return {
    account,
    setup: mapSetup(setup),
    contacts: contacts.rows.map(mapContact),
    audienceSegments,
    templates: templates.rows.map(mapTemplate),
    campaigns: campaignRows,
    conversations: conversationRows,
    events: events.rows.map((event) => ({ id: event.id, type: event.type, contactId: event.contact_id, metadata: event.metadata || {}, at: toIso(event.at) })),
    automationFlows,
    teamMembers: teamMembers.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role, availability: row.availability || "offline" })),
    subscription,
    platform: platformConfig,
    meta: {
      storage: "PostgreSQL",
      liveMetaReady: Boolean(setup?.access_token_encrypted && setup?.waba_id && setup?.phone_number_id),
      webhookUrl: setup?.webhook_url || ""
    }
  };
}
async function findContact(businessId, contactId) {
  return (await query("SELECT * FROM contacts WHERE id = $1 AND business_id = $2", [contactId, businessId])).rows[0];
}

async function assertConversationOwnership(session, contactId) {
  const conversation = (await query(
    "SELECT assigned_user_id FROM conversations WHERE business_id = $1 AND contact_id = $2",
    [session.businessId, contactId]
  )).rows[0];
  const manager = ["Owner", "Manager"].includes(session.role);
  if (conversation?.assigned_user_id && conversation.assigned_user_id !== session.userId && !manager) {
    throw new AppError("This conversation is assigned to another agent.", 409, "CONVERSATION_ALREADY_ASSIGNED");
  }
}
async function findOrCreateConversation(businessId, contactId) {
  const existing = await query("SELECT id FROM conversations WHERE business_id = $1 AND contact_id = $2", [businessId, contactId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const conversationId = id("v");
  await query("INSERT INTO conversations (id, business_id, contact_id) VALUES ($1, $2, $3)", [conversationId, businessId, contactId]);
  return conversationId;
}

async function ingestIncoming(businessId, phone, input, at, metaMessageId = "") {
  const cleanNumber = cleanPhone(phone);
  return transaction(async (client) => {
    let contact = (await client.query("SELECT * FROM contacts WHERE business_id = $1 AND phone = $2", [businessId, cleanNumber])).rows[0];
    if (!contact) {
      const contactId = id("c");
      await client.query(
        `INSERT INTO contacts (id, business_id, name, phone, source, opt_in_source)
         VALUES ($1, $2, $3, $4, 'Meta webhook', 'Customer initiated')
         ON CONFLICT (business_id, phone) DO NOTHING`,
        [contactId, businessId, cleanNumber, cleanNumber]
      );
      contact = (await client.query("SELECT * FROM contacts WHERE business_id = $1 AND phone = $2", [businessId, cleanNumber])).rows[0];
    }

    await client.query("UPDATE contacts SET last_message_at = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3", [at, contact.id, businessId]);
    const conversation = await client.query(
      `INSERT INTO conversations (id, business_id, contact_id, status, unread_count, updated_at, version)
       VALUES ($1, $2, $3, 'open', 0, NOW(), 0)
       ON CONFLICT (business_id, contact_id) DO UPDATE SET contact_id = EXCLUDED.contact_id
       RETURNING id`,
      [id("v"), businessId, contact.id]
    );
    const attributedRecipient = (await client.query(
      `SELECT cr.id FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       WHERE c.business_id = $1 AND cr.contact_id = $2 AND cr.sent_at IS NOT NULL
         AND cr.sent_at <= $3 AND cr.sent_at >= $3 - INTERVAL '24 hours'
       ORDER BY cr.sent_at DESC LIMIT 1`,
      [businessId, contact.id, at]
    )).rows[0];
    const messageId = id("m");
    const inserted = await client.query(
      `INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, at, message_type, media_id, mime_type, caption, metadata, campaign_recipient_id)
       VALUES ($1, $2, 'incoming', $3, 'received', $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [messageId, conversation.rows[0].id, input.text, metaMessageId, at, input.type, input.mediaId, input.mimeType, input.caption, JSON.stringify(input.metadata || {}), attributedRecipient?.id || null]
    );
    if (!inserted.rows[0]) return { duplicate: true };
    await client.query(
      "UPDATE conversations SET status = 'open', unread_count = unread_count + 1, updated_at = NOW(), version = version + 1 WHERE id = $1 AND business_id = $2",
      [conversation.rows[0].id, businessId]
    );

    if (/^(stop|unsubscribe|opt out)$/i.test(String(input.text).trim())) {
      await client.query("UPDATE contacts SET marketing_permission = FALSE, unsubscribed = TRUE, updated_at = NOW() WHERE id = $1 AND business_id = $2", [contact.id, businessId]);
      await client.query("INSERT INTO events (id, business_id, type, contact_id) VALUES ($1, $2, 'unsubscribe', $3)", [id("e"), businessId, contact.id]);
    }
    return { contactId: contact.id, conversationId: conversation.rows[0].id, messageId };
  });
}

function webhookInputFromMessage(message) {
  const interactive = message.interactive || {};
  const buttonReply = interactive.button_reply;
  const listReply = interactive.list_reply;
  const templateButton = message.button;
  const type = clean(message.type) || "text";
  const media = ["image", "audio", "video", "document", "sticker"].includes(type) ? message[type] || {} : {};
  const caption = clean(media.caption);
  const fallback = type === "text" ? "" : `[${type.charAt(0).toUpperCase()}${type.slice(1)}]`;
  const text = message.text?.body || buttonReply?.title || listReply?.title || templateButton?.text || caption || fallback;
  return {
    type,
    text,
    value: buttonReply?.id || listReply?.id || templateButton?.payload || text,
    title: buttonReply?.title || listReply?.title || templateButton?.text || text,
    buttonId: buttonReply?.id || templateButton?.payload || "",
    listId: listReply?.id || "",
    mediaId: clean(media.id),
    mimeType: clean(media.mime_type),
    caption,
    metadata: { filename: clean(media.filename), sha256: clean(media.sha256), voice: Boolean(media.voice) }
  };
}

async function businessForWebhook(phoneNumberId, wabaId) {
  if (phoneNumberId) {
    const byPhone = (await query("SELECT * FROM businesses WHERE phone_number_id = $1", [String(phoneNumberId)])).rows[0];
    if (byPhone) return byPhone;
  }
  if (wabaId) return (await query("SELECT * FROM businesses WHERE waba_id = $1", [String(wabaId)])).rows[0] || null;
  return null;
}
async function updateTemplateStatus(businessId, value) {
  const templateName = value.message_template_name || value.template_name || value.name;
  const templateId = value.message_template_id || value.template_id;
  const status = normalizeTemplateStatus(value.event || value.status);
  if (!templateName && !templateId) return;
  await query(
    `UPDATE templates
     SET status = $1, rejection_reason = $2, updated_at = NOW()
     WHERE business_id = $3 AND (meta_template_name = $4 OR meta_template_id = $5)`,
    [status, clean(value.reason || value.rejection_reason), businessId, templateName || "", templateId || ""]
  );
}
async function updateDeliveryStatus(businessId, statusUpdate) {
  const nextStatus = clean(statusUpdate.status).toLowerCase();
  if (!["sent", "delivered", "read", "failed"].includes(nextStatus)) return;
  const errorMessage = clean(statusUpdate.errors?.[0]?.message || statusUpdate.errors?.[0]?.title);
  const recipientStatus = `CASE
    WHEN $1 = 'failed' THEN CASE WHEN cr.status IN ('queued', 'sent') THEN 'failed' ELSE cr.status END
    WHEN CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END >= CASE cr.status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END THEN $1
    ELSE cr.status END`;
  const messageStatus = `CASE
    WHEN $1 = 'failed' THEN CASE WHEN m.status IN ('queued', 'sent') THEN 'failed' ELSE m.status END
    WHEN CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END >= CASE m.status WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END THEN $1
    ELSE m.status END`;
  await query(
    `UPDATE campaign_recipients cr SET status = ${recipientStatus},
       error_message = CASE WHEN $1 = 'failed' AND $4 <> '' AND cr.status IN ('queued', 'sent') THEN $4 ELSE cr.error_message END, updated_at = NOW()
     FROM campaigns c WHERE cr.campaign_id = c.id AND c.business_id = $2 AND cr.meta_message_id = $3`,
    [nextStatus, businessId, statusUpdate.id, errorMessage]
  );
  await query(
    `UPDATE messages m SET status = ${messageStatus},
       metadata = CASE WHEN $1 = 'failed' AND $4 <> '' AND m.status IN ('queued', 'sent') THEN m.metadata || jsonb_build_object('deliveryError', $4) ELSE m.metadata END
     FROM conversations c WHERE m.conversation_id = c.id AND c.business_id = $2 AND m.meta_message_id = $3`,
    [nextStatus, businessId, statusUpdate.id, errorMessage]
  );
}
async function audit(session, action, metadata = {}) {
  await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, $4, $5)", [id("a"), session.businessId, session.userId, action, JSON.stringify(metadata)]);
}

function templateComponentsFromMeta(components = []) {
  const get = (type) => components.find((component) => String(component.type || "").toUpperCase() === type) || {};
  const header = get("HEADER");
  const body = get("BODY");
  const footer = get("FOOTER");
  const buttons = get("BUTTONS");
  return {
    headerText: String(header.format || "").toUpperCase() === "TEXT" ? clean(header.text) : "",
    body: clean(body.text),
    footerText: clean(footer.text),
    buttons: normalizeTemplateButtons((buttons.buttons || []).filter((button) => String(button.type || "").toUpperCase() === "QUICK_REPLY").map((button) => ({ text: button.text })))
  };
}

function normalizeTemplateButtons(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,]/).map((text) => ({ text }));
  return items.map((button) => ({ type: "QUICK_REPLY", text: clean(button?.text || button).slice(0, 25) })).filter((button) => button.text).slice(0, 3);
}
function normalizeTemplateStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "Approved";
  if (value === "rejected") return "Rejected";
  if (value === "draft") return "Draft";
  return "Pending";
}
function mapSetup(row) {
  return {
    businessName: row?.name || "",
    whatsappNumber: row?.whatsapp_number || "",
    wabaId: row?.waba_id || "",
    phoneNumberId: row?.phone_number_id || "",
    accessToken: row?.access_token_encrypted ? "saved-token-hidden" : "",
    webhookUrl: row?.webhook_url || "",
    mode: row?.mode || "Live Meta",
    status: row?.status || "Needs setup"
  };
}

function mapContact(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    marketingPermission: row.marketing_permission,
    unsubscribed: row.unsubscribed,
    lastMessageAt: toIso(row.last_message_at),
    source: row.source,
    tags: Array.isArray(row.tags) ? row.tags : [],
    customAttributes: row.custom_attributes || {},
    optInAt: toIso(row.opt_in_at),
    optInSource: row.opt_in_source || row.source,
    createdAt: toIso(row.created_at)
  };
}

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    language: row.language || "en_US",
    rejectionReason: row.rejection_reason || "",
    headerText: row.header_text || "",
    body: row.body,
    footerText: row.footer_text || "",
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    variables: row.variables || [],
    status: row.status,
    metaTemplateId: row.meta_template_id || "",
    metaTemplateName: row.meta_template_name || "",
    source: row.source,
    createdAt: toIso(row.created_at)
  };
}

function mapCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    variables: row.variables || {},
    status: row.status || "queued",
    scheduledAt: toIso(row.scheduled_at),
    timezone: row.timezone || "UTC",
    createdAt: toIso(row.created_at),
    mode: row.mode
  };
}

function mapRecipient(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    message: row.message,
    status: row.status,
    metaMessageId: row.meta_message_id,
    sentAt: toIso(row.sent_at),
    errorMessage: row.error_message || "",
    replied: Boolean(row.replied)
  };
}
function mapMessage(row) {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    metaMessageId: row.meta_message_id,
    messageType: row.message_type || "text",
    mediaId: row.media_id || "",
    mimeType: row.mime_type || "",
    caption: row.caption || "",
    metadata: row.metadata || {},
    campaignRecipientId: row.campaign_recipient_id || "",
    at: toIso(row.at)
  };
}

function parseCsvRows(value) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(value || "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => clean(item))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => clean(item))) rows.push(row);
  return rows;
}

function isHeaderRow(name, phone, permission) {
  return /^name$/i.test(name) && /^phone|mobile|whatsapp/i.test(phone) && (!permission || /^permission|opt/i.test(permission));
}

function permissionFromCell(value) {
  return /^(yes|y|true|1|allowed|allow|opted in|opted-in|subscribed)$/i.test(clean(value));
}

function normalizeAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [clean(key).slice(0, 64), clean(item).slice(0, 500)])
    .filter(([key]) => key)
    .slice(0, 50));
}

function csvCell(value) {
  let content = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(content)) content = `'${content}`;
  return `"${content.replace(/"/g, '""')}"`;
}
function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  return [...new Set(values.map((item) => clean(item).toLowerCase()).filter(Boolean))].slice(0, 20);
}

function clean(value) {
  return String(value || "").trim();
}

function cleanPhone(value) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
}

export function okToReply(contact) {
  if (!contact?.last_message_at && !contact?.lastMessageAt) return false;
  const value = contact.last_message_at || contact.lastMessageAt;
  return Date.now() - new Date(value).getTime() <= REPLY_WINDOW_MS;
}

export function templateVariables(body) {
  return [...new Set([...String(body || "").matchAll(/{{\s*([\w.-]+)\s*}}/g)].map((match) => match[1]))];
}

export function renderTemplate(body, contact, variables = {}) {
  return String(body || "").replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => key === "name" ? contact.name : variables[key] || "");
}

export function campaignStats(recipients) {
  return {
    total: recipients.length,
    queued: recipients.filter((r) => r.status === "queued").length,
    sent: recipients.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length,
    delivered: recipients.filter((r) => ["delivered", "read"].includes(r.status)).length,
    read: recipients.filter((r) => r.status === "read").length,
    replied: recipients.filter((r) => r.replied).length,
    failed: recipients.filter((r) => r.status === "failed").length
  };
}








