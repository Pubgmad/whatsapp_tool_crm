import crypto from "crypto";
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from "pg";

const { Pool } = pg;
let pool;
const databaseContext = new AsyncLocalStorage();

export function enterTenantContext(businessId) { databaseContext.enterWith({ businessId: String(businessId || ''), system: false }); }
export function enterSystemContext() { databaseContext.enterWith({ businessId: '', system: true }); }

async function applyDatabaseContext(client) {
  const context = databaseContext.getStore();
  if (!context) return;
  await client.query('SELECT set_config(\'app.business_id\',$1,true),set_config(\'app.system_access\',$2,true)', [context.businessId, context.system ? 'true' : 'false']);
}

export class AppError extends Error {
  constructor(message, status = 400, code = "APP_ERROR", extras = null) {
    super(message);
    this.status = status;
    this.code = code;
    if (extras && typeof extras === "object") Object.assign(this, extras);
  }
}

/** Build AppError from a Meta Graph error payload; keeps (#code) visible for operators. */
export function metaGraphAppError(graphError, status, code, fallbackMessage = "Meta request failed.") {
  const meta = graphError && typeof graphError === "object" ? graphError : {};
  const metaCode = meta.code;
  let message = String(meta.message || fallbackMessage).trim() || fallbackMessage;
  message = message
    .replace(/https?:\/\/[^\s]*access_token=[^\s]*/gi, "[redacted]")
    .replace(/\baccess_token=[^\s&]+/gi, "access_token=[redacted]");
  if (metaCode != null && metaCode !== "" && !/\(#\d+\)/.test(message)) {
    message = `(#${metaCode}) ${message}`;
  }
  const extras = {};
  if (metaCode != null && metaCode !== "") extras.metaCode = Number(metaCode) || metaCode;
  if (meta.error_subcode != null && meta.error_subcode !== "") extras.metaSubcode = meta.error_subcode;
  if (meta.fbtrace_id) extras.fbtraceId = meta.fbtrace_id;
  return new AppError(message, status, code, extras);
}

export function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function databaseSslConfig() {
  return process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== "true", ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}) }
    : undefined;
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new AppError("DATABASE_URL is not configured. Set it in .env.local and run npm run db:init.", 503, "DB_NOT_CONFIGURED");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: databaseSslConfig()
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const context = databaseContext.getStore();
  if (!context) return getPool().query(text, params);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyDatabaseContext(client);
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function transaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await applyDatabaseContext(client);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

const PUBLIC_ERROR_BY_CODE = Object.freeze({
  DB_PERMISSION_DENIED: 'We could not save this change. Try again or contact support.',
  BUSINESS_SETUP_UPDATE_DENIED: 'WhatsApp was authorized, but the workspace could not be updated. Try again.',
  META_HTTPS_REQUIRED: 'WhatsApp connection is not ready yet. Contact support.',
  META_EMBEDDED_SIGNUP_NOT_CONFIGURED: 'WhatsApp connection is not available yet. Contact support.',
  META_EMBEDDED_SIGNUP_INVALID: 'WhatsApp connection is not available yet. Contact support.',
  META_APP_NOT_CONFIGURED: 'WhatsApp connection is not available yet. Contact support.',
  DB_NOT_CONFIGURED: 'The workspace is not ready yet. Contact support.',
  AUTH_NOT_CONFIGURED: 'Sign-in is not ready yet. Contact support.',
  JOB_SECRET_NOT_CONFIGURED: 'Background processing is not ready yet. Contact support.',
  JOB_UNAUTHORIZED: 'Background processing could not be authorized.',
  CRM_FIELD_MAP_USE_CONNECTION_SETTINGS: 'Update field mappings from HubSpot or Salesforce settings in Integrations.'
});

const META_GRAPH_ERROR_CODES = new Set([
  'META_REQUEST_FAILED',
  'ADS_REJECTED',
  'ADS_UNCONFIRMED',
  'META_CODE_EXCHANGE_FAILED',
  'META_TOKEN_INVALID',
  'META_TOKEN_EXPIRED'
]);

