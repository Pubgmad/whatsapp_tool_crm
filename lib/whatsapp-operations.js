import { requireSession } from "./auth";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { decryptSecret } from "./meta";

const graphVersion = () => process.env.META_GRAPH_API_VERSION || "v26.0";
const graphUrl = (path) => `https://graph.facebook.com/${graphVersion()}/${path}`;
const clean = (value) => String(value || "").trim();

const CAPABILITY_DEFINITIONS = [
  { key: "cloud_api", name: "Cloud API messaging", prerequisite: "Connected WABA and registered phone number" },
  { key: "webhooks", name: "Incoming messages and delivery webhooks", prerequisite: "App subscribed to the WABA messages field" },
  { key: "templates", name: "Message template management", prerequisite: "whatsapp_business_management" },
  { key: "interactive_messages", name: "Lists and reply buttons", prerequisite: "Open 24-hour customer service window" },
  { key: "native_flows", name: "WhatsApp Flows", prerequisite: "Eligible WABA, published Flow, and encryption endpoint when data exchange is used" },
  { key: "authentication_templates", name: "Authentication and OTP templates", prerequisite: "Authentication template approval and OTP compliance" },
  { key: "media_templates", name: "Media and advanced templates", prerequisite: "Approved template with uploaded media handle" },
  { key: "coexistence", name: "Business App coexistence", prerequisite: "Eligible number and Embedded Signup coexistence onboarding" },
  { key: "catalogs", name: "Catalog and commerce messages", prerequisite: "Commerce catalog linked to the WABA and catalog permissions" },
  { key: "ctwa", name: "Click-to-WhatsApp ads", prerequisite: "Meta ad account, Page, Marketing API permissions, and separate App Review" },
  { key: "marketing_messages_api", name: "Marketing Messages API", prerequisite: "Meta product availability and business eligibility" },
  { key: "calling", name: "WhatsApp Business Calling", prerequisite: "Calling eligibility, phone settings, and calling webhook subscription" },
  { key: "billing_visibility", name: "Meta billing visibility", prerequisite: "Owned or shared credit line and eligible business-management access" }
];

function assertManager(session) {
  if (!["Owner", "Manager"].includes(session.role)) {
    throw new AppError("Only workspace owners and managers can change WhatsApp settings.", 403, "FORBIDDEN");
  }
}

async function graphRequest(path, token, options = {}) {
  const response = await fetch(graphUrl(path), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error || {};
    throw new AppError(error.error_user_msg || error.message || "Meta request failed.", response.status, clean(error.code) || "META_REQUEST_FAILED");
  }
  return payload;
}

async function accountForBusiness(businessId, accountId = "") {
  const result = await query(
    `SELECT * FROM whatsapp_accounts
     WHERE business_id = $1 AND ($2 = '' OR id = $2)
     ORDER BY CASE WHEN id = $2 THEN 0 WHEN is_default THEN 1 ELSE 2 END, created_at
     LIMIT 1`,
    [businessId, clean(accountId)]
  );
  const account = result.rows[0];
  if (!account?.access_token_encrypted) throw new AppError("Connect WhatsApp through Meta before using this feature.", 400, "META_NOT_CONFIGURED");
  return { account, token: decryptSecret(account.access_token_encrypted) };
}

async function phoneForBusiness(businessId, phoneRecordId = "") {
  const result = await query(
    `SELECT p.*, a.waba_id, a.access_token_encrypted, a.token_expires_at
     FROM whatsapp_phone_numbers p
     JOIN whatsapp_accounts a ON a.id = p.whatsapp_account_id AND a.business_id = p.business_id
     WHERE p.business_id = $1 AND ($2 = '' OR p.id = $2 OR p.phone_number_id = $2)
     ORDER BY CASE WHEN p.id = $2 OR p.phone_number_id = $2 THEN 0 WHEN p.is_default THEN 1 ELSE 2 END, p.created_at
     LIMIT 1`,
    [businessId, clean(phoneRecordId)]
  );
  const phone = result.rows[0];
  if (!phone?.access_token_encrypted) throw new AppError("No WhatsApp phone number is connected.", 400, "META_PHONE_NOT_CONFIGURED");
  return { phone, token: decryptSecret(phone.access_token_encrypted) };
}

