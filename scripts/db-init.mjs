import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Example: postgresql://postgres:password@localhost:5432/whatsapp_crm");
  process.exit(1);
}

const schema = await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

try {
  await pool.query(schema);
  await pool.query("ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_template_name TEXT DEFAULT ''");
  console.log("Database schema is ready.");
} finally {
  await pool.end();
}
