import nextEnv from '@next/env';
import pg from 'pg';
import { decryptSecret, encryptSecret } from '../lib/meta.js';
import { databaseSslConfig } from '../lib/db.js';

nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL || !process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_KEY_PREVIOUS) throw new Error('DATABASE_URL, ENCRYPTION_KEY, and ENCRYPTION_KEY_PREVIOUS are required.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSslConfig() });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT set_config('app.system_access','true',true)");
  const targets = [
    ['businesses', 'id', 'access_token_encrypted'],
    ['whatsapp_accounts', 'id', 'access_token_encrypted'],
    ['users', 'id', 'mfa_secret_encrypted'],
    ['super_admins', 'id', 'mfa_secret_encrypted']
  ];
  for (const [table, key, column] of targets) {
    const rows = await client.query(`SELECT ${key} AS id,${column} AS value FROM ${table} WHERE NULLIF(${column},'') IS NOT NULL`);
    for (const row of rows.rows) await client.query(`UPDATE ${table} SET ${column}=$1 WHERE ${key}=$2`, [encryptSecret(decryptSecret(row.value)), row.id]);
  }
  await client.query('COMMIT');
  console.log('Encrypted application secrets were rotated successfully.');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