function tokenHealth(expiresAt) {
  if (!expiresAt) return { status: "unknown", expiresAt: null, daysRemaining: null };
  const remaining = new Date(expiresAt).getTime() - Date.now();
  const daysRemaining = Math.floor(remaining / 86400000);
  return { status: remaining <= 0 ? "expired" : daysRemaining <= 7 ? "expiring" : "healthy", expiresAt: toIso(expiresAt), daysRemaining };
}

function capabilityState(account, phones, flows, templates) {
  const configured = account?.capabilities || {};
  const activePhone = phones.find((item) => item.is_default) || phones[0];
  const inferred = {
    cloud_api: Boolean(account && activePhone),
    webhooks: Boolean(account?.webhook_subscribed),
    templates: Boolean(account),
    interactive_messages: Boolean(account && activePhone),
    native_flows: flows.some((flow) => flow.meta_flow_id && flow.status === "published"),
    authentication_templates: templates.some((template) => template.category === "AUTHENTICATION" && template.status === "Approved"),
    media_templates: templates.some((template) =>
      template.status === "Approved" && ["IMAGE", "VIDEO", "DOCUMENT"].includes(String(template.component_schema?.headerFormat || "").toUpperCase())),
    coexistence: String(activePhone?.platform_type || "").toUpperCase().includes("COEXIST"),
    catalogs: Boolean(configured.catalogs),
    ctwa: Boolean(configured.ctwa),
    marketing_messages_api: Boolean(configured.marketing_messages_api),
    calling: Boolean(configured.calling),
    billing_visibility: Boolean(configured.billing_visibility)
  };
  return CAPABILITY_DEFINITIONS.map((item) => ({
    ...item,
    status: inferred[item.key] ? "available" : ["cloud_api", "webhooks", "templates", "interactive_messages", "native_flows", "authentication_templates", "media_templates"].includes(item.key) ? "setup" : "requires_meta",
    detail: clean(configured[item.key]?.detail || configured[item.key])
  }));
}

function mapAccount(row) {
  return {
    id: row.id,
    wabaId: row.waba_id,
    name: row.name || "",
    currency: row.currency || "",
    timezoneId: row.timezone_id || "",
    status: row.status,
    onboardingMethod: row.onboarding_method,
    webhookSubscribed: Boolean(row.webhook_subscribed),
    isDefault: Boolean(row.is_default),
    token: tokenHealth(row.token_expires_at),
    lastSyncedAt: toIso(row.last_synced_at)
  };
}

function mapPhone(row) {
  return {
    id: row.id,
    accountId: row.whatsapp_account_id,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number || "",
    verifiedName: row.verified_name || "",
    qualityRating: row.quality_rating || "UNKNOWN",
    status: row.status || "UNKNOWN",
    codeVerificationStatus: row.code_verification_status || "UNKNOWN",
    nameStatus: row.name_status || "UNKNOWN",
    platformType: row.platform_type || "CLOUD_API",
    messagingLimitTier: row.messaging_limit_tier || "Unavailable",
    registrationState: row.registration_state || "unknown",
    isDefault: Boolean(row.is_default),
    profile: row.profile || {},
    lastSyncedAt: toIso(row.last_synced_at)
  };
}

function mapFlow(row) {
  return {
    id: row.id,
    accountId: row.whatsapp_account_id || "",
    metaFlowId: row.meta_flow_id || "",
    name: row.name,
    category: row.category,
    status: row.status,
    endpointUri: row.endpoint_uri || "",
    flowJson: row.flow_json || {},
    validationErrors: row.validation_errors || [],
    updatedAt: toIso(row.updated_at)
  };
}

