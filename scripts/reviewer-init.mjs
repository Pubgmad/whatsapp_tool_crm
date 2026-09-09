import crypto from "node:crypto";
import process from "node:process";
import nextEnv from "@next/env";
import pg from "pg";

const { loadEnvConfig } = nextEnv;
const { Pool } = pg;
loadEnvConfig(process.cwd());

const clean = (value) => String(value || "").trim();
const email = clean(process.env.REVIEWER_EMAIL).toLowerCase();
const password = String(process.env.REVIEWER_PASSWORD || "");
const reviewerName = clean(process.env.REVIEWER_NAME);
const businessName = clean(process.env.REVIEWER_BUSINESS_NAME);
const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(value, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || `review-${crypto.randomBytes(3).toString("hex")}`;
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
if (!email || !password || !reviewerName || !businessName) {
  throw new Error("REVIEWER_EMAIL, REVIEWER_PASSWORD, REVIEWER_NAME, and REVIEWER_BUSINESS_NAME are required.");
}
if (password.length < 8) throw new Error("REVIEWER_PASSWORD must be at least 8 characters.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const existingUser = (await client.query("SELECT id FROM users WHERE email = $1 LIMIT 1", [email])).rows[0];
  let userId = existingUser?.id;
  let businessId;

  if (existingUser) {
    const reviewWorkspace = (await client.query(
      `SELECT b.id
       FROM memberships m
       JOIN businesses b ON b.id = m.business_id
       WHERE m.user_id = $1 AND b.review_access = TRUE
       LIMIT 1`,
      [userId]
    )).rows[0];
    if (!reviewWorkspace) {
      throw new Error("REVIEWER_EMAIL already belongs to a non-review account. Use a different dedicated reviewer email.");
    }
    businessId = reviewWorkspace.id;
    await client.query("UPDATE users SET name = $1, password_hash = $2, updated_at = NOW() WHERE id = $3", [reviewerName, hashPassword(password), userId]);
  } else {
    userId = id("u");
    businessId = id("b");
    const slug = `${slugify(businessName)}-${crypto.randomBytes(2).toString("hex")}`;
    const webhookUrl = process.env.WEBHOOK_URL || `${process.env.APP_URL || "http://localhost:3000"}/api/webhooks/meta`;

    await client.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)", [userId, reviewerName, email, hashPassword(password)]);
    await client.query(
      `INSERT INTO businesses (id, name, slug, webhook_url, mode, status, account_status, review_access)
       VALUES ($1, $2, $3, $4, 'Live Meta', 'Needs setup', 'active', TRUE)`,
      [businessId, businessName, slug, webhookUrl]
    );
    await client.query("INSERT INTO memberships (id, user_id, business_id, role) VALUES ($1, $2, $3, 'Owner')", [id("mb"), userId, businessId]);
  }

  await client.query("UPDATE businesses SET name = $1, account_status = 'active', review_access = TRUE, updated_at = NOW() WHERE id = $2", [businessName, businessId]);
  await client.query("DELETE FROM business_subscriptions WHERE business_id = $1", [businessId]);
  await client.query(
    "INSERT INTO audit_logs (id, business_id, user_id, action, metadata) VALUES ($1, $2, $3, 'reviewer_access_initialized', $4)",
    [id("a"), businessId, userId, JSON.stringify({ email, billingBypass: true })]
  );
  await client.query("COMMIT");
  console.log(`Permanent reviewer workspace is ready for ${email}. No subscription plan was assigned.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
