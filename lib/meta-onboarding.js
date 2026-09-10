import crypto from "crypto";
import { currentAccount, requireSession } from "./auth";
import { AppError, errorJson, id, json, query, toIso, transaction } from "./db";
import { decryptSecret, encryptSecret } from "./meta";

const graphVersion = () => process.env.META_GRAPH_API_VERSION || "v26.0";
const graphUrl = (path) => `https://graph.facebook.com/${graphVersion()}/${path}`;
const clean = (value) => String(value || "").trim();

function providerConfig() {
  const appId = clean(process.env.META_APP_ID);
  const appSecret = clean(process.env.META_APP_SECRET);
  const configId = clean(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID);
  if (!appId || !appSecret || !configId) throw new AppError("Meta Embedded Signup is not configured by the platform owner.", 503, "META_EMBEDDED_SIGNUP_NOT_CONFIGURED");
  return { appId, appSecret, configId };
}

function verifyRequestOrigin(request) {
  const origin = clean(request.headers.get("origin"));
  if (!origin) return;
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (process.env.APP_URL) allowedOrigins.add(new URL(process.env.APP_URL).origin);
  if (!allowedOrigins.has(new URL(origin).origin)) throw new AppError("Invalid request origin.", 403, "INVALID_ORIGIN");
}