export async function getWhatsAppOperationsState(businessId) {
  const [accountsResult, phonesResult, flowsResult, analyticsResult, templatesResult] = await Promise.all([
    query("SELECT * FROM whatsapp_accounts WHERE business_id = $1 ORDER BY is_default DESC, created_at", [businessId]),
    query("SELECT * FROM whatsapp_phone_numbers WHERE business_id = $1 ORDER BY is_default DESC, created_at", [businessId]),
    query("SELECT * FROM whatsapp_native_flows WHERE business_id = $1 ORDER BY updated_at DESC", [businessId]),
    query("SELECT * FROM whatsapp_analytics_snapshots WHERE business_id = $1 ORDER BY collected_at DESC LIMIT 12", [businessId]),
    query("SELECT category, status, component_schema FROM templates WHERE business_id = $1", [businessId])
  ]);
  const account = accountsResult.rows.find((item) => item.is_default) || accountsResult.rows[0];
  return {
    accounts: accountsResult.rows.map(mapAccount),
    phoneNumbers: phonesResult.rows.map(mapPhone),
    nativeFlows: flowsResult.rows.map(mapFlow),
    capabilities: capabilityState(account, phonesResult.rows, flowsResult.rows, templatesResult.rows),
    analytics: analyticsResult.rows.map((row) => ({
      id: row.id,
      metricType: row.metric_type,
      phoneNumberId: row.phone_number_id || "",
      periodStart: toIso(row.period_start),
      periodEnd: toIso(row.period_end),
      payload: row.payload || {},
      collectedAt: toIso(row.collected_at)
    }))
  };
}

async function syncAccount(businessId, requestedAccountId = "") {
  const { account, token } = await accountForBusiness(businessId, requestedAccountId);
  const waba = await graphRequest(`${encodeURIComponent(account.waba_id)}?fields=id,name,currency,timezone_id`, token);
  const numbers = await graphRequest(`${encodeURIComponent(account.waba_id)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status&limit=100`, token);
  const enrichedNumbers = [];
  for (const item of numbers.data || []) {
    let details = {};
    try {
      details = await graphRequest(`${encodeURIComponent(item.id)}?fields=code_verification_status,name_status,platform_type,messaging_limit_tier`, token);
    } catch {}
    enrichedNumbers.push({ ...item, ...details });
  }
  await transaction(async (client) => {
    await client.query(
      `UPDATE whatsapp_accounts SET name = $1, currency = $2, timezone_id = $3, status = 'connected', last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $4 AND business_id = $5`,
      [clean(waba.name), clean(waba.currency), clean(waba.timezone_id), account.id, businessId]
    );
    for (const item of enrichedNumbers) {
      await client.query(
        `INSERT INTO whatsapp_phone_numbers
          (id, business_id, whatsapp_account_id, phone_number_id, display_phone_number, verified_name, quality_rating, status, code_verification_status, name_status, platform_type, messaging_limit_tier, is_default, registration_state, metadata, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
           NOT EXISTS (SELECT 1 FROM whatsapp_phone_numbers WHERE business_id = $2),
           CASE WHEN $8 IN ('CONNECTED','READY') THEN 'registered' ELSE 'unknown' END,$13,NOW())
         ON CONFLICT (business_id, phone_number_id) DO UPDATE SET
           whatsapp_account_id=EXCLUDED.whatsapp_account_id, display_phone_number=EXCLUDED.display_phone_number,
           verified_name=EXCLUDED.verified_name, quality_rating=EXCLUDED.quality_rating, status=EXCLUDED.status,
           code_verification_status=EXCLUDED.code_verification_status, name_status=EXCLUDED.name_status,
           platform_type=EXCLUDED.platform_type, messaging_limit_tier=EXCLUDED.messaging_limit_tier,
           registration_state=EXCLUDED.registration_state, metadata=EXCLUDED.metadata, last_synced_at=NOW(), updated_at=NOW()`,
        [id("wap"), businessId, account.id, String(item.id), clean(item.display_phone_number), clean(item.verified_name),
          clean(item.quality_rating), clean(item.status), clean(item.code_verification_status), clean(item.name_status),
          clean(item.platform_type), clean(item.messaging_limit_tier), JSON.stringify(item)]
      );
    }
  });
  return getWhatsAppOperationsState(businessId);
}

