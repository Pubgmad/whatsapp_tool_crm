#!/usr/bin/env node
/**
 * Records Playwright a11y matrix attestation after a green `npm run test:e2e`.
 * Usage: node scripts/record-a11y-e2e.mjs [--projects chromium-desktop,android,...]
 */
import process from 'node:process';
import crypto from 'node:crypto';
import nextEnv from '@next/env';
import pg from 'pg';
import { databaseSslConfig } from '../lib/db.js';
import { A11Y_BASELINE_CHECKS, A11Y_E2E_PROJECTS } from '../lib/a11y-certification.js';

nextEnv.loadEnvConfig(process.cwd());

const argProjects = process.argv.includes('--projects')
  ? process.argv[process.argv.indexOf('--projects') + 1]?.split(',').map((s) => s.trim()).filter(Boolean)
  : [...A11Y_E2E_PROJECTS];

const passed = [...new Set([...argProjects, ...A11Y_BASELINE_CHECKS.map((c) => c.id)])];

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  ssl: databaseSslConfig()
});
await client.connect();
try {
  const at = new Date().toISOString();
  await upsert(client, 'a11y_e2e_last_run', at);
  await upsert(client, 'a11y_e2e_projects_passed', passed);
  console.log('Recorded a11y certification:', { at, passed });
} finally {
  await client.end();
}

async function upsert(client, key, value) {
  const updated = await client.query(`UPDATE platform_settings SET value=$1::jsonb, updated_at=NOW() WHERE key=$2`, [
    JSON.stringify(value),
    key
  ]);
  if (!updated.rowCount) {
    await client.query(
      `INSERT INTO platform_settings (id,key,label,category,value,value_type,is_public,display_order)
       VALUES ($1,$2,$3,'feature_controls',$4::jsonb,'json',false,485)`,
      [`ps_${crypto.randomBytes(6).toString('hex')}`, key, key, JSON.stringify(value)]
    );
  }
}