async function graphRequest(path, token, options = {}) {
  const response = await fetch(graphUrl(path), {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppError(payload.error?.message || "Meta request failed.", response.status, "META_REQUEST_FAILED");
  return payload;
}

async function debugToken(token, config) {
  const payload = await graphRequest(`debug_token?input_token=${encodeURIComponent(token)}`, `${config.appId}|${config.appSecret}`);
  const data = payload.data || {};
  if (!data.is_valid || String(data.app_id) !== config.appId) throw new AppError("Meta returned an invalid token for this application.", 401, "META_TOKEN_INVALID");
  const scopes = new Set(data.scopes || []);
  for (const required of ["whatsapp_business_management", "whatsapp_business_messaging"]) {
    if (!scopes.has(required)) throw new AppError(`Meta did not grant ${required}. Check the Embedded Signup configuration.`, 403, "META_SCOPE_MISSING");
  }
  return data;
}

function wabaFromDebug(data) {
  return clean((data.granular_scopes || []).find((scope) => scope.scope === "whatsapp_business_management")?.target_ids?.[0]);
}

export async function getEmbeddedSignupConfig(request) {
  try {
    await currentAccount(request);
    const { appId, configId } = providerConfig();
    return json({ appId, configId, graphVersion: graphVersion(), enabled: true });
  } catch (error) { return errorJson(error); }
}

export async function completeEmbeddedSignup(request) {
  try {
    verifyRequestOrigin(request);
    const session = await requireSession(request);
    const config = providerConfig();
    const body = await request.json();
    const code = clean(body.code);
    if (!code || code.length > 2048) throw new AppError("Meta authorization code is required.", 400, "META_CODE_REQUIRED");
    const form = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, code });
    const redirectUri = clean(process.env.META_OAUTH_REDIRECT_URI);
    if (redirectUri) form.set("redirect_uri", redirectUri);
    const exchangeResponse = await fetch(graphUrl("oauth/access_token"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" });
    const exchange = await exchangeResponse.json().catch(() => ({}));
    if (!exchangeResponse.ok || !exchange.access_token) throw new AppError(exchange.error?.message || "Meta authorization-code exchange failed.", exchangeResponse.status || 400, "META_CODE_EXCHANGE_FAILED");
    const debug = await debugToken(exchange.access_token, config);
    const metaUserId = clean(debug.user_id);
    if (!metaUserId || metaUserId.length > 255) throw new AppError("Meta did not return a valid authorizing user.", 400, "META_USER_MISSING");
    const wabaId = clean(body.wabaId) || wabaFromDebug(debug);
    if (!wabaId) throw new AppError("Meta did not return a WhatsApp Business Account ID.", 400, "META_WABA_MISSING");
    const numbers = await graphRequest(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status&limit=100`, exchange.access_token);
    const selectedPhoneId = clean(body.phoneNumberId);
    const phone = selectedPhoneId ? (numbers.data || []).find((item) => String(item.id) === selectedPhoneId) : numbers.data?.[0];
    if (!phone) throw new AppError("The selected phone number is not available to this WhatsApp Business Account.", 403, "META_PHONE_NOT_ACCESSIBLE");
    await graphRequest(`${encodeURIComponent(wabaId)}/subscribed_apps`, exchange.access_token, { method: "POST", body: "{}" });
    const expiresAt = Number(debug.expires_at || 0) > 0 ? new Date(Number(debug.expires_at) * 1000) : null;
    await transaction(async (client) => {
      await client.query("UPDATE whatsapp_accounts SET is_default = FALSE WHERE business_id = $1", [session.businessId]);
      const accountRow = await client.query(
        `INSERT INTO whatsapp_accounts
          (id,business_id,waba_id,onboarding_method,access_token_encrypted,token_expires_at,webhook_subscribed,is_default,status,capabilities,metadata,last_synced_at)
         VALUES ($1,$2,$3,'embedded_signup',$4,$5,TRUE,TRUE,'connected',$6,$7,NOW())
         ON CONFLICT (business_id,waba_id) DO UPDATE SET
          access_token_encrypted=EXCLUDED.access_token_encrypted,token_expires_at=EXCLUDED.token_expires_at,
          webhook_subscribed=TRUE,is_default=TRUE,status='connected',capabilities=EXCLUDED.capabilities,
          metadata=EXCLUDED.metadata,last_synced_at=NOW(),updated_at=NOW()
         RETURNING id`,
        [id("waa"), session.businessId, wabaId, encryptSecret(exchange.access_token), expiresAt,
          JSON.stringify({ cloud_api: true, webhooks: true, templates: true, interactive_messages: true, native_flows: true, authentication_templates: true, media_templates: true }),
          JSON.stringify({ scopes: debug.scopes || [], granularScopes: debug.granular_scopes || [] })]
      );
      await client.query("UPDATE whatsapp_phone_numbers SET is_default = FALSE WHERE business_id = $1", [session.businessId]);
      for (const item of numbers.data || []) {
        await client.query(
          `INSERT INTO whatsapp_phone_numbers
            (id,business_id,whatsapp_account_id,phone_number_id,display_phone_number,verified_name,quality_rating,status,is_default,registration_state,metadata,last_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
           ON CONFLICT (business_id,phone_number_id) DO UPDATE SET
            whatsapp_account_id=EXCLUDED.whatsapp_account_id,display_phone_number=EXCLUDED.display_phone_number,
            verified_name=EXCLUDED.verified_name,quality_rating=EXCLUDED.quality_rating,status=EXCLUDED.status,
            is_default=EXCLUDED.is_default,registration_state=EXCLUDED.registration_state,
            metadata=EXCLUDED.metadata,last_synced_at=NOW(),updated_at=NOW()`,
          [id("wap"), session.businessId, accountRow.rows[0].id, String(item.id), clean(item.display_phone_number),
            clean(item.verified_name), clean(item.quality_rating), clean(item.status), String(item.id) === String(phone.id),
            ["CONNECTED", "READY"].includes(clean(item.status).toUpperCase()) ? "registered" : "unknown", JSON.stringify(item)]
        );
      }
      await client.query(
        `UPDATE businesses SET waba_id = $1, phone_number_id = $2, whatsapp_number = $3, access_token_encrypted = $4,
          onboarding_method = 'embedded_signup', meta_token_expires_at = $5, meta_connected_at = NOW(), webhook_subscribed = TRUE,
          meta_connection_metadata = $6, webhook_url = COALESCE(NULLIF(webhook_url, ''), $7), status = 'Connected', updated_at = NOW()
         WHERE id = $8`,
        [wabaId, String(phone.id), clean(phone.display_phone_number), encryptSecret(exchange.access_token), expiresAt,
          JSON.stringify({ verifiedName: clean(phone.verified_name), qualityRating: clean(phone.quality_rating), phoneStatus: clean(phone.status), scopes: debug.scopes || [] }),
          `${clean(process.env.APP_URL).replace(/\/$/, "")}/api/webhooks/meta`, session.businessId]
      );
      await client.query("INSERT INTO meta_connection_events (id, business_id, event_type, metadata) VALUES ($1, $2, 'embedded_signup_completed', $3)", [id("mce"), session.businessId, JSON.stringify({ wabaId, phoneNumberId: String(phone.id) })]);
      await client.query(
        `INSERT INTO meta_authorizations (id, business_id, meta_user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (business_id, meta_user_id) DO UPDATE SET updated_at = NOW()`,
        [id("ma"), session.businessId, metaUserId]
      );
      await client.query("INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'meta_embedded_signup_completed', $4)", [id("a"), session.businessId, session.userId, JSON.stringify({ wabaId, phoneNumberId: String(phone.id) })]);
    });
    return json({ ok: true, connection: { wabaId, phoneNumberId: String(phone.id), whatsappNumber: clean(phone.display_phone_number), tokenExpiresAt: toIso(expiresAt), webhookSubscribed: true } });
  } catch (error) { return errorJson(error); }
}

export async function checkMetaConnection(request) {
  try {
    const session = await requireSession(request);
    const config = providerConfig();
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    if (!business?.access_token_encrypted) throw new AppError("Connect a WhatsApp Business Account first.", 400, "META_NOT_CONFIGURED");
    const token = decryptSecret(business.access_token_encrypted);
    const debug = await debugToken(token, config);
    const subscriptions = await graphRequest(`${encodeURIComponent(business.waba_id)}/subscribed_apps`, token);
    const subscribed = (subscriptions.data || []).some((item) => String(item.id) === config.appId);
    const expiresAt = Number(debug.expires_at || 0) > 0 ? new Date(Number(debug.expires_at) * 1000) : null;
    await transaction(async (client) => {
      await client.query("UPDATE businesses SET webhook_subscribed = $1, meta_token_expires_at = $2, updated_at = NOW() WHERE id = $3", [subscribed, expiresAt, session.businessId]);
      await client.query("UPDATE whatsapp_accounts SET webhook_subscribed=$1,token_expires_at=$2,status='connected',updated_at=NOW() WHERE business_id=$3 AND waba_id=$4", [subscribed, expiresAt, session.businessId, business.waba_id]);
    });
    return json({ ok: true, valid: true, webhookSubscribed: subscribed, tokenExpiresAt: Number(debug.expires_at || 0) > 0 ? new Date(Number(debug.expires_at) * 1000).toISOString() : null });
  } catch (error) { return errorJson(error); }
}

export async function disconnectMeta(request) {
  try {
    verifyRequestOrigin(request);
    const session = await requireSession(request);
    const business = (await query("SELECT * FROM businesses WHERE id = $1", [session.businessId])).rows[0];
    if (business?.access_token_encrypted && business.waba_id) {
      try { await graphRequest(`${encodeURIComponent(business.waba_id)}/subscribed_apps`, decryptSecret(business.access_token_encrypted), { method: "DELETE" }); } catch {}
    }
    await transaction(async (client) => {
      await client.query(`UPDATE businesses SET whatsapp_number = '', waba_id = '', phone_number_id = '', access_token_encrypted = '', status = 'Needs setup', onboarding_method = 'manual', meta_token_expires_at = NULL, meta_connected_at = NULL, webhook_subscribed = FALSE, meta_connection_metadata = '{}'::jsonb, updated_at = NOW() WHERE id = $1`, [session.businessId]);
      await client.query("DELETE FROM whatsapp_accounts WHERE business_id = $1", [session.businessId]);
      await client.query("DELETE FROM meta_authorizations WHERE business_id = $1", [session.businessId]);
      await client.query("INSERT INTO audit_logs (id, business_id, user_id, action) VALUES ($1, $2, $3, 'meta_disconnected')", [id("a"), session.businessId, session.userId]);
    });
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
