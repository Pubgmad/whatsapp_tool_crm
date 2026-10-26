import { AppError, enterSystemContext, enterTenantContext, id, query, toIso, transaction } from "./db.js";
import { decryptSecret } from "./meta.js";
import { metaGraphApiVersion } from './operational-policy.js';

const clean = (value) => String(value || "").trim();
const graphVersion = () => metaGraphApiVersion();
const CHECK_INTERVAL_MINUTES = Math.max(5, Math.min(1440, Number(process.env.META_HEALTH_INTERVAL_MINUTES) || 15));
const BATCH_SIZE = Math.max(1, Math.min(50, Number(process.env.META_HEALTH_BATCH_SIZE) || 10));
const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging"];

function graphUrl(path) { return "https://graph.facebook.com/" + graphVersion() + "/" + path; }
async function graphRequest(path, token, method = "GET") {
  const response = await fetch(graphUrl(path), {
    method, headers: { Authorization: "Bearer " + token, ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
    body: method === "POST" ? "{}" : undefined,
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new AppError("Meta connection check failed.", response.status, "META_HEALTH_GRAPH_FAILED");
    error.metaCode = Number(payload.error?.code || 0);
    throw error;
  }
  return payload;
}

export function classifyMetaHealth(error) {
  if (["META_TOKEN_INVALID", "META_SCOPE_MISSING"].includes(error?.code) ||
      Number(error?.metaCode) === 190 || error?.status === 401) {
    return { status: "reconnect_required", reason: error?.code === "META_SCOPE_MISSING" ? "scope_missing" : "authorization_invalid" };
  }
  return { status: "degraded", reason: error?.code === "META_HEALTH_CONFIG_MISSING" ? "platform_configuration" :
    error?.code === "META_WEBHOOK_REPAIR_FAILED" ? "webhook_unsubscribed" : "meta_check_failed" };
}

export function publicMetaHealth(row) {
  const checkedAt = toIso(row?.health_checked_at);
  const lastCheck = checkedAt || toIso(row?.updated_at || row?.created_at);
  const stale = Boolean(lastCheck && Date.now() - new Date(lastCheck).getTime() > CHECK_INTERVAL_MINUTES * 3 * 60000);
  const needsReconnect = row?.health_status === "reconnect_required";
  return {
    status: stale && !needsReconnect ? "degraded" : row?.health_status || "unknown",
    reason: stale && !needsReconnect ? "monitor_stale" : row?.health_reason || "",
    checkedAt,
    lastWebhookAt: toIso(row?.last_webhook_at),
    lastMessageWebhookAt: toIso(row?.last_message_webhook_at),
    lastWebhookField: row?.last_webhook_field || ""
  };
}

export async function probeMetaConnection(wabaId, encryptedToken) {
  const appId = clean(process.env.META_APP_ID);
  const appSecret = clean(process.env.META_APP_SECRET);
  if (!appId || !appSecret) throw new AppError("Meta app configuration is missing.", 503, "META_HEALTH_CONFIG_MISSING");
  const token = decryptSecret(encryptedToken);
  const debug = (await graphRequest("debug_token?input_token=" + encodeURIComponent(token), appId + "|" + appSecret)).data || {};
  if (!debug.is_valid || String(debug.app_id) !== appId) throw new AppError("Meta authorization is invalid.", 401, "META_TOKEN_INVALID");
  const scopes = new Set(debug.scopes || []);
  if (requiredScopes.some((scope) => !scopes.has(scope))) throw new AppError("Meta authorization lacks a required scope.", 403, "META_SCOPE_MISSING");
  const expiresAt = Number(debug.expires_at || 0) > 0 ? new Date(Number(debug.expires_at) * 1000) : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new AppError("Meta authorization has expired.", 401, "META_TOKEN_INVALID");
  const path = encodeURIComponent(wabaId) + "/subscribed_apps";
  const isSubscribed = (payload) => (payload.data || []).some((item) =>
    String(item.whatsapp_business_api_data?.id || item.id) === appId);
  let subscribed = isSubscribed(await graphRequest(path, token));
  if (!subscribed) {
    try { await graphRequest(path, token, "POST"); }
    catch (error) {
      if (Number(error?.metaCode) === 190 || error?.status === 401) throw error;
      throw new AppError("Meta webhook subscription could not be restored.", 503, "META_WEBHOOK_REPAIR_FAILED");
    }
    subscribed = isSubscribed(await graphRequest(path, token));
  }
  const expiring = Boolean(expiresAt && expiresAt.getTime() - Date.now() <= 7 * 86400000);
  return {
    status: !subscribed || expiring ? "degraded" : "healthy",
    reason: !subscribed ? "webhook_unsubscribed" : expiring ? "authorization_expiring" : "",
    subscribed, expiresAt
  };
}

export async function checkAndRecordMetaAccount(account) {
  let health;
  try {
    health = await probeMetaConnection(account.waba_id, account.access_token_encrypted);
  } catch (error) {
    const failure = classifyMetaHealth(error);
    health = { ...failure, subscribed: failure.reason === "webhook_unsubscribed" ? false : Boolean(account.webhook_subscribed), expiresAt: account.token_expires_at || null };
  }
  await transaction(async (client) => {
    const previous = (await client.query(
      "SELECT health_status,health_reason,webhook_subscribed,access_token_encrypted,is_default FROM whatsapp_accounts WHERE id=$1 AND business_id=$2 FOR UPDATE",
      [account.id, account.business_id]
    )).rows[0];
    if (!previous || previous.access_token_encrypted !== account.access_token_encrypted) return;
    await client.query(
      "UPDATE whatsapp_accounts SET health_status=$1,health_reason=$2,health_checked_at=NOW(),webhook_subscribed=$3,token_expires_at=$4,updated_at=NOW() WHERE id=$5 AND business_id=$6",
      [health.status, health.reason, health.subscribed, health.expiresAt, account.id, account.business_id]
    );
    // Mirror health onto businesses for the account this check selected (ORDER BY is_default DESC).
    await client.query(
      "UPDATE businesses SET webhook_subscribed=$1,meta_token_expires_at=$2 WHERE id=$3",
      [health.subscribed, health.expiresAt, account.business_id]
    );
    if (previous.health_status !== health.status || previous.health_reason !== health.reason ||
        previous.webhook_subscribed !== health.subscribed) {
      await client.query(
        "INSERT INTO meta_connection_events (id,business_id,event_type,success,metadata) VALUES ($1,$2,'health_changed',$3,$4)",
        [id("mce"), account.business_id, health.status === "healthy", JSON.stringify({ wabaId: account.waba_id, status: health.status, reason: health.reason })]
      );
    }
  });
  return { status: health.status, reason: health.reason, subscribed: health.subscribed, checkedAt: new Date().toISOString(), expiresAt: toIso(health.expiresAt) };
}

export async function accountWithLiveToken(businessId) {
  // Prefer a connected account that actually has credentials — default row may lag empty after heal/UI Connected.
  return (await query(
    `SELECT * FROM whatsapp_accounts
      WHERE business_id=$1 AND COALESCE(access_token_encrypted,'')<>''
      ORDER BY CASE WHEN status='connected' THEN 0 ELSE 1 END, is_default DESC, created_at
      LIMIT 1`,
    [businessId]
  )).rows[0] || null;
}

async function loadBusinessCredentials(businessId) {
  let business = (await query(
    `SELECT id, waba_id, access_token_encrypted, webhook_subscribed, meta_token_expires_at, onboarding_method, phone_number_id, status
       FROM businesses WHERE id=$1`,
    [businessId]
  )).rows[0];
  if (!business) {
    enterSystemContext();
    try {
      business = (await query(
        `SELECT id, waba_id, access_token_encrypted, webhook_subscribed, meta_token_expires_at, onboarding_method, phone_number_id, status
           FROM businesses WHERE id=$1`,
        [businessId]
      )).rows[0];
    } finally {
      enterTenantContext(businessId);
    }
  }
  return business || null;
}

async function promoteAccountDefault(businessId, accountId) {
  if (!accountId) return;
  await query(
    `UPDATE whatsapp_accounts SET is_default=(id=$1), updated_at=NOW() WHERE business_id=$2`,
    [accountId, businessId]
  );
}

export async function healAccountTokenFromBusiness(businessId) {
  const business = await loadBusinessCredentials(businessId);
  if (!business?.waba_id || !business?.access_token_encrypted) return null;

  const matched = (await query(
    `SELECT * FROM whatsapp_accounts WHERE business_id=$1 AND waba_id=$2 ORDER BY is_default DESC, created_at LIMIT 1`,
    [businessId, business.waba_id]
  )).rows[0];

  if (matched) {
    if (matched.access_token_encrypted) {
      await promoteAccountDefault(businessId, matched.id);
      return matched;
    }
    const healed = (await query(
      `UPDATE whatsapp_accounts
          SET access_token_encrypted=$1,
              token_expires_at=COALESCE($2, token_expires_at),
              webhook_subscribed=COALESCE($3, webhook_subscribed),
              status='connected',
              is_default=TRUE,
              updated_at=NOW()
        WHERE id=$4 AND business_id=$5
        RETURNING *`,
      [
        business.access_token_encrypted,
        business.meta_token_expires_at,
        business.webhook_subscribed,
        matched.id,
        businessId
      ]
    )).rows[0];
    if (healed) await promoteAccountDefault(businessId, healed.id);
    return healed || null;
  }

  // Account row missing but businesses has credentials — create/repair account for THIS tenant only.
  // Never reassign another tenant's waba_id row (global unique index on waba_id).
  const created = (await query(
    `INSERT INTO whatsapp_accounts
       (id, business_id, waba_id, onboarding_method, access_token_encrypted, token_expires_at, webhook_subscribed, is_default, status, last_synced_at)
     VALUES ($1,$2,$3,COALESCE(NULLIF($4,''),'embedded_signup'),$5,$6,$7,TRUE,'connected',NOW())
     ON CONFLICT (waba_id) DO UPDATE SET
       access_token_encrypted=EXCLUDED.access_token_encrypted,
       token_expires_at=COALESCE(EXCLUDED.token_expires_at, whatsapp_accounts.token_expires_at),
       webhook_subscribed=EXCLUDED.webhook_subscribed,
       status='connected',
       is_default=TRUE,
       updated_at=NOW()
     WHERE whatsapp_accounts.business_id = EXCLUDED.business_id
     RETURNING *`,
    [
      id('wa'),
      businessId,
      business.waba_id,
      business.onboarding_method,
      business.access_token_encrypted,
      business.meta_token_expires_at,
      Boolean(business.webhook_subscribed)
    ]
  )).rows[0];
  if (created) await promoteAccountDefault(businessId, created.id);
  return created || null;
}

/** Bidirectional sync: businesses ↔ whatsapp_accounts so UI Connected and Verify share one credential set. */
export async function reconcileWhatsAppCredentials(businessId) {
  let account = await accountWithLiveToken(businessId);
  if (!account?.access_token_encrypted) {
    account = await healAccountTokenFromBusiness(businessId);
  }
  if (!account?.access_token_encrypted) {
    enterSystemContext();
    try {
      account = await accountWithLiveToken(businessId);
      if (!account?.access_token_encrypted) account = await healAccountTokenFromBusiness(businessId);
    } finally {
      enterTenantContext(businessId);
    }
  }
  if (!account?.access_token_encrypted) return null;

  await promoteAccountDefault(businessId, account.id);

  const phone = (await query(
    `SELECT phone_number_id, display_phone_number FROM whatsapp_phone_numbers
      WHERE business_id=$1 AND whatsapp_account_id=$2
      ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [businessId, account.id]
  )).rows[0];

  const business = await loadBusinessCredentials(businessId);
  const needsBusinessHeal = !business?.access_token_encrypted || !business?.waba_id
    || (phone?.phone_number_id && business.phone_number_id !== phone.phone_number_id)
    || business.status !== 'Connected';

  if (needsBusinessHeal) {
    const applyBusinessHeal = async (runner) => runner(
      `UPDATE businesses SET
         waba_id = COALESCE(NULLIF($2,''), waba_id),
         phone_number_id = COALESCE(NULLIF($3,''), phone_number_id),
         whatsapp_number = COALESCE(NULLIF($4,''), whatsapp_number),
         access_token_encrypted = $5,
         meta_token_expires_at = COALESCE($6, meta_token_expires_at),
         webhook_subscribed = COALESCE($7, webhook_subscribed),
         meta_connected_at = COALESCE(meta_connected_at, NOW()),
         status = 'Connected',
         updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        businessId,
        account.waba_id || '',
        phone?.phone_number_id || business?.phone_number_id || '',
        phone?.display_phone_number || '',
        account.access_token_encrypted,
        account.token_expires_at || null,
        Boolean(account.webhook_subscribed)
      ]
    );
    let healed = await applyBusinessHeal(query);
    if (!healed.rowCount) {
      enterSystemContext();
      try { healed = await applyBusinessHeal(query); }
      finally { enterTenantContext(businessId); }
    }
  }

  // Demote fake Connected rows that still have no credentials after reconcile attempts.
  const refreshed = await loadBusinessCredentials(businessId);
  if (refreshed?.status === 'Connected' && (!refreshed.access_token_encrypted || !refreshed.waba_id)) {
    await query(
      `UPDATE businesses SET status='Needs setup', updated_at=NOW() WHERE id=$1 AND status='Connected'`,
      [businessId]
    );
  }

  return account;
}

export async function checkBusinessMetaConnection(businessId) {
  let account = await reconcileWhatsAppCredentials(businessId);
  if (!account?.access_token_encrypted) {
    account = await accountWithLiveToken(businessId);
  }
  if (!account?.access_token_encrypted) {
    throw new AppError("Connect a WhatsApp Business Account first.", 400, "META_NOT_CONFIGURED");
  }
  return checkAndRecordMetaAccount(account);
}

export async function monitorDueMetaConnections() {
  const claimed = await transaction(async (client) => {
    const result = await client.query(
      "WITH due AS (SELECT id FROM whatsapp_accounts WHERE access_token_encrypted <> '' AND (health_claimed_at IS NULL OR health_claimed_at < NOW() - ($1::int * INTERVAL '1 minute')) ORDER BY health_claimed_at NULLS FIRST,id LIMIT $2 FOR UPDATE SKIP LOCKED) UPDATE whatsapp_accounts a SET health_claimed_at=NOW() FROM due WHERE a.id=due.id RETURNING a.*",
      [CHECK_INTERVAL_MINUTES, BATCH_SIZE]
    );
    return result.rows;
  });
  const results = await Promise.allSettled(claimed.map(checkAndRecordMetaAccount));
  return { checked: claimed.length, failed: results.filter((result) => result.status === "rejected").length };
}

export async function recordMetaWebhookActivity(businessId, wabaId, field) {
  await query(
    "UPDATE whatsapp_accounts SET last_webhook_at=NOW(),last_message_webhook_at=CASE WHEN $3='messages' THEN NOW() ELSE last_message_webhook_at END,last_webhook_field=$3 WHERE business_id=$1 AND waba_id=$2",
    [businessId, String(wabaId), clean(field).slice(0, 100)]
  );
}
