import { toIso } from './db.js';
import { publicMetaHealth } from './meta-health.js';
import { okToReply } from './reply-window.js';

export function templateComponentsFromMeta(components = []) {
  const get = (type) => components.find((component) => String(component.type || "").toUpperCase() === type) || {};
  const header = get("HEADER");
  const body = get("BODY");
  const footer = get("FOOTER");
  const buttons = get("BUTTONS");
  const mappedButtons = (buttons.buttons || []).map((button) => ({
    type: clean(button.type || "QUICK_REPLY").toUpperCase(),
    text: clean(button.text),
    value: clean(button.url || button.phone_number || "")
  }));
  return {
    headerText: String(header.format || "").toUpperCase() === "TEXT" ? clean(header.text) : "",
    body: clean(body.text),
    footerText: clean(footer.text),
    buttons: mappedButtons,
    componentSchema: {
      kind:get('LIMITED_TIME_OFFER').limited_time_offer?'LIMITED_TIME_OFFER':(buttons.buttons||[]).some(button=>String(button.type).toUpperCase()==='COPY_CODE')?'COUPON':get('CAROUSEL').cards?(get('CAROUSEL').cards[0]?.components?.some(component=>component.type==='HEADER'&&component.format==='PRODUCT')?'PRODUCT_CAROUSEL':'CAROUSEL'):(buttons.buttons||[]).some(button=>String(button.type).toUpperCase()==='CATALOG')?'CATALOG':'STANDARD',
      components,
      headerFormat: clean(header.format || "NONE").toUpperCase(),
      headerMediaHandle: clean(header.example?.header_handle?.[0]),
      buttons: mappedButtons,
      addSecurityRecommendation: body.add_security_recommendation,
      codeExpirationMinutes: footer.code_expiration_minutes,
      otpType: clean((buttons.buttons || []).find((button) => String(button.type).toUpperCase() === "OTP")?.otp_type),
      otpButtonText: clean((buttons.buttons || []).find((button) => String(button.type).toUpperCase() === "OTP")?.text)
    }
  };
}

export function normalizeTemplateButtons(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\n,]/).map((text) => ({ text }));
  return items.map((button) => ({ type: "QUICK_REPLY", text: clean(button?.text || button).slice(0, 25) })).filter((button) => button.text).slice(0, 3);
}
export function normalizeTemplateStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "approved") return "Approved";
  if (value === "rejected") return "Rejected";
  if (value === "draft") return "Draft";
  return "Pending";
}

export function mapConversation(row, contact, messages = [], notes = []) {
  return {
    id: row.id,
    contactId: row.contact_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    canReply: okToReply(contact),
    assignedUserId: row.assigned_user_id || '',
    automationPaused: Boolean(row.automation_paused),
    status: row.status || 'open',
    unreadCount: Number(row.unread_count || 0),
    lastReadAt: toIso(row.last_read_at),
    version: Number(row.version || 0),
    firstReferral: row.first_referral || null,
    firstReferralAt: toIso(row.first_referral_at),
    notes,
    messages
  };
}

export function mapSetup(row, health) {
  return {
    businessName: row?.name || "",
    whatsappNumber: row?.whatsapp_number || "",
    wabaId: row?.waba_id || "",
    phoneNumberId: row?.phone_number_id || "",
    accessToken: row?.access_token_encrypted ? "saved-token-hidden" : "",
    webhookUrl: row?.webhook_url || "",
    mode: row?.mode || "Live Meta",
    status: row?.status || "Needs setup",
    onboardingMethod: row?.onboarding_method || "manual",
    connectedAt: toIso(row?.meta_connected_at),
    tokenExpiresAt: toIso(row?.meta_token_expires_at),
    webhookSubscribed: Boolean(row?.webhook_subscribed),
    connectionMetadata: row?.meta_connection_metadata || {},
    health: publicMetaHealth(health)
  };
}

export function mapContact(row) {
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

export function mapTemplate(row) {
  return {
    id: row.id,
    wabaId: row.waba_id || "",
    name: row.name,
    category: row.category,
    language: row.language || "en_US",
    rejectionReason: row.rejection_reason || "",
    headerText: row.header_text || "",
    body: row.body,
    footerText: row.footer_text || "",
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    componentSchema: row.component_schema || {},
    variables: row.variables || [],
    status: row.status,
    metaTemplateId: row.meta_template_id || "",
    metaTemplateName: row.meta_template_name || "",
    source: row.source,
    contentRevision: Number(row.content_revision) || 1,
    createdAt: toIso(row.created_at)
  };
}

export function mapCampaign(row) {
  return {
    id: row.id,
    phoneNumberId: row.whatsapp_phone_number_id || "",
    name: row.name,
    templateId: row.template_id,
    deliveryMethod: row.delivery_method || 'cloud_api',
    approvalStatus: row.approval_status,
    frequencyHours: row.frequency_hours,
    recurringIntervalDays: Number(row.recurring_interval_days) || 0,
    recurringParentId: row.recurring_parent_id || null,
    reviewNote: row.review_note || '',
    reviewedAt: toIso(row.reviewed_at),
    sourceCampaignId: row.source_campaign_id || null,
    sourceKind: row.source_kind || 'unknown',
    sourceId: row.source_id || null,
    audienceSegmentId: row.audience_segment_id || null,
    retargetSourceCampaignId: row.retarget_source_campaign_id || null,
    dynamicAudience: Boolean(row.dynamic_audience),
    variables: row.variables || {},
    status: row.status || "queued",
    scheduledAt: toIso(row.scheduled_at),
    timezone: row.timezone || "UTC",
    createdAt: toIso(row.created_at),
    mode: row.mode
  };
}

export function mapRecipient(row) {
  return {
    id: row.id,
    contactId: row.contact_id,
    message: row.message,
    status: row.status,
    metaMessageId: row.meta_message_id,
    sourceKind: row.source_kind || 'unknown',
    sourceId: row.source_id || null,
    sentAt: toIso(row.sent_at),
    errorMessage: row.error_message || "",
    jobStatus: row.job_status || null,
    attempts: row.job_attempts ?? null,
    maxAttempts: row.job_max_attempts ?? null,
    nextRunAt: ['queued','retry'].includes(row.job_status) ? toIso(row.job_run_at) : null,
    jobError: row.job_error_message || '',
    replied: Boolean(row.replied)
  };
}
export function mapMessage(row) {
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

export function parseCsvRows(value) {
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

export function isHeaderRow(name, phone, permission) {
  return /^name$/i.test(name) && /^phone|mobile|whatsapp/i.test(phone) && (!permission || /^permission|opt/i.test(permission));
}

export function permissionFromCell(value) {
  return /^(yes|y|true|1|allowed|allow|opted in|opted-in|subscribed)$/i.test(clean(value));
}

export function normalizeAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [clean(key).slice(0, 64), clean(item).slice(0, 500)])
    .filter(([key]) => key)
    .slice(0, 50));
}

export function csvCell(value) {
  let content = value === null || value === undefined ? "" : String(value);
  if (/^[\s\x00-\x1f]*[=+\-@]/.test(content)) content = `'${content}`;
  return `"${content.replace(/"/g, '""')}"`;
}
export function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[,\n]/);
  return [...new Set(values.map((item) => clean(item).toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function clean(value) {
  return String(value || "").trim();
}

export function cleanPhone(value) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
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

