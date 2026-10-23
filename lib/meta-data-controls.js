import crypto from "node:crypto";
import { AppError, enterSystemContext, errorJson, id, json, query, transaction } from "./db.js";
import { readTextBodyLimited } from "./security.js";
import { revokeMetaUserAuthorizations } from "./meta-authorization.js";
import { executeMetaPlatformDeletion } from "./meta-deletion-work.js";

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

export async function handleMetaDeauthorize(request) {
  try {
    enterSystemContext();
    const secret = appSecret();
    const payload = verifyMetaSignedRequest(await signedRequestFrom(request), secret);
    const affected = await transaction((client) => revokeMetaUserAuthorizations(client, payload.user_id, "meta_deauthorized"));
    return json({ success: true, disconnected: affected.count });
  } catch (error) {
    return errorJson(error);
  }
}

async function finishDeletionRequest(client, { requestId, metaUserId, businessIds }) {
  if (!businessIds.length) {
    await client.query(
      `UPDATE meta_data_deletion_requests
          SET status='completed', result_code='no_linked_data', businesses_affected=0, business_ids='[]'::jsonb,
              work_log=$2::jsonb, completed_at=NOW(), last_error='', updated_at=NOW()
        WHERE id=$1`,
      [requestId, JSON.stringify([{ store: 'meta_authorizations', count: 0, note: 'no_linked_authorization' }])]
    );
    return;
  }
  await client.query('SAVEPOINT meta_deletion_work');
  try {
    const work = await executeMetaPlatformDeletion(client, { metaUserId, businessIds });
    await client.query('RELEASE SAVEPOINT meta_deletion_work');
    await client.query(
      `UPDATE meta_data_deletion_requests
          SET status='completed', result_code='deleted', businesses_affected=$2, business_ids=$3::jsonb,
              work_log=$4::jsonb, completed_at=NOW(), last_error='', updated_at=NOW()
        WHERE id=$1`,
      [requestId, businessIds.length, JSON.stringify(businessIds), JSON.stringify(work)]
    );
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT meta_deletion_work');
    console.error('Meta deletion work failed', { code: error?.code || '', message: String(error?.message || '').slice(0, 300) });
    await client.query(
      `UPDATE meta_data_deletion_requests
          SET status='failed', result_code='retryable', last_error=$2, updated_at=NOW()
        WHERE id=$1`,
      [requestId, String(error?.message || 'deletion failed').slice(0, 500)]
    );
  }
}

export async function processMetaDeletionForUser(client, metaUserId, secret) {
  const hashedUserId = userIdHash(metaUserId, secret);
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1), 0)", [hashedUserId]);
  const prior = (await client.query(
    `SELECT id, confirmation_code, status, business_ids
       FROM meta_data_deletion_requests
      WHERE meta_user_id_hash=$1
      ORDER BY requested_at DESC
      LIMIT 1
      FOR UPDATE`,
    [hashedUserId]
  )).rows[0];
  if (prior?.status === 'completed') return prior.confirmation_code;
  const linked = await client.query(
    'SELECT DISTINCT business_id FROM meta_authorizations WHERE meta_user_id=$1',
    [metaUserId]
  );
  const businessIds = [...new Set([...(prior?.business_ids || []), ...linked.rows.map((row) => row.business_id)])];
  let requestId = prior?.id;
  let confirmationCode = prior?.confirmation_code;
  if (!prior) {
    confirmationCode = `mdl_${crypto.randomBytes(16).toString('hex')}`;
    requestId = id('mdr');
    await client.query(
      `INSERT INTO meta_data_deletion_requests
        (id, confirmation_code, meta_user_id_hash, status, businesses_affected, business_ids, attempt_count)
       VALUES ($1,$2,$3,'processing',$4,$5::jsonb,1)`,
      [requestId, confirmationCode, hashedUserId, businessIds.length, JSON.stringify(businessIds)]
    );
  } else {
    await client.query(
      `UPDATE meta_data_deletion_requests
          SET status='processing', business_ids=$2::jsonb, businesses_affected=$3, attempt_count=attempt_count+1,
              completed_at=NULL, updated_at=NOW()
        WHERE id=$1`,
      [requestId, JSON.stringify(businessIds), businessIds.length]
    );
  }
  await finishDeletionRequest(client, { requestId, metaUserId, businessIds });
  return confirmationCode;
}

export async function handleMetaDataDeletion(request) {
  try {
    enterSystemContext();
    const secret = appSecret();
    const payload = verifyMetaSignedRequest(await signedRequestFrom(request), secret);
    const confirmationCode = await transaction((client) => processMetaDeletionForUser(client, payload.user_id, secret));
    const configuredBase = clean(process.env.APP_URL) || new URL(request.url).origin;
    const statusUrl = new URL("/data-deletion/status", configuredBase);
    statusUrl.searchParams.set("code", confirmationCode);
    return json({ url: statusUrl.toString(), confirmation_code: confirmationCode });
  } catch (error) {
    return errorJson(error);
  }
}

export async function resumeMetaDeletionRequests({ limit = 5 } = {}) {
  enterSystemContext();
  const secret = appSecret();
  const due = await query(
    `SELECT id FROM meta_data_deletion_requests
      WHERE status IN ('failed', 'processing')
        AND updated_at < NOW() - INTERVAL '1 minute'
      ORDER BY requested_at
      LIMIT $1`,
    [Math.max(1, Math.min(20, Number(limit) || 5))]
  );
  let resumed = 0;
  for (const row of due.rows) {
    const full = (await query(
      'SELECT meta_user_id_hash FROM meta_data_deletion_requests WHERE id=$1',
      [row.id]
    )).rows[0];
    if (!full) continue;
    const auths = (await query(
      `SELECT meta_user_id FROM meta_authorizations WHERE meta_user_id_hash=$1 LIMIT 1`,
      [full.meta_user_id_hash]
    )).rows[0];
    if (!auths?.meta_user_id) continue;
    await transaction((client) => processMetaDeletionForUser(client, auths.meta_user_id, secret));
    resumed += 1;
  }
  return { resumed };
}

export async function getDeletionStatus(code) {
  const value = clean(code);
  if (!/^mdl_[a-f0-9]{32}$/.test(value)) return null;
  const result = await query(
    `SELECT confirmation_code, status, result_code, requested_at, completed_at
       FROM meta_data_deletion_requests
      WHERE confirmation_code = $1`,
    [value]
  );
  return result.rows[0] || null;
}