const POSTGRES_RLS_LEAK =
  /\b42501\b|permission denied for (?:table|relation|schema|sequence|column|function|database|role)\b|row-level security|set_config\(|whatsapp_crm_user|FORCE\s+ROW\s+LEVEL|tenant GUC|app\.business_id|current_setting\(\s*'app\.system_access'|current_setting\(\s*'app\.business_id'|table=/i;

function sanitizePublicMetaMessage(error, raw) {
  let safe = String(raw || '')
    .replace(/https?:\/\/[^\s]*access_token=[^\s]*/gi, '[redacted]')
    .replace(/\baccess_token=[^\s&]+/gi, 'access_token=[redacted]')
    .replace(/APP_URL|DATABASE_URL|META_APP_|JOB_RUNNER_SECRET|process\.env|ecosystem\.config/gi, '[config]')
    .trim();
  const metaCode = error?.metaCode;
  if (metaCode != null && metaCode !== '' && !/\(#\d+\)/.test(safe)) {
    safe = `(#${metaCode}) ${safe}`;
  }
  return (safe || 'Meta could not complete this request.').slice(0, 180);
}

function publicApiErrorMessage(error, status) {
  if (status === 500) return 'Something went wrong.';
  const mapped = PUBLIC_ERROR_BY_CODE[error?.code];
  if (mapped) return mapped;
  const raw = String(error?.message || '').trim();
  if (!raw) return 'Something went wrong.';
  const isMetaGraph =
    META_GRAPH_ERROR_CODES.has(error?.code) ||
    /\(#\d+\)|error_subcode|OAuthException|GraphMethodException/i.test(raw);
  // Keep Meta (#N) text for operators; still block true Postgres RLS false positives.
  if (isMetaGraph) {
    if (POSTGRES_RLS_LEAK.test(raw) || (/\bPostgres\b/i.test(raw) && /denied|exception|error|fail/i.test(raw))) {
      console.error('Masked DB/RLS API error', {
        code: error?.code || null,
        status,
        message: raw.slice(0, 500)
      });
      return 'We could not complete this action. Try again or contact support.';
    }
    return sanitizePublicMetaMessage(error, raw);
  }
  if (/APP_URL|DATABASE_URL|META_APP_|JOB_RUNNER_SECRET|process\.env|ecosystem\.config/i.test(raw)) {
    return 'This feature is not ready yet. Contact support.';
  }
  // Mask only Postgres/ops leakage (not English "grant" / Meta "permission denied for this …").
  if (
    POSTGRES_RLS_LEAK.test(raw) ||
    (/\bPostgres\b/i.test(raw) && /denied|exception|error|fail/i.test(raw))
  ) {
    console.error('Masked DB/RLS API error', {
      code: error?.code || null,
      status,
      message: raw.slice(0, 500)
    });
    return 'We could not complete this action. Try again or contact support.';
  }
  return raw.slice(0, 240);
}

export function errorJson(error) {
  // Normalize common Postgres privilege/RLS failures; keep technical detail in logs only.
  if (!error?.status && error?.code === '42501') {
    const detail = [error.message, error.detail, error.table ? `table=${error.table}` : '']
      .filter(Boolean)
      .join(' | ')
      .slice(0, 300);
    console.error('Postgres 42501', { detail, schema: error.schema, table: error.table });
    error = new AppError('We could not save this change. Try again or contact support.', 503, 'DB_PERMISSION_DENIED');
  }
  const status = error?.status || 500;
  const isMetaGraph =
    META_GRAPH_ERROR_CODES.has(error?.code) ||
    error?.metaCode != null ||
    /\(#\d+\)|OAuthException|GraphMethodException/i.test(String(error?.message || ''));
  if (status >= 500) {
    console.error('Unhandled API error', { code: error?.code || 'SERVER_ERROR', message: error?.message || 'Unknown error' });
  } else if (isMetaGraph) {
    console.error('Meta Graph API error', {
      code: error?.code || null,
      metaCode: error?.metaCode ?? null,
      metaSubcode: error?.metaSubcode ?? null,
      fbtraceId: error?.fbtraceId || null,
      status,
      message: String(error?.message || '').slice(0, 500)
    });
  }
  const message = publicApiErrorMessage(error, status);
  const headers = error?.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
  return json({ error: message, code: error?.code || "SERVER_ERROR" }, status, headers);
}

export function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}
