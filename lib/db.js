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

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new AppError("DATABASE_URL is not configured. Set it in .env.local and run npm run db:init.", 503, "DB_NOT_CONFIGURED");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
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

export function errorJson(error) {
  const status = error?.status || 500;
  const message = status === 500 ? "Something went wrong." : error.message;
  const headers = error?.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
  return json({ error: message, code: error?.code || "SERVER_ERROR" }, status, headers);
}

export function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}
