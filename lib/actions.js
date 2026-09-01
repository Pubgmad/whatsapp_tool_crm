import { campaignStats, id, json, loadStore, publicStore, renderTemplate, resetStore, saveStore, templateVariables, okToReply } from "./store";

export function getState() { return json(publicStore(loadStore())); }

export async function resetData(request) {
  const body = await request.json().catch(() => ({}));
  return json(publicStore(resetStore(body.demo !== false)));
}

export async function updateSetup(request) {
  const store = loadStore();
  const body = await request.json();
  store.setup = {
    ...store.setup,
    businessName: String(body.businessName || "").trim(),
    whatsappNumber: String(body.whatsappNumber || "").trim(),
    wabaId: String(body.wabaId || "").trim(),
    phoneNumberId: String(body.phoneNumberId || "").trim(),
    accessToken: body.accessToken === "saved-token-hidden" ? store.setup.accessToken : String(body.accessToken || "").trim(),
    webhookUrl: String(body.webhookUrl || store.setup.webhookUrl || "").trim(),
    mode: body.mode === "Live Meta" ? "Live Meta" : "Mock Meta",
    status: body.phoneNumberId && body.wabaId ? "Connected" : "Needs setup"
  };
  saveStore(store);
  return json(publicStore(store));
}

export async function createContact(request) {
  const store = loadStore();
  const body = await request.json();
  const contact = {
    id: id("c"),
    name: String(body.name || "").trim(),
    phone: String(body.phone || "").trim(),
    marketingPermission: Boolean(body.marketingPermission),
    unsubscribed: !body.marketingPermission,
    lastMessageAt: null,
    source: "Manual"
  };
  if (!contact.name || !contact.phone) return json({ error: "Name and phone are required." }, 400);
  store.contacts.push(contact);
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function importContacts(request) {
  const store = loadStore();
  const body = await request.json();
  const rows = String(body.csv || "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  rows.forEach((row) => {
    const [name, phone, permission = "yes"] = row.split(",").map((cell) => (cell || "").trim());
    if (!name || !phone) return;
    const allowed = /^(yes|true|1|allowed|opted in)$/i.test(permission);
    store.contacts.push({ id: id("c"), name, phone, marketingPermission: allowed, unsubscribed: !allowed, lastMessageAt: null, source: "CSV import" });
  });
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function patchContact(request, { params }) {
  const store = loadStore();
  const body = await request.json().catch(() => ({}));
  const contact = store.contacts.find((item) => item.id === params.id);
  if (!contact) return json({ error: "Contact not found." }, 404);
  if (typeof body.marketingPermission === "boolean") contact.marketingPermission = body.marketingPermission;
  if (typeof body.unsubscribed === "boolean") contact.unsubscribed = body.unsubscribed;
  if (contact.unsubscribed) contact.marketingPermission = false;
  saveStore(store);
  return json(publicStore(store));
}

export async function deleteContact(_request, { params }) {
  const store = loadStore();
  store.contacts = store.contacts.filter((item) => item.id !== params.id);
  store.conversations = store.conversations.filter((item) => item.contactId !== params.id);
  store.campaigns.forEach((campaign) => {
    campaign.recipients = campaign.recipients.filter((item) => item.contactId !== params.id);
    campaign.stats = campaignStats(campaign.recipients);
  });
  saveStore(store);
  return json(publicStore(store));
}

export async function createTemplate(request) {
  const store = loadStore();
  const body = await request.json();
  const template = {
    id: id("t"),
    name: String(body.name || "").trim(),
    category: "Marketing",
    body: String(body.body || "").trim(),
    variables: templateVariables(body.body),
    status: body.submitToMeta ? "Pending" : "Draft",
    metaTemplateId: body.submitToMeta ? id("meta_tpl") : "",
    source: body.submitToMeta ? "Mock Meta submission" : "Manual draft"
  };
  if (!template.name || !template.body) return json({ error: "Template name and body are required." }, 400);
  store.templates.push(template);
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function patchTemplate(request, { params }) {
  const store = loadStore();
  const body = await request.json();
  const template = store.templates.find((item) => item.id === params.id);
  if (!template) return json({ error: "Template not found." }, 404);
  if (["Draft", "Pending", "Approved", "Rejected"].includes(body.status)) template.status = body.status;
  saveStore(store);
  return json(publicStore(store));
}

export async function createCampaign(request) {
  const store = loadStore();
  const body = await request.json();
  const template = store.templates.find((item) => item.id === body.templateId);
  if (!template || template.status !== "Approved") return json({ error: "Select an approved template." }, 400);
  const selectedContacts = store.contacts.filter((contact) =>
    (body.contactIds || []).includes(contact.id) && contact.marketingPermission && !contact.unsubscribed
  );
  if (!selectedContacts.length) return json({ error: "No opted-in contacts selected." }, 400);
  const recipients = selectedContacts.map((contact, index) => {
    const status = index % 11 === 0 ? "failed" : index % 3 === 0 ? "read" : index % 2 === 0 ? "delivered" : "sent";
    return { contactId: contact.id, message: renderTemplate(template.body, contact, body.variables), status, metaMessageId: id("wamid"), sentAt: new Date().toISOString() };
  });
  store.campaigns.unshift({
    id: id("k"),
    name: String(body.name || "Untitled Campaign").trim(),
    templateId: template.id,
    variables: body.variables || {},
    recipients,
    stats: campaignStats(recipients),
    createdAt: new Date().toISOString(),
    mode: store.setup.mode
  });
  store.events.unshift({ id: id("e"), type: "campaign_sent", at: new Date().toISOString() });
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function sendReply(request) {
  const store = loadStore();
  const body = await request.json();
  const contact = store.contacts.find((item) => item.id === body.contactId);
  if (!contact) return json({ error: "Contact not found." }, 404);
  if (!okToReply(contact)) return json({ error: "Normal reply period expired. Select an approved template to contact this customer." }, 403);
  const conversation = findOrCreateConversation(store, contact.id);
  conversation.messages.push({ id: id("m"), direction: "outgoing", body: String(body.body || "").trim(), at: new Date().toISOString(), status: "sent" });
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function sendTemplateReply(request) {
  const store = loadStore();
  const body = await request.json();
  const contact = store.contacts.find((item) => item.id === body.contactId);
  const template = store.templates.find((item) => item.id === body.templateId);
  if (!contact) return json({ error: "Contact not found." }, 404);
  if (!template || template.status !== "Approved") return json({ error: "Select an approved template." }, 400);
  const conversation = findOrCreateConversation(store, contact.id);
  conversation.messages.push({ id: id("m"), direction: "outgoing", body: renderTemplate(template.body, contact, body.variables || {}), at: new Date().toISOString(), status: "sent" });
  saveStore(store);
  return json(publicStore(store), 201);
}

export async function mockIncoming(request) {
  const store = loadStore();
  const body = await request.json();
  const contact = store.contacts.find((item) => item.id === body.contactId);
  if (!contact) return json({ error: "Contact not found." }, 404);
  const messageText = String(body.body || "").trim();
  contact.lastMessageAt = new Date().toISOString();
  const conversation = findOrCreateConversation(store, contact.id);
  conversation.messages.push({ id: id("m"), direction: "incoming", body: messageText, at: contact.lastMessageAt, status: "received" });
  if (/^(stop|unsubscribe|opt out)$/i.test(messageText)) {
    contact.marketingPermission = false;
    contact.unsubscribed = true;
    store.events.unshift({ id: id("e"), type: "unsubscribe", contactId: contact.id, at: new Date().toISOString() });
  }
  saveStore(store);
  return json(publicStore(store), 201);
}

export function verifyMetaWebhook(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN || "change-me";
  if (mode && token && token !== expected) return new Response("Forbidden", { status: 403 });
  return new Response(challenge || "ok", { status: 200 });
}

export async function receiveMetaWebhook(request) {
  const store = loadStore();
  const body = await request.json().catch(() => ({}));
  const changes = body.entry?.flatMap((entry) => entry.changes || []) || [];
  changes.forEach((change) => {
    const value = change.value || {};
    (value.messages || []).forEach((message) => ingestIncomingMetaMessage(store, message));
    (value.statuses || []).forEach((statusUpdate) => ingestStatusUpdate(store, statusUpdate));
  });
  store.events.unshift({ id: id("e"), type: "meta_webhook", at: new Date().toISOString() });
  saveStore(store);
  return json({ ok: true });
}

function findOrCreateConversation(store, contactId) {
  let conversation = store.conversations.find((item) => item.contactId === contactId);
  if (!conversation) {
    conversation = { id: id("v"), contactId, messages: [] };
    store.conversations.unshift(conversation);
  }
  return conversation;
}

function ingestIncomingMetaMessage(store, message) {
  const digits = String(message.from || "").replace(/\D/g, "");
  let contact = store.contacts.find((item) => item.phone.replace(/\D/g, "") === digits);
  if (!contact) {
    contact = { id: id("c"), name: `+${digits}`, phone: `+${digits}`, marketingPermission: false, unsubscribed: false, lastMessageAt: null, source: "Meta webhook" };
    store.contacts.push(contact);
  }
  const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || "[Unsupported message]";
  contact.lastMessageAt = new Date(Number(message.timestamp || Date.now() / 1000) * 1000).toISOString();
  const conversation = findOrCreateConversation(store, contact.id);
  conversation.messages.push({ id: id("m"), direction: "incoming", body: text, at: contact.lastMessageAt, status: "received" });
  if (/^(stop|unsubscribe|opt out)$/i.test(text.trim())) {
    contact.marketingPermission = false;
    contact.unsubscribed = true;
  }
}

function ingestStatusUpdate(store, statusUpdate) {
  store.campaigns.forEach((campaign) => {
    const recipient = campaign.recipients.find((item) => item.metaMessageId === statusUpdate.id);
    if (recipient && ["sent", "delivered", "read", "failed"].includes(statusUpdate.status)) {
      recipient.status = statusUpdate.status;
      campaign.stats = campaignStats(campaign.recipients);
    }
  });
}
