import crypto from "node:crypto";
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import nextEnv from "@next/env";
import pg from "pg";
import { databaseSslConfig } from "../lib/db.js";

nextEnv.loadEnvConfig(process.cwd());

const source = process.env.TEST_DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!source) throw new Error("DATABASE_URL or TEST_DATABASE_ADMIN_URL is required for integration tests.");
const url = new URL(source);
if (!process.env.TEST_DATABASE_ADMIN_URL && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  throw new Error("Remote test database creation requires an explicit TEST_DATABASE_ADMIN_URL.");
}
const databaseName = `wcrm_test_${crypto.randomBytes(8).toString("hex")}`;
const testUrl = new URL(source);
testUrl.pathname = `/${databaseName}`;
const integrationBase = process.env.APP_URL || "https://crm.example.test";
const env = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  DATABASE_MIGRATION_URL: testUrl.toString(),
  TEST_DATABASE_URL: testUrl.toString(),
  APP_URL: integrationBase,
  // Integration DB exercises product behavior, not Free Forever plan matrices.
  SUBSCRIPTION_ENFORCEMENT_ENABLED: "false",
  EMAIL_VERIFICATION_REQUIRED: "false"
};
const admin = new pg.Client({ connectionString: source, ssl: databaseSslConfig() });
let created = false;

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Command failed with exit code ${code}`)));
  });
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  await run(["scripts/db-init.mjs"]);
  const seed = new pg.Client({ connectionString: testUrl.toString(), ssl: databaseSslConfig() });
  await seed.connect();
  try {
    await seed.query("SELECT set_config('app.system_access','true',false)");
    await seed.query(
      `UPDATE platform_settings SET value = 'true'::jsonb
       WHERE key IN (
         'feature_checkout_recovery_enabled',
         'feature_webviews_enabled',
         'feature_ai_agent_enabled',
         'feature_ai_auto_reply_enabled',
         'feature_connectors_enabled'
       )`
    );
  } finally {
    await seed.end();
  }
  const requested = process.env.TEST_FILE;
  const tests = (await readdir("tests")).filter((name) => name.endsWith(".test.mjs") && (!requested || name === requested)).map((name) => `tests/${name}`);
  if (!tests.length) throw new Error('No matching integration test file.');
  await run(["--test", "--test-concurrency=1", ...tests]);
} finally {
  if (created) {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]);
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end().catch(() => {});
}
