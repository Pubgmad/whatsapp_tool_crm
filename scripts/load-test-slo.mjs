#!/usr/bin/env node
/**
 * Records a load-test attestation for platform SLO certification.
 * Run on your VPS after a controlled volume test (does not perform load itself).
 *
 * Usage:
 *   node scripts/load-test-slo.mjs --note "50k campaign sends, p95 queue lag 42s"
 */
import process from 'node:process';
import nextEnv from '@next/env';
import pg from 'pg';
import { databaseSslConfig } from '../lib/db.js';

nextEnv.loadEnvConfig(process.cwd());
const note = process.argv.includes('--note')
  ? process.argv[process.argv.indexOf('--note') + 1]
  : 'manual attestation';

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
  const payload = JSON.stringify({ at: new Date().toISOString(), note });
  const updated = await client.query(
    `UPDATE platform_settings SET value=$1::jsonb, updated_at=NOW() WHERE key='load_test_last_passed_at'`,
    [payload]
  );
  if (!updated.rowCount) {
    await client.query(
      `INSERT INTO platform_settings (id,key,label,category,value,value_type,is_public,display_order)
       VALUES ($1,'load_test_last_passed_at','Last VPS load-test attestation','feature_controls',$2::jsonb,'json',false,484)`,
      [`ps_${Date.now()}`, payload]
    );
  }
  console.log('Recorded load_test_last_passed_at:', payload);
} finally {
  await client.end();
}
