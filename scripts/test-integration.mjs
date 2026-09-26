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
const env = { ...process.env, DATABASE_URL: testUrl.toString(), TEST_DATABASE_URL: testUrl.toString() };
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
  const tests = (await readdir("tests")).filter((name) => name.endsWith(".test.mjs")).map((name) => `tests/${name}`);
  await run(["--test", ...tests]);
} finally {
  if (created) {
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [databaseName]);
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
  await admin.end().catch(() => {});
}