async function requestVerificationCode(businessId, phoneId, method, language) {
  const { phone, token } = await phoneForBusiness(businessId, phoneId);
  const codeMethod = clean(method).toUpperCase() === "VOICE" ? "VOICE" : "SMS";
  await graphRequest(`${encodeURIComponent(phone.phone_number_id)}/request_code`, token, {
    method: "POST",
    body: JSON.stringify({ code_method: codeMethod, language: clean(language) || "en_US" })
  });
  await query("UPDATE whatsapp_phone_numbers SET code_verification_status='CODE_REQUESTED',updated_at=NOW() WHERE id=$1 AND business_id=$2", [phone.id, businessId]);
}

async function verifyPhoneCode(businessId, phoneId, code) {
  if (!/^\d{4,8}$/.test(clean(code))) throw new AppError("Enter the verification code sent by Meta.", 400, "INVALID_VERIFICATION_CODE");
  const { phone, token } = await phoneForBusiness(businessId, phoneId);
  await graphRequest(`${encodeURIComponent(phone.phone_number_id)}/verify_code`, token, {
    method: "POST",
    body: JSON.stringify({ code: clean(code) })
  });
  await query("UPDATE whatsapp_phone_numbers SET code_verification_status='VERIFIED',updated_at=NOW() WHERE id=$1 AND business_id=$2", [phone.id, businessId]);
}

async function selectPhone(businessId, phoneId) {
  const { phone } = await phoneForBusiness(businessId, phoneId);
  await transaction(async (client) => {
    await client.query("UPDATE whatsapp_accounts SET is_default = (id = $1), updated_at = NOW() WHERE business_id = $2", [phone.whatsapp_account_id, businessId]);
    await client.query("UPDATE whatsapp_phone_numbers SET is_default = (id = $1), updated_at = NOW() WHERE business_id = $2", [phone.id, businessId]);
    await client.query(
      `UPDATE businesses SET waba_id=$1, phone_number_id=$2, whatsapp_number=$3, access_token_encrypted=$4,
       meta_token_expires_at=$5, meta_connection_metadata=$6, status='Connected', updated_at=NOW() WHERE id=$7`,
      [phone.waba_id, phone.phone_number_id, phone.display_phone_number, phone.access_token_encrypted, phone.token_expires_at,
        JSON.stringify({ verifiedName: phone.verified_name, qualityRating: phone.quality_rating, phoneStatus: phone.status }), businessId]
    );
  });
}

async function registerPhone(businessId, phoneId, pin) {
  if (!/^\d{6}$/.test(clean(pin))) throw new AppError("Enter the six-digit two-step verification PIN.", 400, "INVALID_PIN");
  const { phone, token } = await phoneForBusiness(businessId, phoneId);
  await graphRequest(`${encodeURIComponent(phone.phone_number_id)}/register`, token, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", pin: clean(pin) })
  });
  await query("UPDATE whatsapp_phone_numbers SET registration_state='registered', last_synced_at=NOW(), updated_at=NOW() WHERE id=$1 AND business_id=$2", [phone.id, businessId]);
}

