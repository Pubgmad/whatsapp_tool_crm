import process from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import { databaseSslConfig } from "../lib/db.js";
import { ensureMetaReviewerWorkspaceAccess, reviewerEnv } from "../lib/reviewer-access.js";

const { loadEnvConfig } = nextEnv;
const { Pool } = pg;
loadEnvConfig(process.cwd());

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const { email } = reviewerEnv();
const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  ssl: databaseSslConfig()
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await ensureMetaReviewerWorkspaceAccess(client);
  await client.query("COMMIT");
  console.log(
    result.updated
      ? `Granted App Review billing bypass on ${result.updated} workspace(s) for ${email}: ${result.businessIds.join(", ")}`
      : `No Owner workspaces found for ${email}. Check REVIEWER_EMAIL and memberships.`
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
