import crypto from "crypto";
import pg from "pg";

const { Pool } = pg;
let pool;

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
  return getPool().query(text, params);
}

export async function transaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
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
  return json({ error: message, code: error?.code || "SERVER_ERROR" }, status);
}

export function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}