async function syncProfile(businessId, phoneId) {
  const { phone, token } = await phoneForBusiness(businessId, phoneId);
  const payload = await graphRequest(`${encodeURIComponent(phone.phone_number_id)}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, token);
  const profile = payload.data?.[0] || {};
  await query("UPDATE whatsapp_phone_numbers SET profile=$1, last_synced_at=NOW(), updated_at=NOW() WHERE id=$2 AND business_id=$3", [JSON.stringify(profile), phone.id, businessId]);
  return profile;
}

async function updateProfile(businessId, phoneId, input) {
  const { phone, token } = await phoneForBusiness(businessId, phoneId);
  const profile = {
    messaging_product: "whatsapp",
    about: clean(input.about).slice(0, 139),
    address: clean(input.address).slice(0, 256),
    description: clean(input.description).slice(0, 512),
    email: clean(input.email).slice(0, 128),
    vertical: clean(input.vertical) || "OTHER",
    websites: (Array.isArray(input.websites) ? input.websites : String(input.websites || "").split(/[\n,]/)).map(clean).filter(Boolean).slice(0, 2)
  };
  await graphRequest(`${encodeURIComponent(phone.phone_number_id)}/whatsapp_business_profile`, token, { method: "POST", body: JSON.stringify(profile) });
  await query("UPDATE whatsapp_phone_numbers SET profile=$1, last_synced_at=NOW(), updated_at=NOW() WHERE id=$2 AND business_id=$3", [JSON.stringify(profile), phone.id, businessId]);
}

async function syncAnalytics(businessId, accountId, input) {
  const { account, token } = await accountForBusiness(businessId, accountId);
  const end = input.end ? new Date(input.end) : new Date();
  const start = input.start ? new Date(input.start) : new Date(end.getTime() - 30 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new AppError("Choose a valid analytics date range.", 400, "INVALID_DATE_RANGE");
  const startEpoch = Math.floor(start.getTime() / 1000);
  const endEpoch = Math.floor(end.getTime() / 1000);
  const fields = `analytics.start(${startEpoch}).end(${endEpoch}).granularity(DAY),conversation_analytics.start(${startEpoch}).end(${endEpoch}).granularity(DAILY)`;
  const payload = await graphRequest(`${encodeURIComponent(account.waba_id)}?fields=${encodeURIComponent(fields)}`, token);
  await query(
    "INSERT INTO whatsapp_analytics_snapshots (id,business_id,whatsapp_account_id,metric_type,period_start,period_end,payload) VALUES ($1,$2,$3,'waba',$4,$5,$6)",
    [id("waa"), businessId, account.id, start, end, JSON.stringify(payload)]
  );
  return payload;
}

async function syncFlows(businessId, accountId) {
  const { account, token } = await accountForBusiness(businessId, accountId);
  const payload = await graphRequest(`${encodeURIComponent(account.waba_id)}/flows?fields=id,name,status,categories,validation_errors,endpoint_uri&limit=100`, token);
  for (const item of payload.data || []) {
    await query(
      `INSERT INTO whatsapp_native_flows (id,business_id,whatsapp_account_id,meta_flow_id,name,category,status,endpoint_uri,validation_errors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (business_id,name) DO UPDATE SET whatsapp_account_id=EXCLUDED.whatsapp_account_id,
       meta_flow_id=EXCLUDED.meta_flow_id,category=EXCLUDED.category,status=EXCLUDED.status,
       endpoint_uri=EXCLUDED.endpoint_uri,validation_errors=EXCLUDED.validation_errors,updated_at=NOW()`,
      [id("waf"), businessId, account.id, String(item.id), clean(item.name), clean(item.categories?.[0] || "OTHER"),
        clean(item.status).toLowerCase(), clean(item.endpoint_uri), JSON.stringify(item.validation_errors || [])]
    );
  }
}

async function createFlow(businessId, input) {
  const name = clean(input.name);
  if (!name) throw new AppError("Flow name is required.", 400, "VALIDATION_ERROR");
  const { account, token } = await accountForBusiness(businessId, input.accountId);
  const category = clean(input.category || "OTHER").toUpperCase();
  const endpointUri = clean(input.endpointUri);
  const created = await graphRequest(`${encodeURIComponent(account.waba_id)}/flows`, token, {
    method: "POST",
    body: JSON.stringify({ name, categories: [category], ...(endpointUri ? { endpoint_uri: endpointUri } : {}) })
  });
  await query(
    `INSERT INTO whatsapp_native_flows (id,business_id,whatsapp_account_id,meta_flow_id,name,category,status,endpoint_uri)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7)
     ON CONFLICT (business_id,name) DO UPDATE SET meta_flow_id=EXCLUDED.meta_flow_id,whatsapp_account_id=EXCLUDED.whatsapp_account_id,category=EXCLUDED.category,endpoint_uri=EXCLUDED.endpoint_uri,updated_at=NOW()`,
    [id("waf"), businessId, account.id, String(created.id || ""), name, category, endpointUri]
  );
}

async function uploadFlow(businessId, flowId, flowJson) {
  const flow = (await query("SELECT * FROM whatsapp_native_flows WHERE id=$1 AND business_id=$2", [clean(flowId), businessId])).rows[0];
  if (!flow?.meta_flow_id) throw new AppError("Create and sync the Meta Flow first.", 400, "FLOW_NOT_CREATED");
  const { token } = await accountForBusiness(businessId, flow.whatsapp_account_id);
  const parsed = typeof flowJson === "string" ? JSON.parse(flowJson) : flowJson;
  if (!parsed || typeof parsed !== "object") throw new AppError("Flow JSON must be a valid object.", 400, "INVALID_FLOW_JSON");
  const form = new FormData();
  form.set("name", "flow.json");
  form.set("asset_type", "FLOW_JSON");
  form.set("file", new Blob([JSON.stringify(parsed)], { type: "application/json" }), "flow.json");
  const payload = await graphRequest(`${encodeURIComponent(flow.meta_flow_id)}/assets`, token, { method: "POST", body: form });
  await query("UPDATE whatsapp_native_flows SET flow_json=$1,validation_errors=$2,updated_at=NOW() WHERE id=$3 AND business_id=$4", [JSON.stringify(parsed), JSON.stringify(payload.validation_errors || []), flow.id, businessId]);
}

async function publishFlow(businessId, flowId) {
  const flow = (await query("SELECT * FROM whatsapp_native_flows WHERE id=$1 AND business_id=$2", [clean(flowId), businessId])).rows[0];
  if (!flow?.meta_flow_id) throw new AppError("Meta Flow ID is missing.", 400, "FLOW_NOT_CREATED");
  const { token } = await accountForBusiness(businessId, flow.whatsapp_account_id);
  await graphRequest(`${encodeURIComponent(flow.meta_flow_id)}/publish`, token, { method: "POST", body: "{}" });
  await query("UPDATE whatsapp_native_flows SET status='published',updated_at=NOW() WHERE id=$1 AND business_id=$2", [flow.id, businessId]);
}

export async function getWhatsAppOperations(request) {
  try {
    const session = await requireSession(request);
    return json(await getWhatsAppOperationsState(session.businessId));
  } catch (error) { return errorJson(error); }
}

export async function updateWhatsAppOperations(request) {
  try {
    const session = await requireSession(request);
    assertManager(session);
    const body = await request.json();
    const action = clean(body.action);
    if (action === "sync") await syncAccount(session.businessId, body.accountId);
    else if (action === "select_phone") await selectPhone(session.businessId, body.phoneId);
    else if (action === "request_code") await requestVerificationCode(session.businessId, body.phoneId, body.method, body.language);
    else if (action === "verify_code") await verifyPhoneCode(session.businessId, body.phoneId, body.code);
    else if (action === "register_phone") await registerPhone(session.businessId, body.phoneId, body.pin);
    else if (action === "sync_profile") await syncProfile(session.businessId, body.phoneId);
    else if (action === "update_profile") await updateProfile(session.businessId, body.phoneId, body.profile || {});
    else if (action === "sync_analytics") await syncAnalytics(session.businessId, body.accountId, body);
    else if (action === "sync_flows") await syncFlows(session.businessId, body.accountId);
    else if (action === "create_flow") await createFlow(session.businessId, body);
    else if (action === "upload_flow") await uploadFlow(session.businessId, body.flowId, body.flowJson);
    else if (action === "publish_flow") await publishFlow(session.businessId, body.flowId);
    else throw new AppError("Unsupported WhatsApp operation.", 400, "INVALID_ACTION");
    await query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)", [id("a"), session.businessId, session.userId, `whatsapp_${action}`, JSON.stringify({ accountId: clean(body.accountId), phoneId: clean(body.phoneId), flowId: clean(body.flowId) })]);
    return json({ ok: true, operations: await getWhatsAppOperationsState(session.businessId) });
  } catch (error) {
    if (error instanceof SyntaxError) return errorJson(new AppError("Flow JSON is invalid.", 400, "INVALID_FLOW_JSON"));
    return errorJson(error);
  }
}
