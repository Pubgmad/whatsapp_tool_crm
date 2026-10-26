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
  constructor(message, status = 400, code = "APP_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
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
  JOB_UNAUTHORIZED: 'Background processing could not be authorized.'
});

function publicApiErrorMessage(error, status) {
  if (status === 500) return 'Something went wrong.';
  const mapped = PUBLIC_ERROR_BY_CODE[error?.code];
  if (mapped) return mapped;
  const raw = String(error?.message || '').trim();
  if (!raw) return 'Something went wrong.';
  // Never surface internal ops / Postgres / RLS text in the CRM UI.
  if (/RLS|42501|set_config|Postgres|GRANT|whatsapp_crm_user|FORCE\s+ROW|ALS|tenant GUC|app\.business_id|system_access|table=/i.test(raw)) {
    return 'We could not complete this action. Try again or contact support.';
  }
  if (/APP_URL|DATABASE_URL|META_APP_|JOB_RUNNER_SECRET|process\.env|ecosystem\.config/i.test(raw)) {
    return 'This feature is not ready yet. Contact support.';
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
  if (status >= 500) console.error('Unhandled API error', { code: error?.code || 'SERVER_ERROR', message: error?.message || 'Unknown error' });
  const message = publicApiErrorMessage(error, status);
  const headers = error?.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
  return json({ error: message, code: error?.code || "SERVER_ERROR" }, status, headers);
}

export function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}
