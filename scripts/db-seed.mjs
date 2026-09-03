import crypto from "node:crypto";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const email = (process.env.SEED_EMAIL || "owner@example.com").toLowerCase();
const password = process.env.SEED_PASSWORD || "Password123!";
const businessName = process.env.SEED_BUSINESS_NAME || "ABC Clothing";

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(value, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required before seeding.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();
try {
  await client.query("BEGIN");

  let user = await client.query("SELECT id FROM users WHERE email = $1", [email]);
  let userId = user.rows[0]?.id;
  if (!userId) {
    userId = id("u");
    await client.query(
      "INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)",
      [userId, "Owner", email, hashPassword(password)]
    );
  }

  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "business";
  let business = await client.query("SELECT id FROM businesses WHERE slug = $1", [slug]);
  let businessId = business.rows[0]?.id;
  if (!businessId) {
    businessId = id("b");
    await client.query(
      `INSERT INTO businesses (id, name, slug, whatsapp_number, waba_id, phone_number_id, webhook_url, mode, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Live Meta', 'Needs setup')`,
      [businessId, businessName, slug, "+91 98765 43210", "", "", process.env.WEBHOOK_URL || "http://localhost:3000/api/webhooks/meta"]
    );
  }

  await client.query(
    `INSERT INTO memberships (id, user_id, business_id, role)
     VALUES ($1, $2, $3, 'Owner')
     ON CONFLICT (user_id, business_id) DO NOTHING`,
    [id("mb"), userId, businessId]
  );

  const contacts = [
    ["John Mathew", "+91 98765 10001", true, false, isoHoursAgo(2), "Sample seed"],
    ["Ahmed Khan", "+91 98765 10002", true, false, isoHoursAgo(29), "Sample seed"],
    ["Rahul Nair", "+91 98765 10003", false, true, null, "Sample seed"],
    ["Meera Iyer", "+91 98765 10004", true, false, isoHoursAgo(5), "Sample seed"],
    ["Sara Joseph", "+91 98765 10005", true, false, null, "Sample seed"]
  ];
  for (const contact of contacts) {
    await client.query(
      `INSERT INTO contacts (id, business_id, name, phone, marketing_permission, unsubscribed, last_message_at, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (business_id, phone) DO NOTHING`,
      [id("c"), businessId, ...contact]
    );
  }

  await client.query(
    `INSERT INTO templates (id, business_id, name, category, body, variables, status, meta_template_id, meta_template_name, source)
     VALUES
       ($1, $3, 'Weekend Sale', 'Marketing', 'Hi {{name}}, we have a {{discount}} discount this weekend. Visit our store today.', '["name","discount"]', 'Approved', 'meta_tpl_weekend_sale', 'weekend_sale', 'Sample seed'),
       ($2, $3, 'Diwali Discount', 'Marketing', 'Hi {{name}}, Diwali sale is live. Get {{discount}} off today.', '["name","discount"]', 'Pending', '', 'diwali_discount', 'Sample seed')
     ON CONFLICT (business_id, name) DO NOTHING`,
    [id("t"), id("t"), businessId]
  );

  await client.query(
    "INSERT INTO events (id, business_id, type, metadata) VALUES ($1, $2, 'seeded', $3)",
    [id("e"), businessId, JSON.stringify({ email })]
  );

  await client.query("COMMIT");
  console.log(`Seed complete. Sign in with ${email} / ${password}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}



