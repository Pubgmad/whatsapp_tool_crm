import crypto from "node:crypto";
import { AppError, errorJson, id, json, query, transaction } from "./db.js";
import { readTextBodyLimited } from "./security.js";

const clean = (value) => String(value || "").trim();

function appSecret() {
  const secret = clean(process.env.META_APP_SECRET);
  if (!secret || secret.startsWith("replace-with") || secret.startsWith("your-")) {
    throw new AppError("Meta app secret is not configured.", 503, "META_APP_SECRET_NOT_CONFIGURED");
  }
  return secret;
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new AppError("Invalid Meta signed request.", 400, "META_SIGNED_REQUEST_INVALID");
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new AppError("Invalid Meta signed request.", 400, "META_SIGNED_REQUEST_INVALID");
  }
}

export function verifyMetaSignedRequest(signedRequest, secret = appSecret()) {
  const value = clean(signedRequest);
  if (!value || value.length > 32768) throw new AppError("Meta signed request is required.", 400, "META_SIGNED_REQUEST_REQUIRED");
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AppError("Invalid Meta signed request.", 400, "META_SIGNED_REQUEST_INVALID");

  const actualSignature = decodeBase64Url(parts[0]);
  const expectedSignature = crypto.createHmac("sha256", secret).update(parts[1]).digest();
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    throw new AppError("Invalid Meta signed request signature.", 403, "META_SIGNATURE_INVALID");
  }

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
  } catch {
    throw new AppError("Invalid Meta signed request payload.", 400, "META_PAYLOAD_INVALID");
  }
  if (String(payload.algorithm || "").toUpperCase() !== "HMAC-SHA256") {
    throw new AppError("Unsupported Meta signature algorithm.", 400, "META_ALGORITHM_INVALID");
  }
  const metaUserId = clean(payload.user_id);
  if (!metaUserId || metaUserId.length > 255) throw new AppError("Meta user identifier is missing.", 400, "META_USER_MISSING");
  return { ...payload, user_id: metaUserId };
}

async function signedRequestFrom(request) {
  const rawBody = await readTextBodyLimited(request, 65536);
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    let body;
    try { body = JSON.parse(rawBody); }
    catch { body = {}; }
    return body?.signed_request;
  }
  return new URLSearchParams(rawBody).get("signed_request");
}

function userIdHash(metaUserId, secret) {
  return crypto.createHmac("sha256", secret).update(metaUserId).digest("hex");
}

async function disconnectAuthorizedBusinesses(client, metaUserId, eventType) {
  const affected = await client.query(
    `SELECT b.id
       FROM businesses b
       JOIN meta_authorizations ma ON ma.business_id = b.id
      WHERE ma.meta_user_id = $1
      FOR UPDATE OF b`,
    [metaUserId]
  );

  for (const business of affected.rows) {
    await client.query("DELETE FROM whatsapp_accounts WHERE business_id = $1", [business.id]);
    await client.query(
      `UPDATE businesses
          SET whatsapp_number = '', waba_id = '', phone_number_id = '', access_token_encrypted = '',
              status = 'Needs setup', onboarding_method = 'manual', meta_token_expires_at = NULL,
              meta_connected_at = NULL, webhook_subscribed = FALSE,
              meta_connection_metadata = '{}'::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [business.id]
    );
    await client.query(
      "INSERT INTO meta_connection_events (id, business_id, event_type, metadata) VALUES ($1, $2, $3, $4)",
      [id("mce"), business.id, eventType, JSON.stringify({ source: "meta_callback" })]
    );
    await client.query(
      "INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, NULL, $3, $4)",
      [id("a"), business.id, eventType, JSON.stringify({ source: "meta_callback" })]
    );
  }
  await client.query("DELETE FROM meta_authorizations WHERE meta_user_id = $1", [metaUserId]);
  return affected.rowCount;
}

export async function handleMetaDeauthorize(request) {
  try {
    const { enterSystemContext } = await import('./db.js');
    enterSystemContext();
    const secret = appSecret();
    const payload = verifyMetaSignedRequest(await signedRequestFrom(request), secret);
    const affected = await transaction((client) => disconnectAuthorizedBusinesses(client, payload.user_id, "meta_deauthorized"));
    return json({ success: true, disconnected: affected });
  } catch (error) {
    return errorJson(error);
  }
}

export async function handleMetaDataDeletion(request) {
  try {
    const { enterSystemContext } = await import('./db.js');
    enterSystemContext();
    const secret = appSecret();
    const payload = verifyMetaSignedRequest(await signedRequestFrom(request), secret);
    const hashedUserId = userIdHash(payload.user_id, secret);
    let confirmationCode = `mdl_${crypto.randomBytes(16).toString("hex")}`;
    await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), 0)", [hashedUserId]);
      const prior = (await client.query(
        "SELECT id,confirmation_code,business_ids FROM meta_data_deletion_requests WHERE meta_user_id_hash=$1 AND status IN ('pending','failed') ORDER BY requested_at DESC LIMIT 1 FOR UPDATE",
        [hashedUserId]
      )).rows[0];
      const linked = await client.query("SELECT DISTINCT business_id FROM meta_authorizations WHERE meta_user_id=$1", [payload.user_id]);
      const businessIds = linked.rows.map((row) => row.business_id);
      const affected = await disconnectAuthorizedBusinesses(client, payload.user_id, "meta_data_deleted");
      if (prior) {
        confirmationCode = prior.confirmation_code;
        const allBusinessIds = [...new Set([...(prior.business_ids || []), ...businessIds])];
        await client.query(
          "UPDATE meta_data_deletion_requests SET status='pending',business_ids=$1,businesses_affected=$2,completed_at=NULL,updated_at=NOW() WHERE id=$3",
          [JSON.stringify(allBusinessIds), allBusinessIds.length, prior.id]
        );
        return;
      }
      await client.query(
        `INSERT INTO meta_data_deletion_requests
          (id, confirmation_code, meta_user_id_hash, status, businesses_affected, business_ids, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id("mdr"), confirmationCode, hashedUserId,
          affected ? "pending" : "completed", affected, JSON.stringify(businessIds), affected ? null : new Date()]
      );
    });

    const configuredBase = clean(process.env.APP_URL) || new URL(request.url).origin;
    const statusUrl = new URL("/data-deletion/status", configuredBase);
    statusUrl.searchParams.set("code", confirmationCode);
    return json({ url: statusUrl.toString(), confirmation_code: confirmationCode });
  } catch (error) {
    return errorJson(error);
  }
}

export async function getDeletionStatus(code) {
  const value = clean(code);
  if (!/^mdl_[a-f0-9]{32}$/.test(value)) return null;
  const result = await query(
    `SELECT confirmation_code, status, requested_at, completed_at
       FROM meta_data_deletion_requests
      WHERE confirmation_code = $1`,
    [value]
  );
  return result.rows[0] || null;
}
