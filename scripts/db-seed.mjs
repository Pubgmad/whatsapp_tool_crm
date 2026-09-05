import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const email = String(process.env.SEED_EMAIL || "").trim().toLowerCase();
const password = String(process.env.SEED_PASSWORD || "");
const businessName = String(process.env.SEED_BUSINESS_NAME || "").trim();

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(value, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `business-${crypto.randomBytes(3).toString("hex")}`;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required before seeding.");
  process.exit(1);
}

if (!email || !password || !businessName) {
  console.error("SEED_EMAIL, SEED_PASSWORD, and SEED_BUSINESS_NAME are required. This script only creates the first owner workspace; it does not create sample contacts, templates, or campaigns.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("SEED_PASSWORD must be at least 8 characters.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();
try {
  await client.query("BEGIN");

  const existing = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows[0]) {
    console.log(`Owner already exists for ${email}. No seed data was created.`);
    await client.query("COMMIT");
  } else {
    const userId = id("u");
    const businessId = id("b");
    const slug = `${slugify(businessName)}-${crypto.randomBytes(2).toString("hex")}`;

    await client.query(
      "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)",
      [userId, "Owner", email, hashPassword(password)]
    );
    await client.query(
      `INSERT INTO businesses (id, name, slug, webhook_url, mode, status)
       VALUES ($1, $2, $3, $4, 'Live Meta', 'Needs setup')`,
      [businessId, businessName, slug, process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/meta"]
    );
    await client.query(
      "INSERT INTO memberships (id, user_id, business_id, role) VALUES ($1, $2, $3, 'Owner')",
      [id("mb"), userId, businessId]
    );
    await client.query(
      "INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'workspace_seeded', $3)",
      [id("e"), businessId, JSON.stringify({ email })]
    );
    await client.query("COMMIT");
    console.log(`Owner workspace created for ${email}. No sample contacts, templates, or campaigns were created.`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
