import { currentAccount, requireSession } from "./auth";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { createWhatsAppTemplate, encryptSecret, listWhatsAppTemplates, sendTemplateMessage, sendTextMessage, templateApiName } from "./meta";

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
    if (!name || !phone) throw new AppError("Name and phone are required.", 400, "VALIDATION_ERROR");

    await query(
      `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'Manual')
       ON CONFLICT (business_id, phone) DO UPDATE
       SET name = EXCLUDED.name, marketing_permission = EXCLUDED.marketing_permission,
           unsubscribed = EXCLUDED.unsubscribed, updated_at = NOW()`,
      [id("c"), session.businessId, name, phone, marketingPermission, !marketingPermission]
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
    const rows = String(body.csv || "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    let imported = 0;
    for (const row of rows) {
      const [rawName, rawPhone, permission = "yes"] = row.split(",").map((cell) => clean(cell));
      const phone = cleanPhone(rawPhone);
      if (!rawName || !phone) continue;
      const allowed = /^(yes|true|1|allowed|opted in)$/i.test(permission);
      await query(
        `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'CSV import')
         ON CONFLICT (business_id, phone) DO UPDATE
         SET name = EXCLUDED.name, marketing_permission = EXCLUDED.marketing_permission,
             unsubscribed = EXCLUDED.unsubscribed, source = 'CSV import', updated_at = NOW()`,
        [id("c"), session.businessId, rawName, phone, allowed, !allowed]
      );
      imported += 1;
    }
    await audit(session, "contacts_imported", { imported });
    return json(await loadState(await currentAccount(request)), 201);
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
    const marketingPermission = typeof body.marketingPermission === "boolean" ? body.marketingPermission : null;
    const unsubscribed = typeof body.unsubscribed === "boolean" ? body.unsubscribed : null;
    await query(
      `UPDATE contacts
       SET marketing_permission = COALESCE($1, marketing_permission),
           unsubscribed = COALESCE($2, unsubscribed),
           updated_at = NOW()
       WHERE id = $3 AND business_id = $4`,
      [marketingPermission, unsubscribed, params.id, session.businessId]
    );
    if (unsubscribed === true) {
      await query("UPDATE contacts SET marketing_permission = FALSE WHERE id = $1 AND business_id = $2", [params.id, session.businessId]);
    }
    await audit(session, "contact_updated", { contactId: params.id });
    return json(await loadState(await currentAccount(request)));
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
    if (!name || !templateBody) throw new AppError("Template name and body are required.", 400, "VALIDATION_ERROR");

    const submitToMeta = Boolean(body.submitToMeta);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const metaTemplate = submitToMeta
      ? await createWhatsAppTemplate({ setup: business, name, body: templateBody })
      : { id: "", name: templateApiName(name), status: "DRAFT" };

    await query(
      `INSERT INTO templates (id, business_id, name, body, variables, status, meta_template_id, meta_template_name, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id("t"), session.businessId, name, templateBody, JSON.stringify(templateVariables(templateBody)), submitToMeta ? normalizeTemplateStatus(metaTemplate.status) : "Draft", metaTemplate.id, metaTemplate.name, submitToMeta ? "Meta submission" : "Manual draft"]
    );
    await audit(session, "template_created", { name, submitToMeta });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
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
      const body = templateBodyFromMeta(item.components);
      const status = normalizeTemplateStatus(item.status);
      await query(
        `INSERT INTO templates (id, business_id, name, category, body, variables, status, meta_template_id, meta_template_name, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Meta sync')
         ON CONFLICT (business_id, name) DO UPDATE
         SET category = EXCLUDED.category,
             body = EXCLUDED.body,
             variables = EXCLUDED.variables,
             status = EXCLUDED.status,
             meta_template_id = EXCLUDED.meta_template_id,
             meta_template_name = EXCLUDED.meta_template_name,
             source = 'Meta sync',
             updated_at = NOW()`,
        [id("t"), session.businessId, name, clean(item.category) || "Marketing", body, JSON.stringify(templateVariables(body)), status, clean(item.id), name]
      );
      synced += 1;
    }

    await audit(session, "templates_synced", { synced });
    return json(await loadState(await currentAccount(request)), 201);
  } catch (error) {
    return errorJson(error);
  }
}

export async function createCampaign(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const variables = body.variables || {};
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds : [];
    const templateResult = await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2", [body.templateId, session.businessId]);
    const template = templateResult.rows[0];
    if (!template || template.status !== "Approved") throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");

    const contactResult = await query(
      `SELECT * FROM contacts
       WHERE business_id = $1 AND id = ANY($2) AND marketing_permission = TRUE AND unsubscribed = FALSE`,
      [session.businessId, contactIds]
    );
    if (!contactResult.rows.length) throw new AppError("No opted-in contacts selected.", 400, "VALIDATION_ERROR");

    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    await transaction(async (client) => {
      const campaignId = id("k");
      await client.query(
        "INSERT INTO campaigns (id, business_id, name, template_id, variables, mode) VALUES ($1, $2, $3, $4, $5, $6)",
        [campaignId, session.businessId, clean(body.name) || "Untitled Campaign", template.id, JSON.stringify(variables), business.mode]
      );
      for (const contact of contactResult.rows) {
        const message = renderTemplate(template.body, mapContact(contact), variables);
        const meta = await sendTemplateMessage({
          setup: business,
          to: contact.phone,
          templateName: template.meta_template_name || templateApiName(template.name),
          variables: (template.variables || []).map((key) => key === "name" ? contact.name : variables[key] || "")
        });
        await client.query(
          `INSERT INTO campaign_recipients (id, campaign_id, contact_id, message, status, meta_message_id, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [id("r"), campaignId, contact.id, message, meta.status, meta.metaMessageId]
        );
      }
      await client.query("INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'campaign_sent', $3)", [id("e"), session.businessId, JSON.stringify({ recipients: contactResult.rows.length })]);
    });
    await audit(session, "campaign_created", { contacts: contactResult.rows.length });
    return json(await loadState(await currentAccount(request)), 201);
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
    if (!okToReply(contact)) throw new AppError("Normal reply period expired. Select an approved template to contact this customer.", 403, "REPLY_WINDOW_CLOSED");
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const messageBody = clean(body.body);
    const meta = await sendTextMessage({ setup: business, to: contact.phone, body: messageBody });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
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
    const template = (await query("SELECT * FROM templates WHERE id = $1 AND business_id = $2 AND status = 'Approved'", [body.templateId, session.businessId])).rows[0];
    if (!template) throw new AppError("Select an approved template.", 400, "VALIDATION_ERROR");
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    const message = renderTemplate(template.body, mapContact(contact), body.variables || {});
    const meta = await sendTemplateMessage({
      setup: business,
      to: contact.phone,
      templateName: template.meta_template_name || templateApiName(template.name),
      variables: (template.variables || []).map((key) => key === "name" ? contact.name : (body.variables || {})[key] || "")
    });
    const conversationId = await findOrCreateConversation(session.businessId, contact.id);
    await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id) VALUES ($1, $2, 'outgoing', $3, $4, $5)", [id("m"), conversationId, message, meta.status, meta.metaMessageId]);
    await audit(session, "template_reply_sent", { contactId: contact.id, templateId: template.id });
    return json(await loadState(await currentAccount(request)), 201);
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
    const body = await request.json().catch(() => ({}));
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const business = await businessForWebhook(value.metadata?.phone_number_id, entry.id);
        if (!business) continue;
        for (const message of value.messages || []) {
          const at = new Date(Number(message.timestamp || Date.now() / 1000) * 1000);
          const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || "[Unsupported message]";
          await ingestIncoming(business.id, message.from, text, at, message.id || "");
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

async function loadState(account) {
  const businessId = account.business.id;
  const [business, contacts, templates, campaigns, recipients, conversations, messages, events] = await Promise.all([
    query("SELECT * FROM businesses WHERE id = $1", [businessId]),
    query("SELECT * FROM contacts WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    query("SELECT * FROM templates WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    query("SELECT * FROM campaigns WHERE business_id = $1 ORDER BY created_at DESC", [businessId]),
    query(`SELECT cr.* FROM campaign_recipients cr JOIN campaigns c ON c.id = cr.campaign_id WHERE c.business_id = $1 ORDER BY cr.sent_at DESC NULLS LAST`, [businessId]),
    query("SELECT * FROM conversations WHERE business_id = $1 ORDER BY updated_at DESC", [businessId]),
    query(`SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.business_id = $1 ORDER BY m.at ASC`, [businessId]),
    query("SELECT * FROM events WHERE business_id = $1 ORDER BY at DESC LIMIT 50", [businessId])
  ]);
  const setup = business.rows[0];
  const campaignRows = campaigns.rows.map((campaign) => {
    const campaignRecipients = recipients.rows.filter((recipient) => recipient.campaign_id === campaign.id).map(mapRecipient);
    return { ...mapCampaign(campaign), recipients: campaignRecipients, stats: campaignStats(campaignRecipients) };
  });
  const conversationRows = conversations.rows.map((conversation) => {
    const contact = contacts.rows.find((item) => item.id === conversation.contact_id);
    return {
      id: conversation.id,
      contactId: conversation.contact_id,
      createdAt: toIso(conversation.created_at),
      updatedAt: toIso(conversation.updated_at),
      canReply: okToReply(contact),
      messages: messages.rows.filter((message) => message.conversation_id === conversation.id).map(mapMessage)
    };
  });
  return {
    account,
    setup: mapSetup(setup),
    contacts: contacts.rows.map(mapContact),
    templates: templates.rows.map(mapTemplate),
    campaigns: campaignRows,
    conversations: conversationRows,
    events: events.rows.map((event) => ({ id: event.id, type: event.type, contactId: event.contact_id, metadata: event.metadata || {}, at: toIso(event.at) })),
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

async function findOrCreateConversation(businessId, contactId) {
  const existing = await query("SELECT id FROM conversations WHERE business_id = $1 AND contact_id = $2", [businessId, contactId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const conversationId = id("v");
  await query("INSERT INTO conversations (id, business_id, contact_id) VALUES ($1, $2, $3)", [conversationId, businessId, contactId]);
  return conversationId;
}

async function ingestIncoming(businessId, phone, text, at, metaMessageId = "") {
  const cleanNumber = cleanPhone(phone);
  let contact = (await query("SELECT * FROM contacts WHERE business_id = $1 AND phone = $2", [businessId, cleanNumber])).rows[0];
  if (!contact) {
    const contactId = id("c");
    await query("INSERT INTO contacts (id, business_id, name, phone, source) VALUES ($1, $2, $3, $4, 'Meta webhook')", [contactId, businessId, cleanNumber, cleanNumber]);
    contact = await findContact(businessId, contactId);
  }
  await query("UPDATE contacts SET last_message_at = $1, updated_at = NOW() WHERE id = $2", [at, contact.id]);
  const conversationId = await findOrCreateConversation(businessId, contact.id);
  await query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [conversationId]);
  await query("INSERT INTO messages (id, conversation_id, direction, body, status, meta_message_id, at) VALUES ($1, $2, 'incoming', $3, 'received', $4, $5)", [id("m"), conversationId, text, metaMessageId, at]);
  if (/^(stop|unsubscribe|opt out)$/i.test(String(text).trim())) {
    await query("UPDATE contacts SET marketing_permission = FALSE, unsubscribed = TRUE, updated_at = NOW() WHERE id = $1", [contact.id]);
    await query("INSERT INTO events (id, business_id, type, contact_id) VALUES ($1, $2, 'unsubscribe', $3)", [id("e"), businessId, contact.id]);
  }
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
     SET status = $1, updated_at = NOW()
     WHERE business_id = $2 AND (meta_template_name = $3 OR meta_template_id = $4)`,
    [status, businessId, templateName || "", templateId || ""]
  );
}
async function updateDeliveryStatus(businessId, statusUpdate) {
  if (!["sent", "delivered", "read", "failed"].includes(statusUpdate.status)) return;
  await query(
    `UPDATE campaign_recipients cr
     SET status = $1, updated_at = NOW()
     FROM campaigns c
     WHERE cr.campaign_id = c.id AND c.business_id = $2 AND cr.meta_message_id = $3`,
    [statusUpdate.status, businessId, statusUpdate.id]
  );
}

async function audit(session, action, metadata = {}) {
  await query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, $4, $5)", [id("a"), session.businessId, session.userId, action, JSON.stringify(metadata)]);
}

function templateBodyFromMeta(components = []) {
  const body = components.find((component) => String(component.type || "").toUpperCase() === "BODY");
  return clean(body?.text || "");
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
    createdAt: toIso(row.created_at)
  };
}

function mapTemplate(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    body: row.body,
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
    sentAt: toIso(row.sent_at)
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    metaMessageId: row.meta_message_id,
    at: toIso(row.at)
  };
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
    sent: recipients.filter((r) => ["sent", "delivered", "read"].includes(r.status)).length,
    delivered: recipients.filter((r) => ["delivered", "read"].includes(r.status)).length,
    read: recipients.filter((r) => r.status === "read").length,
    failed: recipients.filter((r) => r.status === "failed").length
  };
}








